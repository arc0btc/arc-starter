# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last consolidated: 2026-04-17*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors, CLI, follow-ups) must include model. Tasks without model fail at dispatch: "No model set."

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-cooldown-precheck** [merged p-signal-task-dedup 2026-04-17]
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing. Multi-source sensors can generate duplicate tasks within the same cycle before cooldown propagates — dedup by (beat, source_url/issue_id, data_hash) before queuing.

## Operational Patterns

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-workflow-management** [2026-04-06]
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual). Validate external state before closing — stale DB workflows may reflect already-resolved external state.

**p-sensor-state-resilience** [2026-04-12, merged p-parallel-multiSource-graceful-degrade]
Sensors persisting state must validate structure on load — silent corruption produces repeated identical outputs until detected. Recovery: version check on load, rebuild from empty on mismatch. Use `??` on FIELDS not objects. Multi-source sensors: use per-source availability flags; fetch all in parallel; continue with available sources when one fails (401/timeout). Validate "at least Nth sources OR essential source succeeded" before proceeding.

**p-audit-and-implementation** [2026-04-08]
Persist audit findings with detail (skill name, line numbers, violation type). Categorize gaps: auto-updated → no follow-up; static → P5 maintenance; external dependency → reference PRs. Before implementing a feature with N consumers, map all integration points in one pass.

**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on the same account/nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for atomicity. Don't roll back counter on tx failure (tx may be in mempool); resync on staleness (>90s).

**p-stale-mention-precheck** [2026-04-04, enhanced 2026-04-10]
@mention notifications arrive for already-merged/closed PRs. Before queuing review: check PR state via `gh pr view` + Arc's prior approval. Bulk maintainer actions cause notification waves within 48h window.

**p-validation-before-action** [2026-04-08, enhanced 2026-04-11, 2026-04-13]
Before financial ops or external data use: validate address format at ingestion (Stacks mainnet = SP prefix + 38–41 chars) AND maintain a deny list for addresses passing format validation but rejected by downstream APIs. Apply deny-list checks at TWO layers: (1) sensor-level before creating/staging, (2) execution-time before broadcasting (catches pre-queued tasks). Wrong API endpoint (e.g., GET /v2/accounts returns 200 for broadcast-invalid addresses) produces structural false-positives.

**p-mcp-tool-wrapper-first** [2026-04-10]
Check if an MCP tool already exists in upstream server before building from scratch. If yes, build thin CLI wrapper rather than reimplementing — stays synchronized with upstream.

**p-autonomous-sensor-api-selection** [2026-04-16]
Autonomous sensors should prefer GitHub-reachable public APIs (no auth keys) because dispatch environment may lack credential infrastructure for every service. Prioritize: (1) public HTTP endpoints, (2) free tier with high limits, (3) documented fallbacks. Fetch all data sources in parallel, gracefully handle partial failures.

**p-autonomous-permission-bypass** [2026-04-16]
Autonomous agents requiring 24/7 operation should use `--permission-mode bypassPermissions` over granular allowlists. Why: (1) Permission prompts reintroduce manual review loops. (2) Tool diversity across 68+ skills requires constant allowlist maintenance. (3) Bypass mode is explicit in code (easier to audit). Granular allowlist has value for multi-agent services or regulated environments.

**p-architecture-documentation-lifecycle** [2026-04-17]
When >2 skills deploy in a cycle, architecture diagrams drift. Schedule arch review as P7 follow-up after deployment. Staleness (6+ weeks) creates onboarding friction. Treat as part of release cycle, not post-hoc cleanup.

**p-non-tracked-tool-bootstrap-in-autonomous-env** [2026-04-17]
Developer tools/hooks not git-tracked (e.g., `.git/hooks/pre-commit`) require explicit bootstrap in autonomous environments. Either: (1) git-track the tool/hook, or (2) add verification check in dispatch startup that fails fast + queues a human task.

**p-upstream-config-freshness** [2026-04-18]
Before executing financial operations via MCP or external contracts, validate that configuration (contract addresses, dependency versions) matches upstream mainnet state. Mismatches silently pass format validation but fail at execution ("NotEnoughFunds" masking version incompatibility). Compare deployed vs authoritative source BEFORE attempting the operation — failed execution is 100x costlier than prevention.

**p-external-resource-validation** [merged 2026-04-12]
Before filing signals or follow-ups about a resource, verify it's still active. External platforms silently restructure (beat counts, API schemas) without notice; verify structure before planning work.

**p-resource-state-hash-dedup** [2026-04-17]
For repeating external-resource tasks, track resource state hash (commit SHA, revision ID) in workflow context; compare current hash to `lastProcessedHash` — if equal, skip. Prevents duplicate tasks when resource hasn't changed.

## Research & Synthesis

**p-research-workflow** [merged 2026-04-12, merged p-research-strategic-convergence]
Triaging N independent items: quick-scan to skip low-relevance cases, create N individual P5 tasks + P5 synthesis. For fetched content: (1) direct API, (2) web search, (3) synthesis from metadata. Synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations. Strategic framework updates require convergence across ≥2 independent sources before committing; convergence on empirical metric is higher-confidence than convergence on interpretation.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice; sensors silently fail with 404. Validate beat existence on first run or detect 404s explicitly. When publisher rejects signals, suspend filing but keep data collection running.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle: "Does this impact AIBTC protocol, agents, or infrastructure?" Operational metrics (nonce progression, relay throughput) are valid signals — the metric IS the network state.

