# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*
*Last updated: 2026-03-26T13:51Z (added 3 patterns from x402-sponsor-relay re-review: resource cleanup after side effects, idempotency verification, paired terminal state transitions)*

## Architecture & Safety

- **Layered input validation:** Add validation at both acceptance layer (DB insert) and runtime enforcement (dispatch parse). Single-layer checks can be bypassed.
- **Unidirectional dependency: `src/` never imports `skills/`.** Runtime layer bootstraps skills at runtime, never compile-time. Bidirectional deps cause circular imports.
- **Explicit flag validation over string matching in error handlers:** Validate flags directly; string-match on error text breaks when text changes and misses correlated failures.
- **Monotonic state tracking for flaky external APIs:** Use `Math.max(current, latest)` with gap-fill logic. Eliminates hysteresis from stale nodes.
- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **File-backed shared state for multi-process coordination:** When implementing state accessed by multiple processes/modules (e.g., nonce tracking from builder.ts, x402.ts, sponsor-builder.ts, wallet.ts), use file-backed storage with atomic writes and cross-process mergeState logic. Tune consensus-window timeouts (STALE_NONCE_MS) to domain assumptions (90s for Nakamoto finality, not 10min). Prevents in-memory divergence.
- **Transaction wrapping for cascade deletes:** Wrap multi-table DELETEs in a transaction. Intermediate failures leave DB partially-deleted without it.
- **Security gate code review:** Audit for (1) fail-open bugs, (2) input validation, (3) null/boundary conditions, (4) auth vs authz separation.
- **DB migration three-phase pattern: prep/review → execute+snapshot → integrity check+auto-rollback.**
- **Schema constraints as fail-fast gates:** NOT NULL on semantically-required fields forces correct downstream handling; surfaces bugs earlier.
- **Genericization requires atomic cross-layer updates:** Must update config, schema, CLI, imports, and docs simultaneously.
- **Function naming consistency:** Use consistent scope qualifiers in ALL related functions. Audit related functions during component reviews.
- **Structured audit logs for architecture tracking:** Maintain time-series audit log entries ([OK]/[WATCH]/[INFO] tags) recording resolved tech debt, verified assumptions, and pending work post-refactor. Prevents knowledge loss across cycles and coordinates multi-cycle cleanup (e.g., deprecated field removal, sensor pattern migration). Archive entries >30 days old; keep active log ≤5 entries.
- **Agent-friendly error format — "Error: [what]. Fix: [how]":** Enforce consistently across all error paths (dispatch, CLI, sensors, startup).
- **API error response consistency + HTTP semantics:** Enumerate all affected code paths; verify each includes identical diagnostic fields. Select semantically correct HTTP codes (409 for conflict, 404 for not found) over domain-specific repurposing.
- **Disabled-by-default for new middleware on shared request paths:** Ship gating features disabled with config flag for gradual rollout.

## Sensor Patterns

- **Gate → Dedup → Create + resource cap:** All sensors use interval gate, entity-based dedup, then task creation. Check daily caps before insertTask(); skip when at capacity.
- **Single authoritative quota over layered rate limits:** Multiple overlapping rate limits (MAX per run + global cooldown + daily cap) create unexpected compound bottlenecks. Better to have one clear quota (e.g., daily allocation) and trust per-entity dedup to prevent duplicates. Layered limits compound interaction bugs without adding safety.
- **Sentinel gates + self-healing:** Write sentinel files during crises. Check operational health (test txn), not just endpoints. Cap queue creation per cycle.
- **Consolidate or cap redundant domain sensors:** >2 sensors monitoring same domain → consolidate. Use `--parent` on retry tasks.
- **Comprehensive multi-entity polling over rotation:** Fetch all categories/entities every cycle and rely on per-entity dedup (pendingTaskExistsForSource). Rotation logic adds complexity and creates gaps where infrequent categories fall behind. Single authoritative quota (daily cap) is the only gate needed.
- **Rolling history for trend/anomaly detection:** Maintain rolling window in hook-state for delta computation and pattern detection across cycles.
- **Per-entity+event-type composite-key cooldowns:** Use `collection:event-type` composite keys for independent cooldowns per pair.
- **Raw-data-dispatch architecture:** Sensors return structured raw data; dispatch LLM composes content. Decouples domain knowledge from output format.
- **Per-beat allocation with time-windowed overflow:** Allocate independent per-beat quotas with per-beat cooldown tracking. Enable overflow reallocation after OVERFLOW_HOUR_UTC.
- **Proactive deadline-critical task filing over sensor auto-filing:** For operations with hard deadlines (daily caps, timed competitions), don't rely on sensor background logic—queue explicit P2+ task in the critical window. Sensor auto-filing can be pre-empted by queue load or timeouts; deadline work must be human-visible and dispatch-scheduled.
- **Decompose orchestration work to avoid timeouts:** Sensor tasks that orchestrate multiple sequential operations (multi-category rotation, multi-beat aggregation) should decompose into per-operation subtasks. Avoids 15min timeout overhead of sequential I/O and enables parallel dispatch execution. Single large cycle timeout → N smaller independent cycles.
- **Per-signal tasks over batch dispatch:** File each signal as individual task (one signal → one dispatch cycle), not multiple signals per task. Batching wastes expensive Opus slots, blocks the queue, and misses parallelization; individual tasks enable parallel dispatch and lower cost-per-signal.
- **Disaggregate success rates and error metrics by code path:** Aggregate metrics mask path-specific failures. Track verdict counters separately per source layer.
- **Explicit content-keyword→skill mappings:** Define keyword arrays in sensors (e.g., `EDITORIAL_KEYWORDS = ["ordinals business", "aibtc news"]`) that trigger skill loading. Prevents context-loading gaps when message types carry domain keywords but don't indicate execution-skill needs.

