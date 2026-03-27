# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*
*Last updated: 2026-03-27T22:00Z (consolidated: folded Email/Partnership sections, removed MEMORY.md duplicates, merged API/config entries)*

## Architecture & Safety

- **Layered input validation:** Add validation at both acceptance layer (DB insert) and runtime enforcement (dispatch parse). Single-layer checks can be bypassed.
- **Unidirectional dependency: `src/` never imports `skills/`.** Runtime layer bootstraps skills at runtime, never compile-time. Bidirectional deps cause circular imports.
- **Explicit flag validation over string matching in error handlers:** Validate flags directly; string-match on error text breaks when text changes and misses correlated failures.
- **Monotonic state tracking for flaky external APIs:** Use `Math.max(current, latest)` with gap-fill logic. Eliminates hysteresis from stale nodes.
- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **File-backed shared state + atomic transactions for multi-process coordination:** Use file-backed storage with atomic writes and cross-process mergeState for state accessed by multiple processes. Wrap multi-table DELETEs in transactions. Tune STALE_NONCE_MS to domain assumptions (90s for Nakamoto finality, not 10min).
- **Security gate code review:** Audit for (1) fail-open bugs, (2) input validation, (3) null/boundary conditions, (4) auth vs authz separation.
- **DB migration three-phase pattern: prep/review → execute+snapshot → integrity check+auto-rollback.**
- **Schema constraints as fail-fast gates:** NOT NULL on semantically-required fields forces correct downstream handling; surfaces bugs earlier.
- **Genericization requires atomic cross-layer updates + consistent naming:** Must update config, schema, CLI, imports, and docs simultaneously. Use consistent scope qualifiers in ALL related functions; audit during component reviews.
- **Structured audit logs for architecture tracking:** Maintain time-series audit log entries ([OK]/[WATCH]/[INFO] tags). Archive entries >30 days old; keep active log ≤5 entries.
- **Agent-friendly error format + HTTP semantics:** Enforce "Error: [what]. Fix: [how]" consistently. Select semantically correct HTTP codes (409 conflict, 404 not found) over domain-specific repurposing.
- **Disabled-by-default for new middleware on shared request paths:** Ship gating features disabled with config flag for gradual rollout.

## Sensor Patterns

- **Gate → Dedup → Create with single authoritative quota:** All sensors use interval gate, entity-based dedup, then task creation with one clear daily quota. Multiple overlapping rate limits compound interaction bugs; trust per-entity dedup to prevent duplicates.
- **Sentinel gates + self-healing:** Write sentinel files during crises. Check operational health (test txn), not just endpoints. Cap queue creation per cycle.
- **Consolidate or cap redundant domain sensors:** >2 sensors monitoring same domain → consolidate. Use `--parent` on retry tasks.
- **Comprehensive multi-entity polling + per-beat allocation:** Fetch all categories/entities every cycle and rely on per-entity dedup. Allocate independent per-beat quotas with per-beat cooldown. Rotation logic adds complexity and creates gaps.
- **Rolling history initialization and delta tracking:** Initialize tracking fields (e.g., `lastContentTypeDist`) on first run before delta logic consumes them; uninitialized fields cause silent API skips. Maintain rolling window in hook-state for delta computation across cycles.
- **Per-entity+event-type composite-key cooldowns:** Use `collection:event-type` composite keys for independent cooldowns per pair.
- **Document rate-limit failure modes in SKILL.md:** When a sensor is gated by API rate limits (per-beat cooldowns, per-entity windows, etc.), add a "Filing Failures" or "Expected Failures" section to SKILL.md. Document the cooldown duration, expected failure mode, and recovery behavior. This prevents retrospectives from misinterpreting rate-limit failures as execution bugs.
- **Raw-data-dispatch architecture:** Sensors return structured raw data; dispatch LLM composes content. Decouples domain knowledge from output format.
- **Proactive deadline-critical task filing over sensor auto-filing:** For hard deadlines, queue explicit P2+ task in the critical window. Sensor auto-filing can be pre-empted by queue load or timeouts.
- **Bare queue natural replenishment over manual injection:** When queue falls to 2–3 items, don't manually create injection tasks. Sensors naturally replenish on their next cycle. Manual injection risks queue flooding and disrupts natural sensor-paced work cadence.
- **Decompose orchestration + per-signal tasks:** File each signal as individual task; decompose multi-operation sensors into per-operation subtasks. Batching blocks the queue and misses parallelization.
- **Disaggregate success rates and error metrics by code path:** Aggregate metrics mask path-specific failures. Track verdict counters separately per source layer.
- **Explicit content-keyword→skill mappings:** Define keyword arrays in sensors that trigger skill loading. Prevents context-loading gaps when message types carry domain keywords.
- **Percentage-change signals require absolute floor gates:** Relative thresholds alone (>20% change) create noise in low-value ranges (e.g., 2→3 sat/vB is 50% but trivial). Gate: `if (newValue < MIN_FLOOR && oldValue < MIN_FLOOR) return skip` before percentage check. Minimum floor differs per domain (fees: 10 sat/vB, volume: X sats).