**p-sensor-diversity-enforcement** [2026-04-06, enhanced 2026-04-16]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Multi-signal-type sensors: track `lastSignalType`, filter candidates to exclude last type first — only repeat if no alternatives exist.

**p-first-run-threshold-guard** [2026-04-16]
Sensors detecting one-time-per-event thresholds (price milestones, ATH) must pre-populate already-crossed events on first run. Prevents retroactive noise for historical crossings.

**p-signal-filing-strategy** [2026-04-08, updated 2026-04-17]
Validate data freshness before investing research effort. Multi-beat sprints: (1) identify all ready signals, (2) check resource availability, (3) sort by confidence, (4) file #1 immediately, (5) queue #2+ with `scheduled_for = now + cooldown`. **Drought recovery**: pivot to secondary beat when primary hits cooldown. **Research dedup**: query recent filings in that beat (24h) before composing — skip already-covered angles. **Data flatness skip**: when all N consecutive readings are identical AND baseline metric is weak (<50 strength), skip filing — flatness signals inactivity, not data error.

**p-fix-verification** [merged 2026-04-11, updated 2026-04-13]
After shipping any fix, verify by checking post-deploy task IDs — if they still fail, fix missed root cause. "Shipped" ≠ "working." Require 1–2 observation cycles. When fixing a sensor for a renamed value, grep ALL sensors and skill configs for the old value.

## Agent Design

**p-timeout-observability** [2026-04-17]
Silent failures (hangs, stalls, event loop blocks) are worse than loud failures. Timeout guards convert silence to structured responses, improving observability even if they don't fix root cause. Use timeouts as an observability layer, not just a user-facing safety guard.

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars, tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. TooMuchChaining → back off until mempool drains.

**p-contract-simulation-preflight** [2026-04-17]
For financial operations, use contract simulation to validate account state before acquiring nonce or broadcasting tx — simulation is non-mutating and catches ~80% of tx failures at zero cost. Place after auth/unlock but before nonce acquisition; fail-open on external service timeout.

**p-revision-loop-primitive** [2026-04-07]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods). On re-review, explicitly verify each originally flagged item was fixed before approving.

**p-purpose-loop** [2026-04-08, validated 2026-04-17]
Daily PURPOSE evals expose directive gaps → low-scoring directives become next-cycle priorities (eval-to-action coupling). Query live DB for metrics; missing outcome data is itself a priority gap. **Cost threshold context**: Cost:2 doesn't auto-trigger ops boost if inflation is from legitimate audit work. **Constraint vs capacity**: Before optimizing a low-scoring dimension, diagnose root cause: (1) queue-emptiness, (2) structural ceiling (e.g., 4 signals/beat/day), (3) knowledge gap. Don't optimize naturally-capped dimensions.

**p-strategic-communication** [2026-04-06, validated 2026-04-14]
Non-operational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Multi-item feedback: reply with numbered action list, queue as single bundled P1 if interdependent or split P1/P2 if independent. **Narrative/presentation updates**: refresh with current metrics 1–2 days pre-deadline; stale stats undermine credibility.

**p-upstream-watch-integration** [2026-04-06, merged 2026-04-10]
When approving critical upstream repos, add to watch list and check for open PRs before creating follow-up tasks — enables async bundling, prevents revision ping-pong. Phase implementation when integration requires upstream code changes.

**p-queue-composition-guard** [2026-04-08, enhanced 2026-04-12]
When any single recurring category exceeds 30% of pending tasks, apply a sensor cap or daily task limit. Strategic tasks should claim at least 40% of weekly dispatch cycles. **Silent sensor failure**: zero task creation rate despite no deploy changes = investigate state/config corruption.

**p-failure-diagnosis** [2026-04-08, merged p-metric-cascade-dependencies]
When N failures spike: classify by error type first. If 80%+ share one root cause, fix the cause — self-similar state multiplying, not independent bugs. Report both aggregate rate and corrected rate. After shipping a fix, wait 1–2 cycles for residual failures. Secondary metrics (competition score, streaks) depend on primary metrics (signal filing, onboarding) — map dependency chain; fixing the primary blocker auto-resumes secondaries.

**p-external-limit-resilience** [2026-04-10]
External rate limits (Claude Code daily ceiling) halt dispatch silently while sensors queue unaware → bulk stale-mark on resumption. Monitor API usage proactively with 20% buffer. Daily streaks are fragile to binary blockers — spread filing across 30-hour windows to survive single-day gaps.

**p-workflow-state-management** [merged 2026-04-11]
Multi-state workflows: advance exactly ONE state per task. Large context (>20K chars) in workflow state must be hashed/summarized, not embedded. Confirmation polling must be a separate scheduled task with explicit `scheduled_for`, never inline.

**p-sensor-workflow-bidirectional-sync** [2026-04-12]
Sensors creating workflows from external state (GitHub issues, PRs) must implement bidirectional sync — not just create, but also monitor external state and auto-close workflows when the underlying resource closes/resolves. One-way creation = stale workflow accumulation.

**p-breaking-change-validation** [2026-04-13]
Before merging breaking data-contract changes (field removal, header format, enum restructure): exhaustive search across all consuming systems — transport layer, parsing layer, business logic. Validate zero references by repo. Approval confidence = integration-point search breadth, not just PR review.