## Task & Model Routing

- **Bulk-audit shared code paths for missing required fields** when one sensor/CLI creates a broken task.
- **Explicit model selection independent of priority.** Every task must specify `model`.
- **Presentation/audience-facing work routes to Opus minimum.**
- **Business-critical time-bound work escalates tier.** Deadline <48h AND impact >$1000 → Opus minimum. For deadline-critical operations that would timeout on Sonnet (multi-category rotation, multi-beat aggregation), use Opus proactively; cost of model upgrade ($0.20–0.30) << cost of missed deadline.
- **Multi-skill composition in triage decomposition:** Include both primary domain skills and supporting meta skills in each task's `skills` array.
- **Research task sourcing from external URLs:** For bulk link research (3+ items), create individual tasks per link instead of batching to avoid timeouts and enable parallel dispatch execution. Use `--parent` to link back to request task. Smaller batches (1-2 links) can be combined. Always specify output format (ISO8601, JSON, etc.) in task description to prevent downstream friction.
- **Task-type-specific context loading:** Retry tasks and relay notifications carry topic/message keywords that DON'T indicate execution-skill needs; gate skill loading on content-type, not on keyword presence. Add exclusions (e.g., `"Retry:"` prefix skip-list) to context validators.

## Task Chaining & Precondition Gates

- **Multiple related tasks hit source dedup: use --parent instead.** Approval-blocking work → P1 Opus minimum.
- **Task supersession must close superseded tasks explicitly:** Close with `status=failed, summary="superseded by task #X"` before completing your own work.
- **Gap identification during batch work:** Enumerate gaps during execution; queue P3–P6 follow-ups with `--parent` same cycle.
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. Provide exact `arc creds set` CLI command.
- **Verify event premise before spawning derivative tasks:** Use persistent artifacts (git history, source files, DB records), not session memory.
- **Task source attribution:** Set source (`task:<parent_id>`) for derived tasks. Source=null bypasses domain constraints.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Sentinel bulk-close on relay-health cascade:** When writing a sentinel, immediately bulk-close all pending tasks of the same type with `status=failed, summary="sentinel-bulk-close"`. Pre-queued tasks bypass sentinel creation gates.

## Integration Patterns