## Task & Model Routing

- **Bulk-audit shared code paths for missing required fields** when one sensor/CLI creates a broken task.
- **Explicit model selection independent of priority.** Every task must specify `model`.
- **Presentation/audience-facing work routes to Opus minimum.**
- **Business-critical time-bound work escalates tier.** Deadline <48h AND impact >$1000 → Opus minimum.
- **Designated stakeholder communications route to Opus minimum.** Email/messages from whoabuddy and critical internal partners → Opus routing in sensor, independent of nominal priority. Partnership quality and trust warrant high-tier execution.
- **Multi-skill composition in triage decomposition:** Include both primary domain skills and supporting meta skills in each task's `skills` array.
- **Research task sourcing from external URLs:** For bulk link research (3+ items), create individual tasks per link. Always specify output format in task description.
- **Strategic research synthesis for infrastructure topics:** When researching external expert analysis of verification/infrastructure/agent design, structure findings as: thesis → technical foundation → landscape comparisons → Arc alignment → evolution vectors + effort estimates + competitive implications. Transforms passive research into strategic planning input for architecture decisions.
- **Task-type-specific context loading:** Retry tasks and relay notifications carry keywords that DON'T indicate execution-skill needs; gate skill loading on content-type, not keyword presence.

## Task Chaining & Precondition Gates

- **Multiple related tasks hit source dedup: use --parent instead.** Approval-blocking work → P1 Opus minimum.
- **Task supersession must close superseded tasks explicitly:** Close with `status=failed, summary="superseded by task #X"` before completing your own work.
- **Gap identification during batch work:** Enumerate gaps during execution; queue P3–P6 follow-ups with `--parent` same cycle.
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. Provide exact `arc creds set` CLI command.
- **Verify event premise before spawning derivative tasks:** Use persistent artifacts (git history, source files, DB records), not session memory.
- **Premise validation before cleanup/removal work:** When asked to remove, clean, or delete X, verify it actually exists through exhaustive source + runtime search before executing. Prevents wasted effort and surfaces stale requirements.
- **Multi-layer search methodology for hard-to-find references:** When searching for strings across a complex system, check comprehensively in order: HTML templates → JS/CSS → backend server code → API responses → rendered output. Single-layer searches miss hidden references (templating, dynamic generation, API-fed data).
- **Task source attribution:** Set source (`task:<parent_id>`) for derived tasks. Source=null bypasses domain constraints.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Sentinel bulk-close on relay-health cascade:** When writing a sentinel, immediately bulk-close all pending tasks of the same type.

## Integration Patterns

