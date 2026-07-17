# Research Report — 2026-06-19T19:50:53Z

## TL;DR

Kimi K2.6 runs 300 parallel agents across 4,000 coordinated steps from a single prompt, beating models 5× pricier on real research tasks. Arc already supports `openrouter:kimi` dispatch in both repos but aliases to k2.5, not k2.6. The swarm architecture is fundamentally different from Arc's serial task queue — Arc can adopt Kimi for cheap single-agent tasks today; the 300-agent swarm pattern requires native Kimi platform orchestration, not Arc's dispatch loop.

---

## Key Takeaways

**1. Kimi K2.6 pricing and scale** *(source: article, Kimi platform cache)*
- Input: $0.95/M tokens, output: $4.00/M, cache hits: $0.16/M
- 300 parallel sub-agents share a 4,000-step total budget (~13 steps/agent avg)
- Open-weight model, free to run via Kimi platform or API
- Verified superior to "models 5× pricier" on real research tasks (article's claim; Opus 4.8 used as verifier)

**2. The swarm is a platform feature, not an API feature** *(source: article)*
- You submit a spec to the Kimi platform UI — it decomposes the task, builds the agent graph, runs parallel waves
- The "300 agents" run inside Kimi's infrastructure; callers see only the final deliverable
- This is NOT equivalent to calling the Kimi API 300 times — it's a managed orchestration product

**3. Self-improving loop: 10-step playbook** *(source: article)*
- Step 1: Write a spec (goal, scope, rules, sources, output format, stop condition) — not a one-liner prompt
- Step 2: Review decomposition plan before running (catch mis-scoped swarms before they burn credits)
- Step 3: Run wastefully — parallel waves, each sub-agent gets its own bounded context window (no lossy summarization collapse)
- Step 4: Demand real file outputs (PDFs, CSVs, PNGs) — specificity at output level is the quality gate
- Step 5: Opus 4.8 as the exclusive verify gate — its only job is to refute, not praise; 4× less likely than Opus 4.7 to pass flawed output
- Step 6: Save the whole workflow as a reusable Skill (input format + agent steps + output format)
- Step 7: Feed your own documents as swarm knowledge — every upload grounds all 300 agents
- Step 8: Turn Opus's verify feedback into a permanent CONSTRAINTS.md (loaded at every session start)
- Step 9: Replay skill on new inputs — run #50 is 30s, not 20min; cost collapses over iterations
- Step 10: Promote to background agent — trigger on schedule/file drop, surface only deliverable + deviations

**4. The structural trick: bounded context per sub-agent** *(source: article)*
- Single-agent long tasks suffer lossy summarization as context fills; swarm avoids this by scoping each subtask
- Only structured output flows back to the coordinator — the bottleneck is removed
- This matches the "context per sub-agent" pattern in Arc's Workflow harness, not Arc's task queue

**5. Opus 4.8 verify gate claim** *(source: article, citing Anthropic)*
- "4× less likely than 4.7 to let a flaw in its own code pass unremarked"
- "First Claude to score 0% on uncritically reporting flawed results"
- Used here as a cheap correctness filter over cheap-model bulk output — the cost/quality split

---

## Arc-Alignment

### What Arc already has

**`openrouter:kimi` dispatch is live in both repos.**

- `arc-starter/src/models.ts:32` — alias `kimi: "moonshotai/kimi-k2.5"` registered
- `arc-starter/src/openrouter.ts` — full OpenRouter dispatch path, key via `arc creds set --service openrouter --key api-key`
- `arc-starter/src/dispatch.ts` — `openrouter:kimi` is a valid task model string, routes through `dispatchOpenRouter()`
- `agent-runtime/src/models.ts:31` — same `kimi: "moonshotai/kimi-k2.5"` alias
- `agent-runtime/src/openrouter.ts` — same dispatch path

Arc can run `openrouter:kimi` single-agent tasks today — no structural work required, just an OpenRouter API key and a task with `--model openrouter:kimi`.

**The CONSTRAINTS.md pattern maps to Arc's existing primitives:**
- `dead_ends` column in `tasks` table — failures logged per-attempt (arc-starter `src/db.ts`)
- `memory/MEMORY.md` — persistent operational constraints, already loaded into every dispatch
- ARC-0011 escalation ladder — structured approach to not repeating failed strategies
- The article's CONSTRAINTS.md is the same idea: lessons from each run baked into the next

**The verify-gate model routing split (Kimi for bulk + Opus for verify) aligns with Arc's 3-tier model routing** — haiku/sonnet/opus already serve different cost/quality positions. The Kimi pattern adds a 4th: "ultra-cheap open-model for parallel tasks, premium model for verification only."

### The gap

**Arc's dispatch is serial, not swarm.** The dispatch-lock (`db/dispatch-lock.json`) enforces one active task at a time. The 300-agent Kimi swarm is a platform-native parallel execution model inside Kimi's infrastructure. Arc cannot replicate this via its task queue — queuing 300 individual tasks would serialize them over hours, not minutes.

**Port to agent-runtime?**

The relevant change for agent-runtime is the same as arc-starter: update the kimi alias from k2.5 → k2.6. The swarm execution model is a Kimi-platform concern, not an agent-runtime concern. agent-runtime's OpenRouter path already handles Kimi single-agent dispatch.

---

**1. Update kimi alias: k2.5 → k2.6**
Both `arc-starter/src/models.ts:32` and `agent-runtime/src/models.ts:31` alias `kimi` to `moonshotai/kimi-k2.5`. Kimi K2.6 is the current production model (K2.7 Code also released). Update alias to `moonshotai/kimi-k2.6`.
- Effort: S | Impact: medium (tasks dispatched as `openrouter:kimi` get the better model) | Risk: low (backwards-compatible alias change) | Target: both repos

**2. Benchmark `openrouter:kimi` on a bounded Arc research task**
Arc has no cost/quality benchmark for kimi vs haiku. A single `arc tasks add --model openrouter:kimi` on a bounded research task (e.g., one-link `arc-link-research process`) would produce a real cost/duration data point. Compare against the $0.40/task haiku baseline.
- Effort: S | Impact: high (data point for cheap-tier dispatch routing) | Risk: low (single task, bounded scope) | Target: arc-starter

**3. Add Opus-as-verify-gate to research task templates**
The article's Kimi+Opus split is the same pattern as Arc's 3-tier routing but explicit: cheap model generates, expensive model verifies. Arc's research tasks currently use one model end-to-end. A template variant that runs Kimi generation → Opus verify as a two-task chain would match this pattern.
- Effort: M | Impact: medium (cost reduction on research tasks if Kimi quality is adequate) | Risk: medium (requires quality validation before using in production) | Target: arc-starter templates/

**4. Do NOT attempt to replicate the 300-agent swarm inside Arc's task queue**
The swarm pattern requires Kimi's native parallel orchestration infrastructure. Queuing 300 tasks in Arc's serial dispatch would take hours and defeat the purpose. Use Kimi's platform directly for swarm-scale research tasks; use Arc for single-agent Kimi dispatch.
- Effort: N/A | Impact: high (avoids wasted engineering) | Risk: N/A | Target: decision record only

**5. The CONSTRAINTS.md pattern is already implemented — surface it explicitly**
Arc's `dead_ends` column + `memory/MEMORY.md` operational rules already implement "permanent rules from verify feedback." Consider adding a `CONSTRAINTS.md` per skill domain (convergent with the `domain-glossary-context-md` shared entry) as an explicit file that sensors and dispatch load for the skill's domain. Ties into the `[domain-glossary-context-md]` entry.
- Effort: S | Impact: medium (reduces repeated-mistake rate in sensor + dispatch) | Risk: low | Target: arc-starter skills/

---

## SKU Candidate

**Yes.** The 10-step self-improving swarm playbook with copy-paste prompts is a concrete, actionable workflow guide. Arc's patterns library already serves content via `arc0me-site/src/data/patterns-library.json`. This maps cleanly to a $9 patterns-library entry: "The Compounding Swarm: 10 steps to a self-improving research agent on Kimi K2 + Opus verify gate."

---

## How this was verified

- Source: https://x.com/0xMovez/status/2067291911468044494
- Article title: "The Self-Improving Loop: a 300-agent swarm on Kimi K2.6, verified by Opus 4.8"
- Cache: `skills/arc-link-research/cache/a4254f0b957a2d84.json`
- Fetched: 2026-06-19T19:22Z
- Supporting: Kimi API Platform (skills/arc-link-research/cache/481996ccc92e2242.json, fetched 2026-06-15)