- **Health endpoint scope isolation:** Surface only high-level state + recommendations in health endpoints (`/health`); route detailed diagnostics to separate endpoints (`/state`, `/diagnostics`). Prevents clients from parsing implementation details and simplifies endpoint evolution.
- **Configuration consistency validation across layers:** When docs, code defaults, schema, and env vars specify the same setting, validate consistency. Grep for setting across all layers; mismatches create silent policy violations.
- **DRY in multi-module systems — shared utils + single-pass loading + config parsing:** Extract repeated functions to shared utils; merge multi-consumer reads into single-pass loaders. Support env var overrides at every config field.
- **Credential patterns:** Never pass secrets via CLI flags. Use identical service/key names across sensor/CLI/creds layers. Validate at health-check time, not first API call.
- **Idempotent setup with secure scaffolding:** Skip existing resources; create credential files with mode 0600; use `.template` files with parameter substitution.
- **API version/auth migration requires coordinated client updates:** Update all callers simultaneously with phase/state gates to prevent operations in wrong cycle state.
- **Component audit methodology:** Export metadata as queryable JSON. Classify: shared/agent_specific/runtime_builtin/delete. Delete-safe: unused 30+ days + zero refs.
- **Multi-domain feature parameterization via explicit CLI flags:** Add `--beat` params; make hook-state keys composite (`editorial:ordinals`); extract domain logic into beat-scoped functions. Gate routing on relevance AND domain-keyword match.
- **Verification/audit skills: sensor-free, CLI-first.** Implement as pure CLI skills. File discovery via explicit CLI params, never auto-scan.
- **API field aliasing for backwards compatibility:** Accept both legacy and new field names via nullish coalesce: `newFieldName ?? legacyFieldName`.
- **Idempotency via existing operations over custom dedup:** Route through existing upsert operations (INSERT OR IGNORE) rather than bespoke duplicate-checking logic.
- **Stale skill references after deletion:** When a skill is removed, grep all SKILL.md files and docs for the skill name. Update references to point to replacement skill or remove if no replacement. Stale refs in docs can guide dispatch to add invalid skills.
- **Explicit recovery parameters for transaction sequencing:** Expose optional explicit parameters in transaction functions (e.g., `transferStx(..., explicitNonce)`) to enable gap recovery without altering normal transaction flow. Use designated addresses (can't-be-evil) for gap-fill targets. Decouples recovery from normal sequencing.
- **Resource cleanup after side-effect boundaries:** When a function successfully performs an irreversible operation (broadcast to mempool, file written, API call with side effects) but fails during subsequent operations (parsing, state persistence), the acquired resource (nonce, sponsor slot, rate-limit token) must be explicitly released in error handlers. Post-side-effect code must be wrapped in try/catch.
- **Idempotency verification across retry boundaries:** Before retrying an operation that succeeded partially (tx broadcast but storage failed), verify state to prevent duplicate side effects. Check if the operation already occurred; if yes, skip re-execution and proceed directly to recovery (e.g., check if tx was broadcast before re-sponsoring).
- **Paired terminal state transitions in queue drains:** When consuming/acking a queue message as terminal (MAX_ATTEMPTS exhausted), coordinate both external acknowledgment (message ack/nack to broker) and internal state update (mark in DB as failed). Mismatch leaves records orphaned. Use transactions when possible.
- **API response completeness across related endpoints:** Endpoints serving the same entity (list vs. single-entity views) must include identical field sets. Audit for parity; missing fields in one layer force client workarounds and create cache inconsistencies.
- **Cascading template updates on API field additions:** When adding a field to API responses, update all consuming template layers in parallel (list cards, detail modals, CSS). Incomplete updates leave data inaccessible or unstyled.

## Claims, Git & State

- **Live deployment divergence:** Check live site AND source HEAD. Services don't auto-reload — restart after commits.
- **Proof over assertion:** Verify claims against authoritative sources before publishing.
- **Circuit breaker state latch bug pattern:** State setters must be conditional on whether the condition *still exists*, not just the triggering event.
- **Symmetric state ownership at integration points:** When integrating shared-state components across modules, enforce single source of truth: x402.ts imports getNextNonce from builder.ts rather than maintaining duplicate nonce tracking. Audit all callers during integration to prevent process-level state divergence. Mixed local+imported tracking causes reconciliation failures.
- **Code review: verify fixes, label items, dedup CI comments:** Scan diffs → trace call stack → verify fix spans all layers. **For fixes involving shared logic (calculation, state validation), verify that all callers use the identical function, not reimplemented versions.** Mark each item [blocking] or [suggestion]. When CI already comments a PR, Arc must not add its own review comments.
- **Changes_requested re-review gate:** When re-reviewing after changes_requested, enumerate each original feedback item; verify each is addressed in the diff; require CI green before approving. Prevents rubber-stamping and ensures systematic verification.
- **Two-pass review for state machines with error paths:** For queue consumers or state machines with critical error paths, conduct second pass targeting exception handlers, retry boundaries, and resource cleanup. Early feedback typically addresses logic/auth; edge-cases (nonce leaks, double-operations on retry, zombie states from dead-letter) emerge in error-path pass. Document per phase-scope (safe to defer vs. must-fix blockers).
- **Defer minor suggestions on approved PRs:** If blocking issues fixed + CI passing + no merge conflicts, defer [suggestion] items as courtesy feedback; don't block merge.
- **Automation-generated PR review:** Validate (1) CI all green, (2) schema/format correctness, (3) no merge conflicts. Don't critique auto-generated prose.
- **Destructive operation review:** Require `--confirm` flag as functional gate (not just advisory text). Verify snapshot-before-delete and scope validation.
- **Frontend PR review — three-layer gate:** (1) XSS prevention (textContent→innerHTML, encodeURIComponent); (2) design tokens, dark mode, responsive; (3) pagination/scalability flags.

## Email & Coordination Patterns

- **External confirmation gates + draft-first:** Verify current state before queuing. Queue draft → approval → publish.
- **Stakeholder request decomposition:** Decompose into triage (same cycle) + execution tasks. Stakeholder-directed architecture overrides defaults.
- **Urgent stakeholder emails: immediate reply + escalation queue.** Acknowledge + state action plan. Don't mark complete until follow-up task is queued.
- **Infrastructure health verification before escalation:** Verify live endpoint health; self-healing may have resolved the issue. Operator-reported mismatch signals state latch, not service failure.
- **Approval + downstream request = skip intermediate review:** Queue single P3+ delegation task for both.
- **Email request completion workflow:** When queuing work from email request, immediately mark email read and reply confirming action (task ID + brief summary). Prevents duplicate processing and maintains stakeholder awareness.
- **Email intake batching by skill domain:** When routing email with multiple content types (X links + blog + arxiv), batch by execution skill rather than individual items. Treats intake as routing/confirmation layer; execution layer can further decompose per-item if needed. Respects domain boundaries and decouples routing confirmation from execution parallelization.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.
- **Agent resumption requires capability audit and routing review:** Update memory; audit pending work from downtime; verify task routing matches updated capability set.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Backlog growth is bottleneck signal:** >20 pending → redistribute. Periodic triage clears 10-20%.

## Quest & Complex Analysis

- **Multi-phase quest structure for 100+ item reviews:** Triage/scoping → validation → cross-reference → synthesis → manifest. Each phase commits artifacts.
- **Pre-planning stakeholder clarification over post-planning rework:** Email stakeholder with decision questions BEFORE queuing execution.
- **Multi-phase quest projected cost checkpoint after phase 1:** $3–5/phase for Opus; if projected total >$15, escalate before proceeding.
- **Quest phase state verification before closure:** Verify state transition persisted via API or DB check BEFORE closing the task. False completions occur when state-write fails silently.

## State Machine & Recovery Patterns

- **Context merge vs replace in state transitions:** Always merge (`{...existing, newField}`) rather than replace. Replacement loses upstream data downstream transitions depend on.
- **Compound state recovery via dispatch branches + observability counters:** Add explicit `else if (stateA && stateB)` recovery branches rather than catch-all fallthrough. Add verdict counters to surface new paths in logs.
- **Incremental recovery over state-machine rewrite:** Add targeted recovery branches to existing loops. >30 lines of recovery code signals the loop itself needs refactoring.

## Memory & Knowledge Architecture

- **Temporal tagging for self-describing memory entries:** Use inline tags ([STATE:], [EXPIRES:], [PATTERN: validated]) to make lifecycle state and relationships explicit and automatable.
- **Category-based memory with selective dispatch load:** Organize into categories with lifecycle policies; load only categories relevant to task's skill context.
- **Auto-supersession logic for memory maintenance:** Same-slug updates → mark old entry [SUPERSEDED] + add [SUPERSEDES] cross-reference to new entry.

## Operational Rules

- **Deprecated field cleanup scheduling:** Mark fields with post-event cleanup dates rather than immediate deletion. Queue cleanup task for explicit date.
- **High-leverage root-cause fix prioritization:** Single critical root-cause fix > bulk-killing individual failures.
- **Retrospective queue gatekeeping:** result_summary must include queue actions: killed X stale tasks, queued Y next-phase tasks. Check bulk-kill events before treating high failure counts as incidents.
- **Pre-event queue discipline (<24h to deadline):** Proactively close stale/blocked tasks (no recovery path, 7+ days pending).
- **Cross-sensor parity check for shared gates:** Audit pre-check logic in actual code, not docs. Inconsistency causes failures in high-stakes periods.
- **Sensor disabling on unresolved backlog:** >50 pending tasks from blocked sensor → disable + bulk-close + P3 root-cause task.
- **Unreliable data sources trigger replacement, not retries:** 2+ consecutive failures → P3 source-replacement task with alternate source.
- **Failure rule:** Root cause first, no retry loops. Persistent external blocker → mark failed, create P8 follow-up.
- **Strategic reviews escalate time-bound work to P1.** Don't rely on daily dispatch to catch imminent deadlines.
- **Multi-wave deprecation with external gating:** Wave 1: delete unused immediately; Wave 2: gate replacement on external trigger (service restart, feature readiness).
- **Category rotation verification in time-bound events:** Explicitly verify all buckets are fetched before competitive window closes. Queue P3 verification task mid-event.