- **Cascading cleanup on multi-table transaction cancellation:** When a stateful operation spans multiple tables (e.g., replay tracking + replay_buffer), ensure cancellation deletes from all tables. Missing a DELETE statement orphans state and breaks idempotency on retry.
- **Health endpoint scope isolation:** Surface only high-level state + recommendations in `/health`; route diagnostics to `/state`, `/diagnostics`.
- **Configuration consistency validation across layers:** Grep for settings and constants across docs, code defaults, schema, and env vars; mismatches create silent policy violations. When docs reference implementation constants (e.g., `string-ascii 10`), verify against actual code during API audits.
- **Payment tier routing via route-specific middleware:** When adding a payment tier to a shared API, inject payment middleware at specific routes (not globally). Use header-based verification to allow routes to opt-in; free routes meter normally while paid routes bypass metering.
- **DRY in multi-module systems:** Extract repeated functions to shared utils; merge multi-consumer reads into single-pass loaders. Support env var overrides at every config field.
- **Credential patterns:** Never pass secrets via CLI flags. Use identical service/key names across sensor/CLI/creds layers. Validate at health-check time, not first API call.
- **Idempotent setup with secure scaffolding:** Skip existing resources; create credential files with mode 0600; use `.template` files with parameter substitution.
- **API version/auth migration requires coordinated client updates:** Update all callers simultaneously with phase/state gates.
- **X/Twitter content fetching requires fxtwitter API fallback:** x.com requires JS rendering; WebFetch cannot handle it. Use api.fxtwitter.com for JSON embeds without JS. Falls back gracefully for archived/deleted posts.
- **BIP-137 outbox unreliable for batch operations:** ~75% of message threads return HTTP 500 from the outbox API (server-side, unrelated to content/length). Use only as fallback for individual replies to received messages. Do not plan as a bulk broadcast mechanism.
- **Component audit methodology:** Export metadata as queryable JSON. Classify: shared/agent_specific/runtime_builtin/delete. Delete-safe: unused 30+ days + zero refs.
- **Multi-domain feature parameterization via explicit CLI flags:** Add `--beat` params; make hook-state keys composite; extract domain logic into beat-scoped functions.
- **Verification/audit skills: sensor-free, CLI-first.** File discovery via explicit CLI params, never auto-scan.
- **API field aliasing for backwards compatibility:** Accept both legacy and new field names via nullish coalesce: `newFieldName ?? legacyFieldName`.
- **Idempotency via existing operations over custom dedup:** Route through existing upsert operations (INSERT OR IGNORE) rather than bespoke duplicate-checking logic.
- **Stale skill references after deletion:** When a skill is removed, grep all SKILL.md files and docs. Update references to replacement or remove if no replacement.
- **Large-scale architectural concept removal requires phased execution + cross-layer audit:** When removing pervasive concepts (identity patterns, infrastructure patterns, agent models), audit impact across all layers (SOUL/CLAUDE/MEMORY, frameworks, skills, templates, docs, web UI) before starting. Execute in phases by layer, commit phase completions separately, and run `/simplify` + syntax validation after all deletions to catch dangling references and dead code.
- **Resource cleanup + idempotency across side-effect boundaries:** When a function performs an irreversible op (mempool broadcast, API call), wrap post-side-effect code in try/catch and explicitly release acquired resources on error. Before retrying a partial success, verify the operation didn't already complete.
- **Dedup ordering for idempotent correctness:** Apply dedup in order of broadest scope first. Transaction-level before sender-level.
- **Cross-layer constraint validation on integration:** Configuration minimums at one layer (e.g., KV TTL=60s) can silently break assumptions in dependent layers (retry logic expecting 10s). Enumerate and validate parity across boundaries.
- **Per-endpoint API validation and response parity + state consolidation:** List and single-entity endpoints must include identical field sets; audit for parity. When refactoring distributed state logic (e.g., nonce lifecycle, queue semantics) from per-endpoint handlers into shared operations, verify per-endpoint state transitions remain consistent and idempotency is preserved across both consolidated and original paths. Endpoints in the same service vary in response format and may fail independently — implement endpoint-specific parsers with fallback sources when primary returns 404/wrong format.
- **PreToolUse hooks for blocking tool auto-answer:** Gate AskUserQuestion with PreToolUse hooks that pattern-match question type and provide safe defaults.
- **Message encoding for cryptographic signatures:** Use `printf "%s"` instead of `echo` when preparing message strings for signing. `echo` adds trailing newline that verification includes.
- **Environment variables for external signing tools:** Signing ops require explicit NETWORK=mainnet/testnet. Tool-env mismatch with API expectations causes silent verification failure.
- **Partnership marginal-cost evaluation:** Zero marginal cost (existing cadence + minor CTA addition) = YES; requires new execution path = defer.
- **Spec-first skill creation for external integrations:** Create SKILL.md spec first to lock in decision. Queue CLI implementation as separate follow-up task.
- **DB migration error transparency + FK constraint ordering:** Never wrap version advancement in try/catch. Advance version only after successful completion to ensure failed migrations retrigger. For multi-table deletes with FK constraints, migrate/rename dependent records first (INSERT OR IGNORE), then delete parent tables — ordering ensures idempotency and surfaces failures immediately.

