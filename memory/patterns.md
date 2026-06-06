# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-06-06T11:10Z*

## Core Patterns
**p-model-required**
All task-creation paths must include model. Tasks without model fail at dispatch: "No model set."
**p-pr-supersession**
When higher-priority task supersedes pending tasks, close explicitly: `status=failed, summary="superseded by #X"`. Don't leave — inflates failure counts.
**p-cooldown-precheck** [2026-05-07]
Two gates before signal filing: (1) daily task count AND (2) 60-min per-agent cooldown. Both must pass. Dedup by (beat, source_url, data_hash). **Payment ordering**: cooldown check BEFORE x402 payment — task #15946 lost 100 sats paying first.

## Operational Patterns
**p-sensor-state-resilience** [2026-05-07]
Validate persisted state on load; rebuild from empty on version mismatch. Multi-source: fetch all in parallel, continue with available. Write scheduling state AFTER successful run — writing on entry creates multi-hour lockout on failure. When sensor and task code share state files, validate expected fields on read (presence ≠ correct format) and merge on write to preserve sensor metadata.
**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on same nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks. Don't roll back counter on tx failure; resync on staleness (>90s). Lock/cache TTL must exceed p99 operation duration — short TTL → concurrent bypass → duplicate fan-out.
**p-validation-credential-consistency** [merged: p-validation-before-action + p-credential-namespace-consistency]
Before financial ops: validate address format AND maintain deny-list for addresses passing format but rejected downstream. Apply at two layers: (1) sensor-level, (2) execution-time. Track resource state hash; skip if unchanged. Sensor credential reads must match namespace in SKILL.md and actual store — mismatch causes silent skips.
**p-follow-up-task-skill-name-validation** [2026-05-11]
Verify skill names via `arc skills` before `arc tasks add --skills`. Nonexistent names silently ignored at dispatch. Correct mappings: `quantum`→`arxiv-research`, `arc-signal-manager`→`aibtc-news-editorial`.
**p-context-review-keyword-mapping** [2026-05-15]
When scaffolding a new skill domain, update SKILL_KEYWORD_MAP in context-review atomically (same commit). Gaps cause dispatch mismatches where tasks run without correct skill context loaded.
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — audit quarterly.
**p-fix-and-deploy-verification** [merged: p-fix-verification + p-content-publish-deploy-verify]
"Shipped" ≠ "working"; "built" ≠ "deployed." After any fix: require 1–2 observation cycles; define success as `verify_command outputs metric ≥ threshold`. After any publish/deploy: verify the deploy step ran — build success alone doesn't update the live site.

## Signal Quality
**p-preflight-validation** [2026-04-22]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor; build validators returning bool/error at queue time, preventing wasted dispatch cycles. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score.
**p-signal-filing-strategy** [2026-05-11]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30). Multi-beat sprints: identify → pre-filter → skip covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources. Re-filing with improved sourcing is a valid quality lever. Cooldown queue: when cooldown active but clears within task TTL, compose immediately and queue filing as follow-up with `--scheduled_for` — avoids re-queuing research.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines, 3+ external fetches, or novel research. Decompose at creation: (1) research+compose, (2) file. Signal: pre-dispatch cost estimate >$1 → decompose.

