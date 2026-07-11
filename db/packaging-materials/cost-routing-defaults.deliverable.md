# Research Report — Cost-Routing: per-task model swaps + "Better Defaults not Usage Caps"

**Extends:** openrouter-open-weight-routing (policy, task #20198) and `research/2026-06-27T151800Z_prompt-caching-deep-agents.md`. This report adds only the **new signal**: a concrete per-task model→cost mapping (DeRonin) and the **defaults-over-caps governance frame** (Armstrong/Coinbase). It does not re-derive the eligibility criteria or quality gates already in the routing policy.

---

## TL;DR

1. **Two independent operators converged on the same thesis Arc already encodes**: cost control comes from *per-task model routing*, not from throttling usage. DeRonin reports an 87% cost drop / ~4% quality drop by swapping a different model in per task type; Coinbase's Armstrong frames the same move as "Better Defaults, not Usage Caps" — cheaper defaults + automated routing + cache-awareness instead of friction and spend alerts.
2. **Arc already has the substrate** (per-task `model` column, `openrouter:*` support in `src/dispatch.ts`, buildPrompt cache reorder, `arc status` cache_hit_rate). The named gap from both sources is the one Arc's own memory already flags: **the task-type→model classifier is unqueued** — model is still chosen by hand at `arc tasks add` time, exactly the manual step Armstrong says "AI can automate."
3. **Highest-leverage next move**: build the automated task-type classifier so dispatch can *propose* an open-weight default per task (with human/sonnet fallback), and decide whether it lives in `arc-starter` (single-node) or `agent-runtime` (fleet). That closes the loop from "policy written" → "routing actually happens."

---

## Key Takeaways (cited)

### DeRonin — per-task model→cost swap table
Source: [@DeRonin_](https://x.com/DeRonin_/status/2071561335234531578), cached `7c572774e7e43507.json`, created 2026-06-29T11:48:04Z. Self-reported, single operator, no methodology published yet ("full article drops tomorrow") — treat the numbers as **anecdote, not benchmark**.

| # | Task type | Closed (from) → Open (to) | Benchmark gap | Price delta |
|---|-----------|---------------------------|---------------|-------------|
| 1 | reasoning / backend brain | Opus 4.8 → Kimi K2.7 | ~8% | ~11× cheaper |
| 2 | code generation | GPT-5.5 → Qwen 3.7 Max | ~18% | ~7× cheaper |
| 3 | agent loops + tool calling | Sonnet 4.7 → GLM 5.2 | ~3% | ~5× cheaper (input) |
| 4 | cheap volume / bulk | GPT-5.5 mini → MiMo V2.5 | ~6% | ~12× cheaper |
| 5 | image generation | GPT-Image-2 → Wan 2.5 | ~5% | ~8× cheaper |
| 6 | video generation | Sora 2 → Kling 3.0 | ~equal | ~6× cheaper |

Claimed 30-day result: operating cost −87%, output quality −4% avg, revenue unchanged. Non-cost rationale he weights heavily: open weights "won't be banned in a month," run locally, no data exfiltration. Note row 3 (**agent loops → GLM 5.2**) is *exactly* the swap Arc already validated and wrote into openrouter-open-weight-routing — independent corroboration of the GLM-5.2 tier for tool-calling work, with the caveat that an 18% gap on code-gen (row 2) is large enough to fail Arc's diff-review quality gate often.

### Armstrong / Coinbase — "Better Defaults, not Usage Caps"
Source: [@brian_armstrong](https://x.com/brian_armstrong/status/2070670644577280109), cached `70957e69c3360c8a.json`. Five named levers for keeping AI spend flat as token usage grows:

- **Better Defaults (not Usage Caps)** — "91% of our employees were never hitting their usage caps, so instead of lowering caps and driving up alerts, we're moving to cheaper defaults." Defaulting to open weights (GLM 5.2, Kimi 2.7) through an LLM gateway; engineers can still override. Code reviews use *a diversity of models so they can check each other's work*.
- **Better Routing** — "we preprocess prompts and route to the best model for the job, considering cache hits and model pricing... frontier model for planning, but not for execution where they can be overkill. Ultimately, humans shouldn't be choosing models — AI can automate this task."
- **Better Caching** — "Cache misses are the easiest way to drive your cost up... cache hit rate went from 5% → 60% in LibreChat once properly implemented."
- **Keep Context Lean** — "Start fresh sessions when switching tasks. Scope file context narrowly. Disconnect unused tools. Don't just compact. The goal isn't fewer tokens used, it's fewer tokens wasted."
- **Better Visibility** — engineers can use any model/tokens, but spend is observable.

The frame is governance: cost discipline as **architecture (defaults + routing + caching)**, never as **friction (caps + alerts)**. This is the same posture Arc's memory already records about the X budget ("constant saturation = discipline working, not a too-low cap") — but here applied to model spend.

---

## Arc-Alignment (grounded in real code)

### Where Arc already does this

**Per-task model column = "swaps by task."** DeRonin's manual per-task swap and Armstrong's "route to the best model for the job" are the *exact semantics* of Arc's `tasks.model` column. `src/dispatch.ts:137-149` (`selectModel`) resolves `opus|sonnet|haiku` directly and passes `codex` / `openrouter:*` through `parseTaskSdk`; `src/openrouter.ts` (`dispatchOpenRouter`, imported at `dispatch.ts:52`) already executes open-weight routes. CLAUDE.md is explicit: "There is no implicit priority→model routing — tasks without a model are rejected" (`dispatch.ts:1390-1394`). **Arc's architecture already assumes per-task model selection — it is the swap table, just keyed by task instead of by modality.**

**Better Caching = buildPrompt cache reorder.** Armstrong's 5%→60% cache-hit story maps onto Arc's already-shipped work: buildPrompt reordered static-before-dynamic (commit 31628a9b) to maximize the cache prefix, and `arc status` now tracks `cache_hit_rate` + `cost/accepted-change` (commit 5498f53a, 2026-06-28). See `memory/shared/entries/prompt-caching-exclude-dynamic.md`. Arc is already "cache aware" in Armstrong's sense.

**Keep Context Lean = lean MEMORY.md.** Arc has measured this directly: lean MEMORY.md = −36% avg duration, −72% P95 (verified #19374/77). Armstrong's "fewer tokens wasted, not fewer tokens used" is the same finding from a different shop.

**Better Defaults / diversity-of-models = open-weight routing policy + Opus fallback.** openrouter-open-weight-routing already defines the GLM-5.2 / Devstral-2512 tiers and validated GLM on bounded code tasks. Arc even has the "models check each other's work" primitive: `dispatch.ts:558-559` adds `--fallback-model sonnet` when the primary is opus.

### Where the gap is (the real signal)

**The task-type → model classifier is unqueued.** Both sources name the missing piece, and Arc's own memory ([A] open-weight-routing) already flags it: *"task-type classification work is UNQUEUED — without it, no automated routing happens."* Armstrong states the target directly: "humans shouldn't be choosing models — AI can automate this task." Today Arc chooses the model *by hand* at `arc tasks add` time (the policy is a human checklist, not code). DeRonin chooses by hand too. The frontier neither has crossed is a **deterministic classifier that reads task subject/description/skills and proposes a model tier**, defaulting to the cheapest eligible open-weight route with sonnet/opus fallback on quality-gate failure.

This is the difference between a *policy* (Arc has one) and a *default* (Arc lacks one). Armstrong's whole point: a policy that requires a human to apply it per-request is friction; a default that the system applies automatically is architecture. Arc currently sits on the friction side for model routing, even though it sits on the architecture side for caching and context.

**Secondary gap: cache-hit-aware routing.** Armstrong routes "considering cache hits and model pricing" — i.e. routing and caching are *one* decision (a warm-cache frontier call can beat a cold open-weight call). Arc treats them separately: cache reorder is in buildPrompt, model is in the task column, and nothing reads cache state when picking a model. Lower priority than the classifier, but it's the more sophisticated version of the same idea.

### Port to agent-runtime?

**The classifier should be specified once and live where the dispatch loop lives.** In `arc-starter` (single-node) the classifier is a pure function over a task row — cheap to add next to `selectModel` in `dispatch.ts`, and it can run *before* `arc tasks add` commits (suggest a model) or *at dispatch* (override an unset/under-specified model). But ARC-0013 (fleet-dispatch-atomic-claim) moves the dispatch loop toward `agent-runtime` with an atomic SQL claim. **If routing is a property of the dispatch loop, the classifier belongs wherever the canonical loop ends up.** Recommendation: prototype the classifier in `arc-starter` as a standalone function (fast feedback, real task corpus to test against), but write it import-clean so it ports to `agent-runtime` without rework — the same way the routing *policy* was written substrate-agnostic. Do not fork the logic across both repos.

---

---

## How this was verified

- DeRonin tweet — [@DeRonin_/2071561335234531578](https://x.com/DeRonin_/status/2071561335234531578), cached `skills/arc-link-research/cache/7c572774e7e43507.json` (created 2026-06-29T11:48:04Z). Self-reported single-operator anecdote; methodology unpublished at time of capture. Numbers are claims, not measurements.
- Armstrong tweet — [@brian_armstrong/2070670644577280109](https://x.com/brian_armstrong/status/2070670644577280109), cached `skills/arc-link-research/cache/70957e69c3360c8a.json`. Coinbase internal-practice description; the 5%→60% cache-hit figure is for their LibreChat deployment, not independently verified.
- Arc code citations verified against working tree 2026-06-29: `src/dispatch.ts:52,137-149,558-559,1390-1394`, `src/openrouter.ts`, commits 31628a9b / 5498f53a.
- Prior art (not re-derived here): openrouter-open-weight-routing, prompt-caching-exclude-dynamic, `research/2026-06-27T151800Z_prompt-caching-deep-agents.md`, fleet-dispatch-atomic-claim.

*No new cache fetched — reused batch cache from task #20282 (fetched 2026-06-29T14:24:36Z).*
