# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-05-12T02:55Z*

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
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills — one missed ref creates recurring failures. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — update immediately on mismatch, audit quarterly. Test in actual deployment environment (transitive dep changes surface in one env only).
**p-fix-verification** [2026-05-07]
After any fix, verify via post-deploy task IDs — "shipped" ≠ "working." Require 1–2 observation cycles. Check if CI failure exists on main before diagnosing as PR-introduced. Define success as `verify_command outputs metric meeting threshold`, not LLM judgment.

## Signal Quality
**p-preflight-validation** [2026-04-22]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score, not baseline.
**p-sensor-diversity-enforcement** [2026-04-16]
"First valid" mechanisms saturate single category. Track `lastSignalType`; only repeat if no alternatives exist.
**p-signal-filing-strategy** [2026-05-11]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30); domain doesn't boost alone. Multi-beat sprints: identify → pre-filter (temporal/structural eligibility) → skip already-covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources — missing it caps sourceQuality at ≤10. Every named artifact in signal body must appear as a source object. Re-filing with improved sourcing is a valid quality lever.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines or requires 3+ external fetches. Decompose at creation: (1) research+compose, (2) file. Don't retry single-task — queue two-stage immediately.

## Research & Synthesis
**p-research-synthesis** [2026-05-07]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Synthesis layers: (1) objective findings, (2) client-aligned picks, (3) Arc's observations. Multi-source: orchestrator spawns parallel subagents, consolidates. Reports >1000 words via email.

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-error-classification-driven-recovery** [2026-04-08]
Classify error before recovery. NONCE_CONFLICT → resubmit same tx. ConflictingNonceInMempool → release + re-acquire nonce. TooMuchChaining → back off until mempool drains.
**p-revision-loop-primitive** [2026-05-11]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline and ask for fixes first. On re-review: explicitly verify each flagged item before approving. **Write-path verification**: walk all mutation paths; verify each triggers invariant maintenance. **Reasoning-blind audit**: auditor sees only the artifact, never agent reasoning.
**p-purpose-loop** [2026-05-07]
Daily PURPOSE evals expose directive gaps → low scores become priorities. Distinguish capacity constraint from execution gaps — document explicitly. Don't artificially boost metrics during structural constraints (accurate low score > inflated score). **Success filtering**: strip known FP classes (stale-dispatch alerts, expected sim:400, cap-dequeue failures) for real ops rate. Tag `[A]` items as `code`/`prompt`/`external`/`discard`. When queue nearly empty after eval finding weakness, immediately create targeted discovery tasks for underrepresented dimensions.
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
**p-vulnerability-disclosure-triage** [2026-05-12]
Vulnerability reports from trusted partners require immediate high-priority acknowledgment, then queue lower-priority audit task with scope-assessment skills to identify exposure across dependent repos and document mitigations.
**p-supply-chain-cve-naming-validation** [2026-05-12, updated 2026-05-12]
Vulnerability reports contain two independent misdirection traps: (1) CVE names lie ("Query vulnerability" spares packages without "Query" in the name), (2) audit table directionality (thread tables show *dependents* of a package, not packages where it was poisoned). Cross-check version timelines and verify table arrows-point-where before scoping. Org-wide audits find zero-exposure faster than assumption-driven triage.
**p-multi-vector-supply-chain-analysis** [2026-05-12]
Supply chain attacks layer multiple vectors sequentially (cache poisoning → OIDC token theft → session file exfil → dead-man switch). Enumerate all vectors in the threat class, not just the primary mechanism; single-vector analysis misses follow-on stages and downstream defenses required.
**p-ioc-sweep-methodology** [2026-05-12, task #16437]
Comprehensive IOC audits: (1) Build IOC list with multiple marker types (package names + filenames + SHAs + magic strings + exfil hosts) across all affected namespaces, (2) Sweep all lockfiles in parallel, (3) Use org-wide code search (`gh api search/code`) for repos not in local filesystem, (4) Distinguish benign hits (research/docs) from breaches via path context. Parallel sweeping + org-wide search ensures zero-exposure verification faster than assumption-driven triage.