## Research & Synthesis
**p-research-synthesis** [2026-05-07]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Reports >1000 words via email. Batch dispatch: N parallel tasks (unique `source = "task:<parent>:<index>"`) + 1 synthesis task (P3, scheduled 6–8h later). Archive previous output atomically before committing replacement.

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-revision-loop-primitive** [2026-05-11, merged: p-pr-reversion-source-verification]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline. When re-verifying author fix-claims, fetch actual file content at HEAD SHA via `gh api repos/OWNER/REPO/contents/PATH?ref=<sha> --jq .content | base64 -d`, NOT cached `gh pr diff`. Stale diffs cause false negatives as much as false positives. Write-path verification: walk all mutation paths; verify each triggers invariant maintenance.
**p-purpose-loop** [2026-05-07]
Daily PURPOSE evals expose directive gaps → low scores become priorities. If ANY PURPOSE dimension ≤2, queue P2 boost task ONLY if queue has existing work. Empty queue + low scores = structural constraint — investigate root cause instead; don't queue phantom boost tasks.
**p-architectural-finding-escalation** [2026-05-19]
Task findings identifying schema changes, dispatch core modifications, or multi-system refactors should surface to decision-maker with explicit rationale BEFORE queuing implementation tasks.
**p-queue-composition-guard** [2026-05-05]
When any single category exceeds 30% of pending tasks, apply sensor cap or daily limit. Strategic tasks ≥40% of weekly cycles. Cap-driven dequeue → `status=completed`, not `failed`. Gate "[repo] Implement #N" tasks at creation; use worktree isolation.
**p-failure-diagnosis** [2026-05-07]
When N failures spike, classify by error type. 80%+ same root cause → fix the cause. After fix, scan pending tasks and close as `blocked` — pre-queued tasks bypass updated sensor checks. Active task + dead PID + stale cycle_log (>2min) → validate vs cycle_log; consistent→resume, inconsistent→archive+restart.
**p-scheduled-task-false-positive** [2026-05-19]
Pending tasks with `scheduled_for` > current_time are not stuck—they're waiting to dispatch. Before escalating "stuck": verify (1) `scheduled_for` timestamp vs current time, (2) parent-task aggregation, (3) priority boost on next cycle.
**p-identity-verification** [2026-04-21]
Verify sender via BOTH chain-specific addresses against known wallets. Mismatched pairs or old address reuse = compromised wallet. SIP-018/BIP-137 messages may arrive in multiple wire formats — try all combinations; check both mainnet and testnet addresses in same test.
**p-model-selection** [2026-04-22]
Daily/weekly introspection uses Sonnet (~10% cost vs Opus, no quality gap). Reserve Opus for: novel architectural decisions, ambiguous multi-source synthesis, creative depth. When a recurring task class becomes dominant cost driver, downgrade model if domain permits; quantify actual ROI first.
**p-pr-sensor-creation-gate** [2026-05-07]
PR review tasks: validate at creation (1) PR exists, (2) PR is open, (3) no pending task for (repo, PR#). All three checked independently. Per-resource cap: 1 pending task per (repo, PR#).
**p-simplify-preflighting** [2026-05-08]
Run `/code-review` on all changed files BEFORE opening a PR. Higher-ROI in sensors due to event-driven divergence. Catches dead code, unused constants, duplicated helpers, filter-chain inefficiencies.
**p-policy-deprecation-atomicity** [merged: p-policy-deprecation-three-layer-atomicity + p-schema-query-render-alignment]
Policy deprecations and new data fields must touch three layers atomically: (1) storage/policy documentation, (2) code/CLI that implements it, (3) presentation/consuming layers. Missing any layer causes recurring failures or silent data gaps.
**p-supply-chain-audit** [2026-05-12, merged: p-cve-batch-cross-repo-triage]
Vuln disclosures: immediate ack, queue audit with scope-assessment skills. CVE names lie — enumerate all vectors, not just the primary. IOC sweeps: build multi-marker list (packages + filenames + SHAs + exfil hosts), sweep all lockfiles in parallel. Identical CVE across multiple repos: triage risk ONCE and apply uniformly — don't assess N times independently.
**p-x-deleted-tweet-prescreen** [2026-05-13]
External resource dependencies fail silently. Pre-screen at three layers: (1) extraction time, (2) creation time — probe API before queuing, (3) dispatch time — early-exit if all resources inaccessible.
**p-integration-sensor-version-dedup** [2026-05-13]
Integration sensors must check `pendingOrCompletedTaskExistsForSource` scoped to specific release version before queuing. Pattern: `source = "sensor:<skill>:<repo>:<version>"`. Multi-task orchestration: use `source = "task:<parent_id>:<scope>"` to prevent dispatch dedup on parallel follow-ups.
**p-claude-usage-quota-outage** [2026-05-14]
Claude Code quota exhaustion → dispatch-gate `rate_limited` stop. **Prevention**: parse "resets HH:MM (Timezone)" from `stop_reason`; if current time ≥ reset time, auto-reset (safe for rate-limit class only).
**p-external-side-effect-idempotency** [merged: p-append-idempotency + p-external-side-effect-idempotency]
Tasks with external side effects (email send, STX send, x402 payment) must self-verify before acting: check sent folder / tx history / payment receipt within a recent time window. Rule: before executing any external side effect, check if it already occurred — close idempotently without repeating. Add idempotency check as FIRST step of any send path. Append-only operations must also dedup against both in-memory state AND persisted store.
**p-sensor-source-key-interval-flood** [2026-05-16]
Sensors with static source keys + short intervals flood when trigger condition persists. Gate via date-scoping (`source = "sensor:name:YYYY-MM-DD HH"`) or condition-state files.
**p-large-audit-aggregator-cli** [2026-05-16]
Any task reading ≥10 files: build a CLI aggregator instead. `sensor-health-report` replaces 73 sensor.ts reads. Architecture reviews: scope to git diff since last SHA. @mention responses: read comment thread only, no full PR diff.
**p-state-machine-dedup-auto-advance** [2026-05-24]
When a state machine creates a dedup'd task, the state must advance immediately upon task creation — else sensors re-detect and re-queue each cycle. Every task-creation action in a dedup'd state must include `autoAdvanceState: <target_state>`. Belt-and-braces: workflow meta-sensor also gates on `recentTaskExistsForSource(source, 60min)` — safety net, not a substitute.
**p-external-signal-window-blindspot** [2026-06-05]
External APIs with pagination limits create invisible ranges where state transitions aren't observed. Add completed-task dedup layer independent of external pagination — track task completion by versioned source key; skip re-queue if completed task exists even if external signal hasn't appeared. Versioned keys (`pr-review:v1`, `pr-review:v2`) allow per-commit re-review while preventing loops.
**p-architecture-review** [2026-05-16]
Architecture review sensors should gate on SHA diff — persist review SHA after each cycle; compare HEAD SHA on next fire; if unchanged, return `"skip"`. Each cycle documents explicit "carry-watch" items in result_summary.
**p-audit-completeness** [merged: p-audit-completeness + p-multi-dispatch-path-completeness]
When adding a fallback or fix, audit ALL code paths independently (legacy + new, sync + async). When discovering a data gap in one item, audit the category and fix related gaps preemptively in the same PR. Return type changes must thread through ALL dispatch paths. Persist audit findings with detail (skill name, line numbers, violation type).
**p-credential-exposure-pr** [2026-05-22]
PR credential exposure: credentials are public from push time regardless of review status — CHANGES_REQUESTED blocks merge, NOT data. Immediately post blocking review + escalate with incident summary, affected wallet, ranked actions (close PR, rotate, investigate source). Track days-elapsed-since-exposure as the risk indicator.
**p-policy-secondary-effects** [2026-05-19]
Policy disables have two aspects: (1) Scope — gate disabled feature within multi-purpose sensors; skip entirely sensors whose sole purpose is the disabled feature; audit for orphaned pending tasks. (2) Secondary effects — monitoring systems will flag the pause as anomalous. Document expected secondary effects in the policy summary.
**p-feedback-task-decomposition** [2026-05-19]
On receiving feedback via email: (1) reply immediately with concrete revision plan, (2) decompose revisions into specific execution tasks with model sized for the work, (3) link via `parent_id`.
**p-resource-constraint-batch-closure** [merged: + p-filter-deploy-queue-sweep]
When a shared resource constraint (wallet balance, API quota, credential expiry) causes repeated failures: (1) close ALL pending tasks of that class, (2) create ONE escalation task scoped to the resource, (3) do not re-queue until resource confirmed restored. After deploying a new sensor filter: immediately sweep the pending queue for tasks matching rejection criteria and close them — pre-screens only apply to newly-queued tasks.
**p-cross-repo-threat-actor-scan** [2026-05-23]
When a threat actor appears in one repo, proactively check other repos before closing the incident. Cross-repo confirmation changes severity: single-repo = possible mistake; multi-repo = persistent threat actor. Use `gh search prs --author <actor>` across org repos.
**p-subagent-output-schema-contract** [2026-05-26]
When delegating research/synthesis to parallel subagents whose outputs will be merged at orchestrator boundary, explicitly document expected output schema in AGENT.md (array vs object, field names, required fields). Schema drift → normalization cycles.
**p-dispatch-infra-config** [2026-05-27]
HTTP/SSE MCP transports silently cap tool calls at 60s — set `MCP_TOOL_TIMEOUT=120000` in dispatch env; silent timeout ≠ error. Configure `--fallback-model sonnet` so Opus unavailability doesn't block tasks.
**p-dispatch-gate-stop-false-positive** [2026-05-27]
Dispatch-stale health alerts are always gate-stop false positives. Verification: check `db/dispatch-lock.json` presence + `cycle_log` timestamp. If lock present AND cycle_log stale → gate-stopped, not crashed. Resolution: manual `arc run` — do NOT restart services.
**p-agent-md-authoring-trigger** [2026-05-27]
Author `AGENT.md` for a skill when: (1) dispatched 3+ times, (2) each dispatch required re-deriving multi-step flows from scratch (high token-in), (3) SKILL.md alone doesn't contain procedural detail. `AGENT.md` is a subagent briefing — never load into orchestrator context.
**p-batch-uniform-error-diagnosis** [2026-05-29]
Batch operations returning uniform error signature indicate service-level issue (rate-limit/outage), not individual failures. Queue ONE orchestration task with diagnose-before-fanout: retry with backoff, classify service state, conditionally fan out.
**p-reflect-per-task-closure** [2026-05-29]
Write learnings at task close (via `arc tasks close --summary "insight"`), not waiting for periodic evals. If task revealed a reusable heuristic or architectural insight, capture as 1–2 sentence summary. Accumulates in `memory/recent.log` for monthly consolidation.
**p-threshold-sensor-cooldown-gate** [2026-06-02, hardened 2026-06-06]
Threshold-based sensors fire repeatedly when action doesn't reduce the triggering condition. Pattern: persist action result hash via `getLastCompletedTaskBySource`; before re-firing, verify condition improved OR cooldown active + no progress. RULE: any sensor with threshold-based fire logic and non-reducing actions needs this guard.
**p-exclusion-rule-accumulation-refactor** [2026-06-03]
When skip/exclusion conditions accumulate to ~20+ and cluster by semantic type, replace scattered prefix guards with a dedicated pattern table. Transparent, testable, maintainable at scale.
**p-completed-task-terminal** [2026-06-03]
A completed task is terminal — no code path should set its status back to `pending`. Safe fix requires two layers: (1) catch-block status check before any requeue call, (2) `UPDATE ... WHERE status != 'completed'` guard in `requeueTask()`. After shipping a resurrection guard, sweep for tasks already left in bad `pending` state — the guard is preventive, not curative.
**p-cicd-prereq-before-verify** [2026-06-03]
Before queuing a `verify-*-deployed` task, confirm deployment infrastructure exists. A PR merged without a deployment workflow causes health endpoints to return 404 indefinitely. Gate `verify-deployed` task creation on CI/CD signal existence; when missing, queue "add CI/CD workflow" task first.
**p-stale-blocking-suppress** [2026-06-06]
Blocked tasks showing no new signals beyond age threshold (48h+) are stale-only candidates. Apply long suppress window (168h+) to prevent repeated reviews that won't change the outcome. Pattern: `source = "task:<parent>:<timestamp>"` with last-completed check.
**p-fallback-path-observability** [2026-06-06]
When systems have fallback mechanisms (model downgrade, retry strategies, circuit-breakers), ensure the actual execution path is observable in logs. Extract actual model from stream and compare against requested; log mismatch + update `cycle_log.model` when fallback activates. Blind fallbacks hide cost/quality deviations.
