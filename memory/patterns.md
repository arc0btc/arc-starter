# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-05-19T07:00Z*

## Core Patterns
**p-model-required**
All task-creation paths must include model. Tasks without model fail at dispatch: "No model set."
**p-pr-supersession**
When higher-priority task supersedes pending tasks, close explicitly: `status=failed, summary="superseded by #X"`. Don't leave — inflates failure counts.
**p-cooldown-precheck** [2026-05-07]
Two gates before signal filing: (1) daily task count AND (2) 60-min per-agent cooldown. Both must pass. Dedup by (beat, source_url, data_hash). **Payment ordering**: cooldown check BEFORE x402 payment — task #15946 lost 100 sats paying first.

## Operational Patterns
**p-sensor-state-resilience** [2026-05-07]
Validate persisted state on load; rebuild from empty on version mismatch. Multi-source: fetch all in parallel, continue with available. Gate at entry when external deps required. Use broad exception handling so timeouts are retried (not just HTTP status catches). Write scheduling state AFTER successful run — writing on entry creates multi-hour lockout on failure.
**p-audit-and-implementation** [task #15944]
Persist audit findings with detail (skill name, line numbers, violation type). Map all integration points before implementing. Check existing MCP tools before building. Audits discovering untracked files supporting active ops → trigger P5 follow-ups immediately.
**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on same nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks. Don't roll back counter on tx failure; resync on staleness (>90s).
**p-lock-ttl-operation-duration** [2026-05-07]
Cache/lock TTL must exceed actual operation duration. Measure p99 latency; set TTL = p99 + safety margin. Short TTL → concurrent bypass → duplicate fan-out costs.
**p-validation-before-action** [2026-04-13]
Before financial ops: validate address format AND maintain deny-list for addresses passing format but rejected downstream. Apply at TWO layers: (1) sensor-level, (2) execution-time. Track resource state hash; skip if unchanged.
**p-credential-namespace-consistency** [2026-05-04]
Sensor credential reads must match namespace in SKILL.md and actual store. Mismatch causes silent skips. Debug: trace SKILL.md → actual cred keys → sensor code.
**p-follow-up-task-skill-name-validation** [2026-05-11]
Verify skill names via `arc skills` before `arc tasks add --skills`. Nonexistent names silently ignored at dispatch. Correct mappings: `quantum`→`arxiv-research`, `arc-signal-manager`→`aibtc-news-editorial`.
**p-context-review-keyword-mapping** [2026-05-15]
When scaffolding a new skill domain, update SKILL_KEYWORD_MAP in context-review atomically (same commit). Gaps cause dispatch mismatches where tasks run without correct skill context loaded.
**p-infrastructure-fix-validator-cosync** [2026-05-18]
When shipping a fix affecting multiple downstream systems (e.g., cooldown logic in 3+ sensors), deploy validation utilities to all affected consumers atomically in the same commit. Identify all dependents → add self-check validators to each → validate together.
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — audit quarterly.
**p-fix-verification** [2026-05-07]
After any fix, verify via post-deploy task IDs — "shipped" ≠ "working." Require 1–2 observation cycles. Define success as `verify_command outputs metric meeting threshold`, not LLM judgment.

## Signal Quality
**p-empty-queue-composed-signal-filing** [2026-05-18]
When PURPOSE eval finds Signal Quality ≤2 and task queue is idle, immediately file pre-composed known-good signals. At end of PURPOSE eval, check queue depth and S score; if both weak, surface existing composed signals.
**p-preflight-validation** [2026-04-22]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score.
**p-sensor-diversity-enforcement** [2026-04-16]
"First valid" mechanisms saturate single category. Track `lastSignalType`; only repeat if no alternatives exist.
**p-signal-filing-strategy** [2026-05-11]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30). Multi-beat sprints: identify → pre-filter → skip covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources. Every named artifact in signal body must appear as a source object. Re-filing with improved sourcing is a valid quality lever.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines or requires 3+ external fetches. Decompose at creation: (1) research+compose, (2) file.
**p-signal-cooldown-queue-strategy** [2026-05-15]
When global cooldown is active but clears within task TTL, compose the signal immediately and queue filing as follow-up with `--scheduled_for` after cooldown expires. Avoids re-queuing research.
**p-sensor-self-validation-utilities** [2026-05-17]
Validation checks that prevent duplicate queuing should live in sensors, not dispatch. Build validators that return bool/error, call at sensor queue time. Prevents wasted dispatch cycles.

