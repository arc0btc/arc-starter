# ARC-0012: OpenRouter Adapter — deepagents Primitives & SDK Surface Audit

| Field | Value |
|-------|-------|
| ARC | 0012 |
| Title | OpenRouter Adapter — deepagents Primitives & SDK Surface Audit |
| Author | Arc |
| Status | Draft |
| Created | 2026-06-04 |
| Requires | — |
| Touches | `src/openrouter.ts`, `src/models.ts`, dispatch loop |

---

## Context

The OpenRouter dispatch adapter (`src/openrouter.ts`) was written as a minimum-viable bridge so non-Claude-Code models could execute Arc tasks. It has not been reviewed since. Three things changed in the year since:

1. **OpenRouter shipped an official typed SDK** (`@openrouter/sdk`). The adapter still uses raw `fetch()`. The SDK surfaces OpenRouter-specific fields (`plugins`, `provider`, `transforms`, `reasoning`, `usage.cost`) that the OpenAI SDK strips.
2. **OpenRouter's API has grown.** Prompt caching for Anthropic models, real per-response cost accounting (`usage.cost`), provider preference routing, the model-slug variant family (`:exacto` / `:nitro` / `:floor` / `:online`), the **Auto Router** meta-model (`openrouter/auto`), **Auto Exacto** quality-weighted provider reordering (default-on for tool calls), the `middle-out` context transform, reasoning-token control, structured outputs, and the experimental Router Metadata header are all available now and not used. **Auto Exacto in particular means our requests are already being routed through a quality-weighted pipeline** — and the proposal must avoid accidentally opting out of it.
3. **Deepagents-style primitives are now an established design pattern** (langchain-ai/deepagentsjs, Claude Code's own toolset). The pattern: replace a single `bash` escape hatch with a planning primitive (`write_todos`), a filesystem suite (`read_file` / `write_file` / `edit_file` / `ls` / `glob` / `grep`), and a sub-agent primitive (`task`) with isolated context. The adapter currently has only `bash`.

**Documentation reference convention.** OpenRouter ships docs at agent-friendly paths: `/llms.txt` and `/llms-full.txt` give indexes; appending `.md` to any docs page returns markdown. This RFC links to live docs rather than transcribing field lists that will drift. **When implementing, fetch the live docs**, not the snippets quoted here.

Comparison with deepagentsjs (research thread, 2026-06-04) confirms agent-runtime's outer loop is architecturally ahead — autonomous queue, lessons layer, escalation ladder, peer inbox. The one place we are weaker is the **inner loop on the OpenRouter path**, where every other tool call is the model writing a heredoc to do what should be a primitive operation.

Related: dispatch on Claude Code and Codex paths inherit their host's native toolset. Only OpenRouter dispatches run on our hand-rolled loop — which means this adapter is also the *only* place where the agent's inner-loop quality is determined by code we own.

---

## Motivation

Three concrete costs of the current adapter:

**Token waste from missing primitives.** On the OpenRouter path, reading a file costs the agent a `bash` call with `cat`, a 10k-char-capped response, and an assistant message rationalizing the result. A `read_file` primitive would return the file directly with a defined contract. Same for `ls`, `grep`, `glob`, and edits — each is currently one or two extra round trips. Conservative estimate: 20–35% of tool calls on the OpenRouter path are filesystem operations that should not be going through bash.

**Loop coherence collapse past ~15 iterations.** With no `write_todos` primitive, multi-step tasks lose plan state once the working context grows. The model re-derives "what was I doing" from message history. By the iteration cap (50), most cycles spent past iteration ~20 are cleanup or re-discovery, not productive work.

**No sub-agent isolation.** Every exploratory tool call accretes onto the main context. By the end of a 30-iteration task, the model is paying full-price attention over 50k+ tokens of `grep` outputs that mattered for two iterations. Sub-agents fix this by returning summaries, not transcripts.

**SDK-side: stale cost data, no prompt caching, no failover.** Pricing is hard-coded in `models.ts` and recalculated from token counts; OpenRouter returns real cost in `usage.cost` and we ignore it. No `cache_control` means the conversation prefix is re-billed every iteration. No `provider` preferences means a provider outage takes the task down instead of failing over.

If we do nothing: OpenRouter-routed tasks remain 2–4× more expensive per useful output than Claude Code-routed tasks, and the gap widens as OpenRouter ships features we don't adopt.

---

## Proposal

Two coordinated changes to `src/openrouter.ts`:

- **Part A** — adopt deepagents-style tool primitives.
- **Part B** — close the OpenRouter API surface gaps.

### Part A — Tool primitive adoption

Replace the single `bash` tool with a primitive toolset. `bash` stays as an escape hatch.

```
tool             arguments                              purpose
───────────────  ─────────────────────────────────────  ─────────────────────────────
write_todos      { todos: [{id, content, status}] }     Plan scaffold. Stateless;
                                                        echoes the list back to the
                                                        model. Persists in adapter
                                                        memory for the run only.

read_file        { path, offset?, limit? }              Read file contents. Returns
                                                        line-numbered text. Errors on
                                                        binary/missing.

write_file       { path, content }                      Create or overwrite. Refuses
                                                        paths outside cwd unless
                                                        ALLOW_OUTSIDE_CWD set.

edit_file        { path, old_string, new_string,        Exact-match replace. Errors
                   replace_all? }                       if old_string not unique
                                                        (unless replace_all).

ls               { path }                               Directory listing with file
                                                        sizes and types.

glob             { pattern, cwd? }                      Match files by glob. Bun's
                                                        Glob API. Returns paths only.

grep             { pattern, path?, glob?, output_mode } ripgrep-equivalent search.
                                                        Modes: content | files | count.

task             { description, prompt, model? }        Sub-agent. Recursive call to
                                                        dispatchOpenRouter with own
                                                        message history. Returns only
                                                        the final string to parent.
                                                        Defaults to parent's model.

bash             { command, timeout_ms? }               Escape hatch. Kept for
                                                        anything not covered above
                                                        (git, arc CLI, network).
```

**Implementation pattern:** each tool is a pure async function `(args, ctx) => string`. The adapter routes tool calls through a single dispatcher map. No new external dependencies — filesystem tools use Bun's native APIs (`Bun.file`, `Bun.Glob`), `grep` uses `Bun.spawn(['rg', ...])` with fallback to a Bun-native implementation if `rg` is missing.

**Sub-agent contract:** `task` recurses into `dispatchOpenRouter` with a *fresh* message array seeded by the sub-agent prompt only. The parent never sees the sub-agent's intermediate tool calls — only the final string the sub-agent returns. Sub-agent iteration count is its own; sub-agent cost is added to the parent's total via the existing `usage` aggregation.

**System prompt:** the adapter currently sends no system prompt. Add an opinionated default that documents the toolset, instructs the model to plan with `write_todos` before complex work, and to delegate exploration to `task`. Override via a new `systemPrompt?: string` parameter on `dispatchOpenRouter`.

### Part B — SDK surface audit

Thirteen gaps identified. Grouped by impact. **All references below should be cross-checked against the live docs at implementation time** — fields and defaults change.

#### B0. Adopt `@openrouter/sdk` as the transport (HIGH impact)

Replace raw `fetch()` with the official `@openrouter/sdk` client. It is OpenAI-Chat-Completions–compatible at the wire level (so existing message/tool shapes don't change), but is typed against OpenRouter's actual request body — including the fields we want to use (`plugins`, `provider`, `transforms`, `reasoning`, `usage.include`). The SDK also tracks new features as they ship, so we stop discovering capabilities by reading announcement posts.

Docs: `https://openrouter.ai/docs/community/sdk` (TypeScript SDK reference).

#### B1. Prompt caching for Anthropic models (HIGH impact)

OpenRouter passes through Anthropic's `cache_control` markers. The tool-call loop is the textbook case: the same system prompt + tool definitions + early conversation prefix is re-sent every iteration. Add cache breakpoints:

- On the system message (always cached).
- On the last user message at iteration 1 (caches the initial prompt).
- On the last tool result before each model call (rolling cache — Anthropic supports up to 4 cache breakpoints; we use 3 and leave one for callers).

Expected savings on a 20-iteration task: ~60–75% input-token cost on Anthropic models. Non-Anthropic models silently ignore the markers — zero downside.

#### B2. Real cost via `usage: { include: true }` (HIGH impact)

Pass `usage: { include: true }` in the request body. OpenRouter returns `usage.cost` (USD, post-discount, post-provider-markup) in the response. Replace the hand-rolled `calculateApiCostUsd` for the `cost_usd` field with the real number; keep the calculated value as `api_cost_usd` for parity with Claude Code dispatches (which estimate API cost from tokens). This also fixes the `models.ts` pricing table drift problem — it stops being load-bearing for accounting.

#### B3. Streaming (MEDIUM impact)

Switch to SSE streaming (`stream: true`). Emit incremental output to stdout so dispatch logs show live progress, not a 30-minute silence followed by a wall of text. Streaming also unlocks early-termination if a stop-sequence or watchdog fires.

#### B4. Provider preferences (MEDIUM impact) — and the Auto Exacto trap

Use the `provider` request field for failover ordering and privacy:

```json
"provider": {
  "order": ["Anthropic", "Google", "OpenAI"],
  "allow_fallbacks": true,
  "data_collection": "deny"
}
```

For Anthropic-tier models this fails over to other providers of the same logical model on outage.

**Critical: do NOT set `provider.sort = "price"` on tool-calling requests.** Auto Exacto (B4a) is OpenRouter's default-on quality-weighted routing for tool calls, and `sort: "price"` is the documented opt-out — using it would silently re-introduce the price-weighted behavior Auto Exacto was created to fix (GLM-5 / GLM-4.7 tool-call error rate dropped 88% / 80% when Auto Exacto was enabled). The current adapter does not set `sort`, so it's already on the right side of this — but the proposal must make the rule explicit so the helper-call paths (non-tool, eval, summarization) are the only places `sort: "price"` is allowed.

Use the slug-variant family (B4b) for per-tier sort intent instead — it's more explicit and avoids accidentally clobbering Auto Exacto.

Docs: `https://openrouter.ai/docs/guides/routing/provider-selection`.

#### B4a. Auto Exacto awareness (HIGH impact, mostly defensive)

Auto Exacto reorders providers using throughput + tool-call-success-rate + benchmark signals, re-evaluated ~every 5 minutes. **It is default-on for any request that includes a `tools` field** — which is every request our adapter makes. We do not opt in; we already get this. Three implications:

1. **Don't accidentally opt out** (see B4 — no `sort: "price"` on tool requests).
2. **Tool-result variance reduces** — fewer `InvalidJson` / `UnknownName` / `SchemaMismatch` retries from weak providers. Worth measuring after rollout (the adapter should log per-iteration retry reasons so we can quantify the improvement).
3. **For non-tool helper calls** (sub-agent summarization, log condensation, anything called without `tools`), Auto Exacto does not run. Opt in by appending `:exacto` to the model slug for those paths if quality matters.

Docs: `https://openrouter.ai/docs/guides/routing/auto-exacto`. Announcement with measured impact: `https://openrouter.ai/announcements/auto-exacto`.

#### B4b. Model-slug variant family (MEDIUM impact)

OpenRouter exposes four slug suffixes that change routing intent without body-level fields:

| Suffix | Effect | When Arc should use it |
|---|---|---|
| `:exacto` | Quality-weighted provider sort (Auto Exacto for non-tool calls) | Sub-agent summarizers, eval helpers |
| `:nitro` | Throughput-weighted (lowest latency) | Time-sensitive paths (cooldown-gated sensors) |
| `:floor` | Price-weighted (cheapest provider) | Disposable background tasks; never on tool-calling |
| `:online` | Auto-enables web grounding plugin | ARC-0011 WEB-SEARCH rung |

These compose with the base model ID (e.g. `anthropic/claude-sonnet-4.5:exacto`). The dispatcher should accept the suffix in the task's `model` field directly (`openrouter:anthropic/claude-sonnet-4.5:nitro` already parses correctly under the existing colon-split logic — verify).

Docs: `https://openrouter.ai/docs/guides/routing/model-variants/exacto`, `.../nitro`, `.../floor`. `:online` covered in B6.

#### B4c. Auto Router meta-model (`openrouter/auto`) (MEDIUM impact)

The Auto Router is a model slug (`openrouter/auto`) that delegates model selection to NotDiamond's meta-model, which picks from a curated set (~38 candidates: Claude Sonnet 4.5, Opus 4.5, GPT-5.1, Gemini 3.1 Pro, DeepSeek 3.2, etc.). You pay only the routed model's rate — there is no router fee. The response `model` field reveals which model was picked.

The candidate pool can be constrained via the `plugins` field with wildcard patterns:

```typescript
plugins: [
  { id: "auto-router", allowed_models: ["anthropic/*", "openai/gpt-5.1"] }
]
```

Two productive uses for Arc:

1. **As a new tier alongside `opus` / `sonnet` / `haiku`.** Tasks that don't care about specific model identity (eval-style, summarization, exploration) can be queued with `model = "openrouter:openrouter/auto"`. The router picks the right tier per prompt.
2. **As a fallback router when the requested tier is unavailable** — e.g. Anthropic outage on a sonnet-tagged task. This is loosely covered by `provider.allow_fallbacks` already, but Auto Router crosses model families, not just providers of the same model.

Open question on default constraint set: see Open Questions.

Docs: `https://openrouter.ai/docs/guides/routing/routers/auto-router`. Model page: `https://openrouter.ai/openrouter/auto`.

#### B5. `middle-out` context transform (MEDIUM impact)

OpenRouter's `transforms: ["middle-out"]` truncates middle messages when context exceeds the model window — keeps the system prompt and recent tool results, drops the middle of the conversation. Cheaper than our current "fail at iteration 50" behavior. Opt-in per call.

Docs: `https://openrouter.ai/docs/guides/features/message-transforms`.

#### B6. Native web grounding (`:online`) (MEDIUM impact)

Appending `:online` to any model ID enables OpenRouter's web search plugin (Exa-backed). Removes the need for the agent to shell out to `curl` or a separate web-search skill on the OpenRouter path. Should be enabled automatically when escalation ladder (ARC-0011) reaches the `WEB-SEARCH` rung.

#### B7. Reasoning-token control (LOW–MEDIUM impact)

For reasoning-capable models (Claude extended-thinking, o-series, DeepSeek-R1), the `reasoning: { effort: "low"|"medium"|"high", exclude: bool }` field controls thinking budget and whether reasoning tokens are returned. Default `exclude: true` to keep them out of the assistant message (they're billed but invisible) and pick effort by task priority.

#### B8. Structured outputs via `response_format` (LOW–MEDIUM impact)

For tool result formatting and sub-agent return values, `response_format: { type: "json_schema", json_schema: {...} }` forces parseable output on supporting models. Useful for the sub-agent contract.

#### B9. Retry on transient failures (LOW impact)

Current code throws on any non-OK response. Add a single retry with 1s backoff for 429/502/503/504. More than one retry belongs in the escalation ladder.

#### B10. Per-tool output caps (LOW impact)

The 10k-char cap on bash output is global. Filesystem primitives should have their own caps appropriate to the tool (`read_file`: configurable via `limit`; `grep`: 5k for `content` mode, unlimited for `files`/`count`).

#### B11. Stop sequences and seed (LOW impact)

Expose `stop` and `seed` parameters for callers that need reproducibility (evals, regression tests). Defaults remain unset.

#### B12. Router Metadata header (diagnostic; experimental) (LOW impact)

Send `X-OpenRouter-Experimental-Metadata: enabled` to receive an `openrouter_metadata` field on responses describing routing decisions: which provider was picked, what pipeline stages ran (context compression, guardrails, server tools), retry attempts, and per-attempt status codes. This is **experimental** — OpenRouter explicitly warns the schema is unstable.

Recommended posture: enable behind a `DEBUG_ROUTER_METADATA` flag (off by default in production dispatch; on in eval / regression runs). Log the metadata at debug level — do NOT branch dispatch behavior on its fields, because they can change without deprecation.

Docs: `https://openrouter.ai/docs/guides/features/router-metadata`.

### Out of scope (explicit)

- **Switching to the official OpenAI SDK as a transport.** The OpenAI Node SDK works against OpenRouter but strips OpenRouter-specific fields (`provider`, `transforms`, `reasoning`, `plugins`, `usage.include`). `@openrouter/sdk` (B0) is the right answer.
- **Body Builder (`openrouter/bodybuilder`).** Free meta-model that generates multi-model request bodies for parallel execution — well suited to an evaluation skill that fans the same prompt across multiple models for comparison. Not the hot-path adapter's job. Track as a follow-up under a future `arc-model-evals` skill. Docs: `https://openrouter.ai/docs/guides/routing/routers/body-builder`.
- **Pareto Router and Fusion Router.** Listed in the docs nav but with narrower use cases than Auto Router. Skip unless a task type emerges that benefits.
- **Streaming tool-call deltas.** Streaming the final-answer assistant content is in scope (B3). Streaming tool-call argument deltas mid-iteration is not — adds complexity without changing dispatch behavior.
- **Multi-modal inputs (images, PDFs).** OpenRouter supports both; no current task type needs them.

---

## Backward Compatibility

**Signature-compatible.** `dispatchOpenRouter(prompt, model, cwd?, apiKey?, explicitModelId?)` keeps its current signature. New behavior gated by optional parameters:

- `systemPrompt?: string` — defaults to the opinionated deepagents-style prompt.
- `tools?: ToolName[]` — defaults to the full primitive set. Callers can restrict (e.g. `["bash"]` for the old behavior).
- `enableCaching?: boolean` — defaults to `true`.
- `provider?: ProviderPreferences` — defaults to none.
- `transforms?: ("middle-out")[]` — defaults to none.

**Cost field semantics shift.** `cost_usd` becomes real (from `usage.cost`); `api_cost_usd` stays calculated. Existing readers of `cost_usd` get more accurate numbers, never less. Dispatch logging and `arc status` need no changes.

**New dependency.** `@openrouter/sdk` is added to `package.json`. Currently the project has only `@modelcontextprotocol/sdk` and `zod`, so the dep surface stays minimal.

**Task `model` field grammar extends.** The dispatcher must accept slug variants (`:exacto`, `:nitro`, `:floor`, `:online`) and the Auto Router slug (`openrouter/auto`). Existing `openrouter:<alias>` and `openrouter:<full-id>` paths continue to work; new forms layer on top.

**No DB migration.** All changes are adapter-internal.

---

## Alternatives Considered

**1. Adopt deepagentsjs directly as the OpenRouter loop.** Rejected. It's LangGraph-based; pulling that in for one adapter is a heavy dependency for primitives we can implement in <500 lines of Bun. Also commits us to a JS framework's lifecycle on a hot path.

**2. Port only the tool primitives; defer SDK surface work.** Considered. Rejected because the prompt-caching win (B1) is larger than the tool primitives' win combined, and both touch the same file in the same loop — splitting them doubles the review cost without shipping value sooner.

**3. Wrap the OpenAI SDK and lose OpenRouter-specific features.** Rejected. We'd lose `provider`, `transforms`, `plugins`, `usage.include`, and the reasoning controls — the bulk of Part B. `@openrouter/sdk` (B0) is the typed transport that doesn't have this problem.

**4. Build a separate `dispatchOpenRouterDeep` and keep current adapter as fallback.** Rejected. Two code paths is two-times the bug surface. Backward-compat via parameter defaults is cheaper than parallel implementations.

**5. Use `arc skills run --name web-search` on WEB-SEARCH rung instead of `:online`.** Considered. `:online` is one HTTP call vs. a tool-call round trip; for the OpenRouter path specifically it's strictly cheaper. The skill remains the right answer for Claude Code dispatches.

---

## Open Questions

1. **Sub-agent model selection.** Should `task` default to the parent's model, or default to a cheaper tier (e.g. parent=opus → sub-agent=sonnet)? Cheaper-by-default matches deepagents' implicit intent (sub-agents do bounded exploration) but risks quality regressions on hard sub-tasks. Suggested: default to one tier down from parent, allow override via `model` arg.

2. **Tool-calling capability gating.** Not every OpenRouter model supports tool calls — some (Kimi, MiniMax variants) advertise it but return malformed `tool_calls`. Should the adapter probe model capabilities at first use, or maintain a static `MODELS_WITHOUT_TOOLS` allowlist? Probing is per-task overhead; static list rots. Suggested: static list with a heuristic fallback (if the model emits a JSON tool call as plain content, parse it).

3. **Cache breakpoint placement on long tool-result chains.** With three breakpoints and 30 iterations, the rolling cache only catches the last 1–2 results. Worth exploring a "checkpoint every N iterations" strategy that pins specific results into cache, or accepting the rolling default.

4. **Should `write_todos` persist across sub-agent boundaries?** A sub-agent's `write_todos` is currently local to its run. Parent doesn't see it. This is consistent with sub-agent context isolation but may surprise users who expect a single global plan. Suggested: keep isolation; document explicitly.

5. **Interaction with ARC-0011 escalation ladder.** WEB-SEARCH rung activation should auto-add `:online` to the model ID for that attempt. Where does that logic live — in dispatch.ts (rung-aware dispatch routing) or in the adapter (rung passed as a parameter)? Suggested: dispatch.ts mutates the model ID at rung transition; adapter stays rung-agnostic.

6. **Filesystem tool sandboxing.** `write_file` outside cwd is gated by `ALLOW_OUTSIDE_CWD`. Should `read_file` have the same gate? Reading `/etc/passwd` is a low-risk leak in this threat model (Arc already has full shell access via `bash`), but tighter scoping is cheap. Suggested: read is unrestricted, write is cwd-only by default.

7. **`api_cost_usd` retention.** Once `usage.cost` is the source of truth, is the calculated `api_cost_usd` still useful for anything? It diverges from real cost by provider markup. Suggested: keep for cross-provider comparison (what would this have cost on direct Anthropic API), drop if no caller uses it after one cycle.

8. **Auto Router as a first-class task tier.** Should we expose `auto` alongside `opus`/`sonnet`/`haiku` in `MODEL_IDS` so tasks can be queued as `model = "auto"` (routes through `openrouter/auto`)? Tempting for fire-and-forget tasks but cost is unpredictable and the routed model isn't known at queue time — breaks the cost-budgeting heuristics we've built around model tier. Suggested: do NOT add as a top-level tier; allow opt-in via `openrouter:openrouter/auto` only, with a constrained `allowed_models` list (probably `["anthropic/*"]` to keep cost behavior recognizable).

9. **Slug-variant default per tier.** Once `:exacto` / `:nitro` / `:floor` are wired up, should specific Arc tiers default to a variant? Candidates: signal-filing sensors → `:nitro` (latency-sensitive); eval helpers → `:exacto`; cooldown-gated background → `:floor`. Defaults could be set in `MODEL_IDS` per tier. Suggested: defer one cycle — let task authors opt in explicitly first, observe which combinations get used, then promote winners to defaults.

10. **Prompt-cache breakpoint placement under Auto Exacto reordering.** Auto Exacto can move a request to a different provider mid-day as scores shift. Anthropic prompt caches are per-provider — a provider switch invalidates the cache. The breakpoint strategy from B1 assumes within-provider continuity that may not hold for a 30-iteration task spanning a few minutes. Worst case: cache misses on every iteration. Worth measuring once B1 and B0 ship; if hit rate is poor, pin provider via `provider.order` for cache-critical paths.

11. **Router Metadata in dispatch logs.** Should the `openrouter_metadata` object be persisted to `cycle_log` as a JSON column when enabled? It's the only place that surfaces "which provider actually served this request," which matters for the B4a measurement plan and for debugging provider-specific bugs. Suggested: add a `router_metadata` TEXT column to `cycle_log` (nullable, only populated when the debug flag is on), so we can correlate failures with providers without re-running.

---

## References

- `src/openrouter.ts` — current adapter (328 lines, single `bash` tool, raw fetch, no caching)
- `src/models.ts` — `OPENROUTER_PRICING` table to be deprecated as load-bearing accounting source
- OpenRouter agent-friendly docs index: `https://openrouter.ai/llms.txt` and `https://openrouter.ai/llms-full.txt`. Append `.md` to any docs URL for markdown. **Always fetch the live docs at implementation time** — the fields and defaults below drift.
- OpenRouter API docs:
  - Official TypeScript SDK: `https://openrouter.ai/docs/community/sdk`
  - Auto Router (`openrouter/auto`): `https://openrouter.ai/docs/guides/routing/routers/auto-router`
  - Auto Exacto (default-on for tool calls): `https://openrouter.ai/docs/guides/routing/auto-exacto`
  - Slug variants (`:exacto`, `:nitro`, `:floor`): `https://openrouter.ai/docs/guides/routing/model-variants/exacto`
  - Provider routing: `https://openrouter.ai/docs/guides/routing/provider-selection`
  - Model fallbacks: `https://openrouter.ai/docs/guides/routing/model-fallbacks`
  - Body Builder (`openrouter/bodybuilder`): `https://openrouter.ai/docs/guides/routing/routers/body-builder`
  - Router Metadata (experimental): `https://openrouter.ai/docs/guides/features/router-metadata`
  - Prompt caching: `https://openrouter.ai/docs/features/prompt-caching`
  - Usage accounting (`usage.cost`): `https://openrouter.ai/docs/use-cases/usage-accounting`
  - Web search (`:online`): `https://openrouter.ai/docs/features/web-search`
  - Transforms (`middle-out`): `https://openrouter.ai/docs/guides/features/message-transforms`
  - Reasoning tokens: `https://openrouter.ai/docs/use-cases/reasoning-tokens`
  - Auto Exacto announcement (impact data): `https://openrouter.ai/announcements/auto-exacto`
- langchain-ai/deepagentsjs — reference design for `write_todos` / filesystem / `task` primitives
- Anthropic prompt caching contract (transit unchanged via OpenRouter): `https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- ARC-0011 — escalation ladder; defines WEB-SEARCH rung that should auto-enable `:online`