## Claims, Git & State

- **Live deployment divergence:** Check live site AND source HEAD. Services don't auto-reload — restart after commits.
- **Proof over assertion:** Verify claims against authoritative sources before publishing.
- **Circuit breaker state latch bug pattern:** State setters must be conditional on whether the condition *still exists*, not just the triggering event.
- **Half-open timer initialization prevents perpetual open state:** In half-open circuits, only arm the timeout on initial closed→open transition; never re-arm on every invocation when already open. Re-arming on every check causes timeout to never fire when the failure condition persists, leaving the circuit permanently open under sustained load.
- **Circuit breaker outcomes vs errors:** Failure counter increments only on true availability errors (network failures, 5xx, timeouts, malformed responses). Business-level outcomes (200 OK with "failed"/"replaced" fields, 402 payment required) are valid responses and should not trigger the breaker.
- **Symmetric state ownership at integration points:** Enforce single source of truth; audit all callers during integration to prevent process-level state divergence.
- **Code review methodology:** Scan diffs → trace call stack → verify fix spans all layers (including shared logic callers). Mark each item [blocking] or [suggestion]. When CI already comments a PR, Arc must not add its own review comments. Multi-reviewer scenarios: enumerate ALL feedback items (whoabuddy + automated) before verifying fixes — prevents feedback from being overlooked in large diffs. Changes_requested re-review: verify each original feedback item addressed; CI green before approving.
- **Defer minor suggestions on approved PRs:** If blocking issues fixed + CI passing + no merge conflicts, defer [suggestion] items.
- **Automation-generated PR review:** Validate (1) CI all green, (2) schema/format correctness, (3) no merge conflicts. Don't critique auto-generated prose.
- **Destructive operation review:** Require `--confirm` flag as functional gate (not just advisory text). Verify snapshot-before-delete and scope validation.
- **Frontend PR review — three-layer gate:** (1) XSS prevention (textContent→innerHTML, encodeURIComponent); (2) design tokens, dark mode, responsive; (3) pagination/scalability flags.

## Quest & Complex Analysis

- **Multi-phase quest structure for 100+ item reviews:** Triage/scoping → validation → cross-reference → synthesis → manifest. Each phase commits artifacts.
- **Pre-planning stakeholder clarification over post-planning rework:** Email stakeholder with decision questions BEFORE queuing execution.
- **Multi-phase quest projected cost checkpoint after phase 1:** $3–5/phase for Opus; if projected total >$15, escalate before proceeding.
- **Quest phase state verification before closure:** Verify state transition persisted via API or DB check BEFORE closing the task.
- **Skip infrastructure-blocking phases in multi-phase quests:** When a quest phase relies on unstable infrastructure (relay CB, API outages), skip that phase and advance to next. Mark skipped phases and their reason in result_summary. Retry blocked phases after infrastructure stabilizes rather than blocking entire quest on transient failures.

## State Machine & Recovery Patterns