## Research & Synthesis
**p-research-synthesis** [2026-05-07, refined 2026-05-19]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Synthesis layers: (1) objective findings, (2) client-aligned picks, (3) Arc's observations. At synthesis boundary: validate consolidated output structure matches spec before marking complete. Reports >1000 words via email.
**p-versioned-output-archive-rotation** [2026-05-19]
When a task produces a replacement output, atomically archive the previous version before committing the new one. Pattern: `<timestamp>-<output-name>.ext` for archive.
**p-batch-parallel-research-dispatch** [2026-05-19]
Batch research: dispatch to N parallel tasks (P4–P5/Opus, unique source-scoped IDs via `source = "task:<parent>:<index>"`) + 1 synthesis task (P3, scheduled 6–8h later). Parallel execution + deferred synthesis prevents aggregation stalls from incomplete input.

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-error-classification-driven-recovery** [2026-04-08]
Classify error before recovery. NONCE_CONFLICT → resubmit same tx. ConflictingNonceInMempool → release + re-acquire nonce. TooMuchChaining → back off until mempool drains.
**p-revision-loop-primitive** [2026-05-11]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline and ask for fixes first. **Write-path verification**: walk all mutation paths; verify each triggers invariant maintenance. **Reasoning-blind audit**: auditor sees only the artifact, never agent reasoning.
**p-purpose-loop** [2026-05-07, refined 2026-05-17]
Daily PURPOSE evals expose directive gaps → low scores become priorities. Distinguish capacity constraint from execution gaps. Don't artificially boost metrics during structural constraints. **Boost thresholding**: if ANY PURPOSE dimension ≤2, queue a P2 boost task. When queue nearly empty after eval finding weakness, immediately create targeted discovery tasks.
**p-strategic-communication** [2026-04-23]
Non-operational requests: reply immediately, queue P2 Opus for substantive analysis. Narrative: query live DB for fresh metrics; commit draft, send async, polish. Agent requests: BIP-137 inbox (free), ERC-8004 for reputation signals.
**p-architectural-finding-escalation** [2026-05-19]
Task findings identifying schema changes, dispatch core modifications, or multi-system refactors should surface to decision-maker with explicit rationale BEFORE queuing implementation tasks. Prevents premature automation of high-impact decisions.
**p-honest-metrics-in-presentations** [2026-05-19]
Public presentations: own actual metrics honestly (zero scores, paused features) rather than omitting or dressing up. Frame constraints transparently and completed-but-paused work as experiments. Honest positioning builds credibility.
**p-queue-composition-guard** [2026-05-05]
When any single category exceeds 30% of pending tasks, apply sensor cap or daily limit. Strategic tasks ≥40% of weekly cycles. Cap-driven dequeue → `status=completed`, not `failed`. Gate "[repo] Implement #N" tasks at creation; use worktree isolation.
**p-failure-diagnosis** [2026-05-07]
When N failures spike, classify by error type. 80%+ same root cause → fix the cause. After fix, scan pending tasks and close as `blocked` — pre-queued tasks bypass updated sensor checks. Active task + dead PID + stale cycle_log (>2min) → validate vs cycle_log; consistent→resume, inconsistent→archive+restart.
**p-scheduled-task-false-positive** [2026-05-19]
Pending tasks with `scheduled_for` > current_time are not stuck—they're waiting to dispatch. Past-due scheduled tasks get +2 priority boost automatically. Before escalating "stuck": verify (1) `scheduled_for` timestamp vs current time, (2) parent-task aggregation (intentional staging), (3) priority boost on next cycle. Prevents misdiagnosis cycles.
**p-multi-chain-identity-verification** [2026-04-21]
Verify sender via BOTH chain-specific addresses against known wallets. Mismatched pairs or old address reuse = compromised wallet. Prevents message-forwarding attacks.
**p-peer-signature-format-tolerance** [2026-05-07]
SIP-018/BIP-137 messages may arrive in multiple wire formats (RSV/VRS/raw 64-byte, recovery-id 0/1/27/28). Try all combinations; check both mainnet and testnet addresses in same test.
**p-introspection-model-sizing** [2026-04-22]
Daily/weekly introspection doesn't require Opus. Sonnet handles synthesis at ~10% cost, no quality gap. Reserve Opus for: novel architectural decisions, ambiguous multi-source synthesis, creative depth.
**p-predictive-model-selection** [2026-04-23]
Predict complexity before task creation; assign model based on input scope. Subprocess memory overhead: opus + build tools = OOM on constrained systems. SKILL.md documented model must match sensor.ts implementation.
**p-cost-driven-model-downgrade** [2026-05-04]
When recurring task class becomes dominant cost driver, downgrade model if domain permits. ROI gate: quantify actual benefit vs effort before any efficiency refactor.
**p-agent-workflow-sync** [2026-05-04]
AGENT.md delegating external work must explicitly include the context-update CLI step. Missing sync signal leaves workflows stuck in intermediate states.
**p-failure-taxonomy-escalation** [2026-05-07]
4-class taxonomy: loops/give-ups/errors/recovery. Escalation: 3 discards→REFINE, 5→PIVOT, 2 PIVOTs→web search, 3→soft blocker. One success resets.
**p-pr-sensor-creation-gate** [2026-05-07]
PR review tasks: validate at creation (1) PR exists, (2) PR is open, (3) no pending task for (repo, PR#). All three checked independently. Per-resource cap: 1 pending task per (repo, PR#).
**p-memory-consolidation-automation** [2026-05-07]
Git pre-commit hook checks MEMORY.md token count; queues P2 Sonnet consolidation if >threshold. Async, doesn't block commits.
**p-simplify-preflighting** [2026-05-08]
Run `/simplify` on all changed files BEFORE opening a PR. Higher-ROI in sensors due to event-driven divergence. Catches dead code, unused constants, duplicated helpers, filter-chain inefficiencies.
**p-partial-results-on-multi-step-failure** [2026-05-08]
Return partial-result objects (`{ data: [...], failedOn?: 'fieldName' }`) rather than fail-all. Graceful degradation > total failure in fan-out operations.
**p-ic-pipeline-precheck** [2026-04-24]
Validate structural gates (DNC, pipeline history, demand-fit, contact availability) BEFORE queuing pitch tasks.
**p-policy-deprecation-three-layer-atomicity** [2026-05-11]
Policy deprecations must touch three layers atomically: (1) SKILL.md documents policy, (2) CLI removes/flags path `unsupported`, (3) workflow tasks re-routed. Missing any layer causes recurring failures.
**p-proposal-validation-before-sequencing** [2026-05-15]
Strategic initiatives requiring external coordination or capital must include a composed proposal validated via synchronous stakeholder dialogue BEFORE queuing implementation tasks.
**p-vulnerability-disclosure-triage** [2026-05-12]
Vulnerability reports from trusted partners require immediate high-priority acknowledgment, then queue lower-priority audit task with scope-assessment skills to identify exposure and document mitigations.
**p-supply-chain-audit** [2026-05-12, merged: cve-naming, multi-vector, ioc-sweep]
CVE names lie ("Query vulnerability" may spare packages without "Query" in the name). Supply chain attacks layer vectors sequentially (cache poisoning → OIDC token theft → session exfil → dead-man switch) — enumerate all vectors, not just the primary. IOC sweeps: build list with multiple marker types (package names + filenames + SHAs + magic strings + exfil hosts), sweep all lockfiles in parallel, use org-wide code search (`gh api search/code`) for repos not in local filesystem. Distinguish benign hits from breaches via path context.
**p-x-deleted-tweet-prescreen** [2026-05-13]
X API returns empty body (not error code) for deleted/private/protected tweets. Sensors queuing research from tweet IDs must pre-screen via lightweight API probe. On empty-body: close immediately `status=failed, summary="tweet deleted/private"`.
**p-integration-sensor-version-dedup** [2026-05-13]
Integration sensors must check `pendingOrCompletedTaskExistsForSource` scoped to specific release version before queuing. Pattern: `source = "sensor:<skill>:<repo>:<version>"`. Multi-task orchestration: use `source = "task:<parent_id>:<scope>"` to prevent dispatch dedup on parallel follow-ups.
**p-retired-beat-sensor-gate** [2026-05-13]
Signal sensors must validate beat existence at startup. Retired beats return 410; gate: probe beat endpoint on sensor init; on 4xx, log and return `"skip"` — do NOT queue. Extends `p-external-api-drift` with an actionable sensor-level gate.
**p-claude-usage-quota-outage** [2026-05-14]
Claude Code quota exhaustion → dispatch-gate `rate_limited` stop. No auto-recovery — requires manual `arc dispatch reset`. **Prevention**: parse "resets HH:MM (Timezone)" from `stop_reason`; if current time ≥ reset time, auto-reset (safe for rate-limit class only, not consecutive-failure stops).
**p-competition-progress-tracking** [2026-05-15]
Competition/leaderboard initiatives require three-layer tracking: (1) Manual status file for position/strategy, (2) Auto-polling sensor detecting state changes, (3) Weekly eval for introspection.
**p-skill-decision-gates-documentation** [2026-05-15]
Skills dependent on external stakeholder decisions can launch with documented decision gates in SKILL.md + AGENT.md. Specific open questions enable parallel advancement.
**p-validation-surface-consistency** [2026-05-15]
When one validation function is upgraded to support multiple formats via a shared layer, audit all related functions in the same domain and update atomically. Use parallel test matrices to detect future divergence.
**p-schema-query-render-alignment** [2026-05-19, task #17082]
New fields on data models must be exposed atomically across three layers: (1) storage schema (always exists), (2) query layer (SELECT must include it), (3) presentation layer (UI must render it). Missing any layer makes the field invisible despite being stored. Audit all models when adding fields; verify query reaches detail routes and feed routes separately.
**p-append-idempotency-multi-layer-dedup** [2026-05-15]
Append-only operations must dedup against BOTH in-memory state AND persisted store. On init: read persisted artifact, build dedup set, check before appending.
**p-sensor-source-key-interval-flood** [2026-05-16]
Sensors with static source keys + short intervals flood when trigger condition persists. Gate via date-scoping (`source = "sensor:name:YYYY-MM-DD HH"`) or condition-state files.
**p-large-audit-aggregator-cli** [2026-05-16]
Any task reading ≥10 files: build a CLI aggregator instead. Rule: if N≥10, add aggregator CLI. `sensor-health-report` replaces 73 sensor.ts reads. Architecture reviews: scope to git diff since last SHA. @mention responses: read comment thread only, no full PR diff.
**p-architecture-review** [2026-05-16, merged: sha-gate + carry-watches]
Architecture review sensors should gate on SHA diff — persist review SHA after each cycle; on next fire, compare HEAD SHA; if unchanged, return `"skip"`. Each review cycle should document explicit "carry-watch" items (facts requiring manual verification in next cycle) in result_summary so retrospective queries surface them.
**p-multi-dispatch-path-completeness** [2026-05-16]
Return type changes in systems with multiple dispatch paths (legacy + new, sync + async) must thread through ALL paths. Identify all paths → thread change → test each independently before PR.
**p-cross-module-constant-coupling** [2026-05-16]
When extracting a constant that depends on values in other modules, document the dependency in code and queue a verification task if that dependency has planned changes.
**p-heavy-mention-decompose** [2026-05-16]
@mention responses requiring novel research should decompose into (1) research task → (2) response task. Signal: if pre-dispatch cost estimate exceeds ~$1 for a single @mention, it needed decomposition.
**p-audit-completeness** [2026-05-18, merged: fallback-mechanism-audit + category-gap-preemptive-fix]
When adding a fallback or supplementary mechanism, audit ALL code paths that would consume it independently — don't assume all paths use the same underlying function. When discovering a data gap in one item, audit the category and fix related gaps preemptively in the same PR rather than queuing separate fix cycles for each.
**p-credential-exposure-pr-escalation** [2026-05-18]
Credential exposure in PR: (1) post blocking review immediately, (2) escalate to decision-maker via email with incident summary, affected agent/wallet, required actions ranked (close PR, rotate credentials, investigate source account), (3) include investigation scope.
**p-competitive-metric-verification** [2026-05-19, merged: metric-disambiguation + shared-output-stat-verification]
Leaderboards diverge across three vectors: (1) docs list options without clarifying reward basis, (2) UI defaults to one sort but rewards calculated on another, (3) reward-basis code may be unmerged. Verify all three independently. Stats in shared presentations must be verified against live sources at composition time — when a metric has multiple valid definitions, surface all of them with explicit context.
