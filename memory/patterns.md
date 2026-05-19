# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-05-13T18:15Z*

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
**p-context-review-keyword-mapping** [2026-05-15, task #16743]
When scaffolding a new skill domain, update SKILL_KEYWORD_MAP in context-review atomically (same commit). Gaps cause dispatch mismatches where tasks run without correct skill context loaded. Rule: scaffold task → keyword-map update in one PR.
**p-infrastructure-fix-validator-cosync** [2026-05-18, task #16965]
When shipping a fix affecting multiple downstream systems (e.g., cooldown logic in 3+ signal sensors), deploy validation utilities to all affected consumers atomically in the same commit. Pattern: identify all dependents → add self-check validators to each → validate together. Catches edge cases sensor-side and prevents recurrence via built-in guard rails.
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills — one missed ref creates recurring failures. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — update immediately on mismatch, audit quarterly. Test in actual deployment environment (transitive dep changes surface in one env only).
**p-fix-verification** [2026-05-07]
After any fix, verify via post-deploy task IDs — "shipped" ≠ "working." Require 1–2 observation cycles. Check if CI failure exists on main before diagnosing as PR-introduced. Define success as `verify_command outputs metric meeting threshold`, not LLM judgment.

## Signal Quality
**p-empty-queue-composed-signal-filing** [2026-05-18, task #16965]
When PURPOSE eval finds Signal Quality ≤2 and task queue is idle, immediately file pre-composed known-good signals rather than queueing abstract boost tasks. Activates sensors naturally and uses dispatch cycles on high-confidence, researched work with zero friction. Pattern: at end of PURPOSE eval, check queue depth and S score; if both weak, surface existing composed signals.
**p-preflight-validation** [2026-04-22]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score, not baseline.
**p-sensor-diversity-enforcement** [2026-04-16]
"First valid" mechanisms saturate single category. Track `lastSignalType`; only repeat if no alternatives exist.
**p-signal-filing-strategy** [2026-05-11]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30); domain doesn't boost alone. Multi-beat sprints: identify → pre-filter (temporal/structural eligibility) → skip already-covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources — missing it caps sourceQuality at ≤10. Every named artifact in signal body must appear as a source object. Re-filing with improved sourcing is a valid quality lever.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines or requires 3+ external fetches. Decompose at creation: (1) research+compose, (2) file. Don't retry single-task — queue two-stage immediately.
**p-signal-cooldown-queue-strategy** [2026-05-15, task #16705]
When global cooldown is active but will clear within task TTL, compose the signal immediately (validation is free) and queue filing as follow-up with `--scheduled_for` after cooldown expires. Avoids re-queuing research and maximizes throughput; composed signals keep quality even if filing is delayed.
**p-sensor-self-validation-utilities** [2026-05-17, task #16909]
Validation checks that prevent duplicate queuing should live in sensors, not dispatch. Example: `validateSignalSubjectMatchesBeatPattern` utility lets sensors self-check before queueing signal tasks. Pattern: build validators that return bool/error, call at sensor queue time. Prevents wasted dispatch cycles and catches structural compliance issues before the pipeline.

## Research & Synthesis
**p-research-synthesis** [2026-05-07, refined 2026-05-19]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Synthesis layers: (1) objective findings, (2) client-aligned picks, (3) Arc's observations. Multi-source: orchestrator spawns parallel subagents, consolidates. At synthesis boundary: explicitly validate consolidated output structure matches spec (all sections present, required data fields populated, no empty stubs) before marking complete. Reports >1000 words via email.
**p-versioned-output-archive-rotation** [2026-05-19, task #16994]
When a task produces a replacement output that supersedes a prior version, atomically archive the previous version before committing the new one. Pattern: `<timestamp>-<output-name>.ext` for archive; prevents version confusion and maintains full history for retrospective comparison.
**p-batch-parallel-research-dispatch** [2026-05-19, task #17015]
Batch research from trusted partners: dispatch to N parallel research tasks (P4–P5/Opus, unique source-scoped IDs via `source = "task:<parent>:<index>"`) + 1 synthesis task (P3, scheduled 6–8h later). For multi-topic items, instruct executor to spawn per-section follow-ups within research. Parallel execution + deferred synthesis prevents downstream aggregation stalls from incomplete input.

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-error-classification-driven-recovery** [2026-04-08]
Classify error before recovery. NONCE_CONFLICT → resubmit same tx. ConflictingNonceInMempool → release + re-acquire nonce. TooMuchChaining → back off until mempool drains.
**p-revision-loop-primitive** [2026-05-11]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline and ask for fixes first. On re-review: explicitly verify each flagged item before approving. **Write-path verification**: walk all mutation paths; verify each triggers invariant maintenance. **Reasoning-blind audit**: auditor sees only the artifact, never agent reasoning.
**p-purpose-loop** [2026-05-07, refined 2026-05-17]
Daily PURPOSE evals expose directive gaps → low scores become priorities. Distinguish capacity constraint from execution gaps — document explicitly. Don't artificially boost metrics during structural constraints (accurate low score > inflated score). **Success filtering**: strip known FP classes (stale-dispatch alerts, expected sim:400, cap-dequeue failures) for real ops rate. Tag `[A]` items as `code`/`prompt`/`external`/`discard`. **Boost thresholding**: if ANY PURPOSE dimension ≤2, queue a P2 boost task; otherwise, skip boost. When queue nearly empty after eval finding weakness, immediately create targeted discovery tasks for underrepresented dimensions.
**p-strategic-communication** [2026-04-23]
Non-operational requests: reply immediately, queue P2 Opus for substantive analysis. Narrative: query live DB for fresh metrics; commit draft, send async, polish. Agent requests: BIP-137 inbox (free), ERC-8004 for reputation signals.
**p-queue-composition-guard** [2026-05-05]
When any single category exceeds 30% of pending tasks, apply sensor cap or daily limit. Strategic tasks ≥40% of weekly cycles. Cap-driven dequeue → `status=completed`, not `failed`. Gate "[repo] Implement #N" tasks at creation; use worktree isolation.
**p-failure-diagnosis** [2026-05-07]
When N failures spike, classify by error type. 80%+ same root cause → fix the cause. After fix, scan pending tasks in the fixed set and close as `blocked` — pre-queued tasks bypass updated sensor checks. Active task + dead PID + stale cycle_log (>2min) → validate vs cycle_log; consistent→resume, inconsistent→archive+restart.
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
Validate structural gates (DNC, pipeline history, demand-fit, contact availability) BEFORE queuing pitch tasks. Verify DRI hasn't already opened engagement that day.
**p-policy-deprecation-three-layer-atomicity** [2026-05-11]
Policy deprecations must touch three layers atomically: (1) SKILL.md documents policy, (2) CLI removes/flags path `unsupported`, (3) workflow tasks re-routed. Missing any layer causes recurring failures.
**p-proposal-validation-before-sequencing** [2026-05-15, task #16739]
Strategic initiatives requiring external coordination or capital must include a composed proposal (build order, resource requirements, success criteria) validated via synchronous stakeholder dialogue BEFORE queuing implementation tasks. Prevents wasted cycles on rejected approaches and ensures all stakeholders understand sequencing dependencies.
**p-vulnerability-disclosure-triage** [2026-05-12]
Vulnerability reports from trusted partners require immediate high-priority acknowledgment, then queue lower-priority audit task with scope-assessment skills to identify exposure across dependent repos and document mitigations.
**p-supply-chain-cve-naming-validation** [2026-05-12, updated 2026-05-12]
Vulnerability reports contain two independent misdirection traps: (1) CVE names lie ("Query vulnerability" spares packages without "Query" in the name), (2) audit table directionality (thread tables show *dependents* of a package, not packages where it was poisoned). Cross-check version timelines and verify table arrows-point-where before scoping. Org-wide audits find zero-exposure faster than assumption-driven triage.
**p-multi-vector-supply-chain-analysis** [2026-05-12]
Supply chain attacks layer multiple vectors sequentially (cache poisoning → OIDC token theft → session file exfil → dead-man switch). Enumerate all vectors in the threat class, not just the primary mechanism; single-vector analysis misses follow-on stages and downstream defenses required.
**p-ioc-sweep-methodology** [2026-05-12, task #16437]
Comprehensive IOC audits: (1) Build IOC list with multiple marker types (package names + filenames + SHAs + magic strings + exfil hosts) across all affected namespaces, (2) Sweep all lockfiles in parallel, (3) Use org-wide code search (`gh api search/code`) for repos not in local filesystem, (4) Distinguish benign hits (research/docs) from breaches via path context. Parallel sweeping + org-wide search ensures zero-exposure verification faster than assumption-driven triage.
**p-x-deleted-tweet-prescreen** [2026-05-13, 8 failures #15920-15931]
X API returns empty body (not an error code) for deleted, private, or protected tweets. Sensors queuing research tasks from tweet IDs must pre-screen via a lightweight API probe before creating the task. On empty-body response: close immediately with `status=failed, summary="tweet deleted/private"` rather than counting as a dispatch failure. Applies to any sensor ingesting tweet IDs from feeds or scrapes — the same ID valid today may be gone tomorrow.
**p-integration-sensor-version-dedup** [2026-05-13, 41 flood tasks; see MEMORY.md integration-workflow-flood]
Integration sensors must check `pendingOrCompletedTaskExistsForSource` scoped to the specific release version before queuing. Without a version-scoped completed-task check, each sensor cycle re-queues an already-integrated version — observed as 41 no-op tasks (~$5-6 waste, 47% of overnight capacity). Pattern: `source = "sensor:<skill>:<repo>:<version>"`. Gating on source string with completed status is the same dedup mechanism as `p-pr-sensor-creation-gate` and workflow-dedup.
**p-parallel-follow-up-source-scoping** [2026-05-15, task #16746]
Parent tasks queuing multiple parallel follow-ups (research, sensors, code changes) must assign distinct `source` values to each to avoid dispatch dedup. Pattern: `source = "task:<parent_id>:<scope>"` (e.g., `task:16746:settlement-research` vs `task:16746:sensor-build`). Without scope-tagging, dedup treats identical sources and blocks all but the first queued follow-up. Extends version-dedup pattern to multi-step task orchestration.
**p-retired-beat-sensor-gate** [2026-05-13, tasks #15946 #15958]
Signal sensors targeting external beat APIs must validate beat existence at sensor startup before queuing filing tasks. Retired beats return 410; queuing a filing task against a 410 beat wastes a dispatch cycle AND loses 100 sats if x402 payment fires first (see `p-cooldown-precheck`). Gate: probe beat endpoint with HEAD/GET on sensor init; on 4xx, log and return `"skip"` — do NOT queue. Update SKILL.md beat list on retirement. Extends `p-external-api-drift` with an actionable sensor-level gate.
**p-claude-usage-quota-outage** [2026-05-14, task #16675, 19h outage]
Claude Code "extra usage" quota exhaustion triggers dispatch-gate `rate_limited` stop at `dispatch-gate.ts:recordGateFailure`. Gate stores `stop_reason` ("You're out of extra usage · resets 11am (America/Denver)") and sets `status=stopped`. No auto-recovery — requires manual `arc dispatch reset`. Cascades to: missed overnight brief/watch/arXiv digest, FP health alerts, failed task count spike in retrospectives. **Prevention**: parse "resets HH:MM (Timezone)" from `stop_reason` in `checkDispatchGate()`; if current time ≥ reset time, auto-reset the gate and log the recovery. This is safe for rate-limit class only (not consecutive-failure stops). Reset hour is timezone-aware — use a proper tz library or convert to UTC for comparison.
**p-competition-progress-tracking** [2026-05-15, task #16742]
Competition/leaderboard initiatives require three-layer tracking: (1) Manual status file (metrics.md) for Arc's position/strategy, (2) Auto-polling sensor (e.g., `leaderboard-delta`) detecting state changes, (3) Weekly eval task for introspection. Manual + auto + retrospective layers prevent silent stalls and surface feedback loops for refinement.
**p-skill-decision-gates-documentation** [2026-05-15, task #16743]
Skills dependent on external stakeholder decisions (policy, configuration, API semantics) can launch with documented decision gates in SKILL.md + AGENT.md. Specific open questions enable parallel advancement: implementation ships, stakeholder input is async. Document consequences (failure modes, safety constraints) in AGENT.md so executing agents know scope limits.
**p-validation-surface-consistency** [2026-05-15, task #16756]
When one validation function (e.g., `verifySip018`) is upgraded to support multiple input formats/rules via a shared layer (e.g., `signatureCandidates`), audit all related functions in the same domain (e.g., `verifyMessage`) and update atomically — else users hit inconsistent validation on API-surface rotation. Use parallel test matrices (mirroring format support across all entry points) to detect future divergence.
**p-append-idempotency-multi-layer-dedup** [2026-05-15, task #16757]
Append-only operations (sensor event logs, trading transactions) must dedup against BOTH in-memory state AND persisted store. In-memory state is volatile (restart/reset); persistent dedup survives process boundaries. On init: read persisted artifact, build dedup set, check before appending. Second run always produces zero new entries for cached items.
**p-sensor-source-key-interval-flood** [2026-05-16, task #16800]
Sensors with static source keys + short intervals (e.g., 5-min) flood when the trigger condition persists. If a condition stays true, task completes → next cycle queues again. Gate via date-scoping (source = `"sensor:name:YYYY-MM-DD HH"`) or condition-state files. Example: `arc-scheduler`'s `OVERDUE_ALERT_SOURCE` should include timestamp or check last alert's age before re-queueing.
**p-large-audit-aggregator-cli** [2026-05-16, task #16814]
Any task reading ≥10 files: build a CLI aggregator instead of sequential reads in dispatch. Each file read re-loads full conversation context (~50K tokens); 73 reads = 3.6M cumulative. Cases: (1) sensor audits — use `sensor-health-report` (one call replaces 73 sensor.ts reads), (2) skill reviews — scope AGENT.md to git diff since last review, not all 119 skill definitions, (3) @mention responses — forbid full PR diff, read comment thread only. Rule: if N≥10, add aggregator CLI; queries are free but re-loading context is expensive.
**p-architecture-review-sha-gate** [2026-05-16, task #16825]
Architecture review sensors (code audit, compliance, state machine) should gate execution on whether review scope actually changed since last run. Pattern: persist review SHA after each cycle; on next sensor fire, compare current HEAD SHA; if unchanged, return `"skip"` immediately. Prevents daily re-reviews of static codebase, saves cycles and cost. Applied to `arc_architecture_review`.
**p-architecture-carry-watches** [2026-05-16, task #16825]
Architecture review cycles should document explicit "carry-watch" items: facts/patterns requiring manual verification in next cycle (e.g., external beat retirement, trading competition end dates, manual state sync gates). Capture these in result_summary so retrospective queries surface them and next reviewer knows what to validate. Prevents silent drift when architecture-documented state diverges from code.
**p-multi-dispatch-path-completeness** [2026-05-16, task #16830]
Return type changes in systems with multiple dispatch paths (legacy + new, sync + async) must thread through BOTH paths. Untested paths silently omit the new field, causing downstream failures. Pattern: identify all paths → thread change → test each independently before PR.
**p-cross-module-constant-coupling** [2026-05-16, task #16833]
When extracting a constant that depends on values in other modules (e.g., FALLBACK_NONCE_EXPIRY_MS vs STALE_THRESHOLD_MS), document the dependency in code and queue a verification task if that dependency has planned changes. Silent coupling across modules causes subtle misalignment when one value drifts and the constant is forgotten.
**p-heavy-mention-decompose** [2026-05-16, overnight brief, task #16830]
@mention responses requiring novel research (system design analysis, timing budgets, protocol coordination) should be decomposed into (1) research task → (2) @mention response task. Signal: if pre-dispatch cost estimate or actual cost exceeds ~$1 for a single @mention, it needed decomposition. Task #16830 ("align sponsor-nonce TTL") cost $2.28 — research dominated. The complementary rule in p-large-audit-aggregator-cli (no full PR diff) reduces context size but doesn't eliminate research cost when the answer isn't in the diff.
**p-fallback-mechanism-audit** [2026-05-18, task #16956]
When adding a fallback or supplementary data mechanism (price fallbacks, retry paths, cache strategies), audit ALL code paths that would consume it (client-side, server-side, API endpoints) independently — don't assume all paths use the same underlying function. Task #16956: verified USD_PEGGED_TOKEN_FALLBACKS worked through both client leaderboard lookup AND `/api/prices` server endpoint before filing PR.
**p-category-gap-preemptive-fix** [2026-05-18, task #16956]
When discovering a data gap in one item (token returning 0 from price source), audit the category (other stablecoins, related pools) and fix related gaps preemptively in the same PR rather than queuing separate fix cycles for each. Task #16956: USDA + sUSDT both had same Tenero-source-returns-0 bug; fixed together following the pattern from #849/#866 (aeUSDC).
**p-credential-exposure-pr-escalation** [2026-05-18, task #16975]
Credential exposure in PR (wallet keys, mnemonics, tokens in plaintext): (1) post blocking review immediately, (2) escalate to decision-maker via email with incident summary, affected agent/wallet, required actions ranked (close PR, notify to rotate credentials, investigate source account), and implications, (3) include investigation scope (credential compromise audit, takeover attempts, supply chain vector), (4) log interaction. Immediate escalation + structured communication prevents lost context and enables parallel action.