- **Context merge vs replace in state transitions:** Always merge (`{...existing, newField}`) rather than replace.
- **Compound state recovery via dispatch branches + observability counters:** Add explicit `else if (stateA && stateB)` recovery branches. Add verdict counters to surface new paths in logs.
- **Incremental recovery over state-machine rewrite:** Add targeted recovery branches to existing loops. >30 lines of recovery code signals the loop itself needs refactoring.

## Memory & Knowledge Architecture

- **Temporal tagging for self-describing memory entries:** Use inline tags ([STATE:], [EXPIRES:], [PATTERN: validated]) to make lifecycle state and relationships explicit and automatable.
- **Category-based memory with selective dispatch load:** Organize into categories with lifecycle policies; load only categories relevant to task's skill context.
- **Auto-supersession logic for memory maintenance:** Same-slug updates → mark old entry [SUPERSEDED] + add [SUPERSEDES] cross-reference to new entry.

## Operational Rules

- **Deprecated field cleanup scheduling:** Mark fields with post-event cleanup dates rather than immediate deletion. Queue cleanup task for explicit date.
- **High-leverage root-cause fix prioritization:** Single critical root-cause fix > bulk-killing individual failures.
- **Retrospective queue gatekeeping:** result_summary must include queue actions. Check bulk-kill events before treating high failure counts as incidents.
- **Separate infrastructure failures from execution failures in metrics:** Tag external infrastructure failures separately. High infra failure count does not indicate broken execution logic.
- **Pre-event queue discipline (<24h to deadline):** Proactively close stale/blocked tasks (no recovery path, 7+ days pending).
- **Cross-sensor parity check for shared gates:** Audit pre-check logic in actual code, not docs.
- **Sensor disabling on unresolved backlog + unreliable sources:** >50 pending tasks from blocked sensor → disable + bulk-close + P3 root-cause task. 2+ consecutive source failures → P3 source-replacement task with alternate.
- **Failure rule:** Root cause first, no retry loops. Persistent external blocker → mark failed, create P8 follow-up.
- **Strategic reviews escalate time-bound work to P1.** Don't rely on daily dispatch to catch imminent deadlines.
- **Multi-wave deprecation with external gating:** Wave 1: delete unused immediately; Wave 2: gate replacement on external trigger.
- **Category rotation verification in time-bound events:** Explicitly verify all buckets are fetched before competitive window closes. Queue P3 verification task mid-event.
- **Infrastructure recovery with health-gated sentinel clearing:** After fixing critical infrastructure issues (e.g., circuit breaker reset), verify comprehensive operational health (pool capacity, conflict count, error queues, not just endpoint availability) before clearing gate sentinels. Sentinel clearing allows downstream sensors to self-heal on their next polling cycle — explicit reactivation tasks are unnecessary and can mask persistence of the underlying issue.
- **Dispatch gate auto-recovery on usage windows:** When dispatch fails due to usage limits (3 consecutive failures → dispatch-gate stops), it auto-recovers when the usage limit window resets (typically 1pm MDT). Check gate status before escalating manually — `db/dispatch-lock.json` will show `status: "running"` when recovery has occurred. Email escalations may arrive after auto-recovery has already succeeded.
- **Email request completion workflow:** When queuing work from email request, immediately mark email read and reply confirming action. Prevents duplicate processing.
- **Infrastructure change prerequisites:** Before queuing P3+ execution tasks for infrastructure/payment system changes (ALB, x402 relay), verify credentials exist in store and explicitly confirm with stakeholder. Reply confirming prerequisites checked before queuing execution task. Prevents downstream failures from missing config.
- **Stakeholder request decomposition:** Decompose into triage (same cycle) + execution tasks. Stakeholder-directed architecture overrides defaults.
- **Email intake batching by skill domain:** When routing email with multiple content types, batch by execution skill rather than individual items.
- **Bulk x402 transaction waves trigger relay circuit breaker:** Sending 40+ x402 transactions in rapid succession from concurrent cycles creates mempool nonce gaps and re-opens relay CB, blocking subsequent reliable sends. Limit bulk sends to <10/batch; prefer async fallback paths (BIP-137 outbox) when bulk infrastructure becomes unstable.
