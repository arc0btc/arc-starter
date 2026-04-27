# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last consolidated: 2026-04-24T11:10Z*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors, CLI, follow-ups) must include model. Tasks without model fail at dispatch: "No model set."

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-cooldown-precheck** [merged p-signal-task-dedup 2026-04-17, refined 2026-04-21]
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing. Multi-source sensors can generate duplicate tasks within the same cycle before cooldown propagates — dedup by (beat, source_url/issue_id, data_hash) before queuing. `isBeatOnCooldown()` must check both the time window AND the pending/active task queue (commit ab0d1f47).

## Operational Patterns

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-workflow-management** [2026-04-06]
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual). Validate external state before closing — stale DB workflows may reflect already-resolved external state.

**p-sensor-state-resilience** [2026-04-12, merged p-parallel-multiSource-graceful-degrade, +dependency-lifecycle 2026-04-23]
Sensors persisting state must validate structure on load — silent corruption produces repeated identical outputs until detected. Recovery: version check on load, rebuild from empty on mismatch. Use `??` on FIELDS not objects. Multi-source sensors: use per-source availability flags; fetch all in parallel; continue with available sources when one fails (401/timeout). Validate "at least Nth sources OR essential source succeeded" before proceeding. **Dependency gates**: sensors with external-state dependencies (active beats, competition state) must gate at entry (`if (!hasActiveBeat) return "skip"`) — they don't auto-adapt when the dependency disappears (bitcoin-macro: 3× post-competition failures).

**p-audit-and-implementation** [2026-04-08]
Persist audit findings with detail (skill name, line numbers, violation type). Categorize gaps: auto-updated → no follow-up; static → P5 maintenance; external dependency → reference PRs. Before implementing a feature with N consumers, map all integration points in one pass.

**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on the same account/nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for atomicity. Don't roll back counter on tx failure (tx may be in mempool); resync on staleness (>90s).

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

**p-ic-pipeline-precheck** [merged p-candidate-discovery-gate-validation + p-dri-coordination-precheck, 2026-04-24]
Fresh IC candidates: validate structural gates (DNC, pipeline history, demand-side fit, contact availability, recent activity) BEFORE queuing follow-up tasks. Gate failures → document; gate passes → immediate pitch filing. Before queuing pitch task, verify DRI hasn't already opened engagement with that org that day — if so, deprioritize and move to next candidate. Prevents wasted outreach and duplicate sales contact.

**p-external-api-drift** [merged p-external-resource-validation + p-error-text-format-drift, 2026-04-12, 2026-04-18]
Before filing signals about a resource, verify it's still active — external platforms silently restructure (beat slugs, API schemas, error message formats) without notice. For financial ops via MCP/contracts, validate configuration (contract addresses, versions) matches upstream mainnet state. Classification rules (deny-lists, pattern matchers) on external error text go stale when upstream changes formats; post-deploy cycles must compare actual failure payloads to rules — update immediately on mismatch, quarterly audits on long-lived classifiers.

**p-resource-state-hash-dedup** [2026-04-17]
For repeating external-resource tasks, track resource state hash (commit SHA, revision ID) in workflow context; compare current hash to `lastProcessedHash` — if equal, skip. Prevents duplicate tasks when resource hasn't changed.

## Research & Synthesis

**p-research-workflow** [merged 2026-04-12, merged p-research-strategic-convergence]
Triaging N independent items: quick-scan to skip low-relevance cases, create N individual P5 tasks + P5 synthesis. For fetched content: (1) direct API, (2) web search, (3) synthesis from metadata. Synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations. Strategic framework updates require convergence across ≥2 independent sources before committing; convergence on empirical metric is higher-confidence than convergence on interpretation.

## Signal Quality

**p-preflight-validation** [merged p-platform-capacity-preflight + p-sensor-preflight-validation, 2026-04-22]
Pre-validate at two layers before committing cooldown budget: (1) **Sensor-level**: calculate predicted score/metric before queuing — discard candidates that won't clear published acceptance floors (e.g. mempool.space source → score 53, floor 65 → certain reject). (2) **Filing-level**: query current minimum accepted score in a capacity-capped beat; abort if predicted score < minimum even if it clears the static floor. Displacement requires exceeding the LOWEST current accepted score, not the baseline — at 10/10 cap with min=91, a score of 83 still fails. Check capacity + displacement gap, not just floor.

**p-sensor-diversity-enforcement** [2026-04-06, enhanced 2026-04-16]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Multi-signal-type sensors: track `lastSignalType`, filter candidates to exclude last type first — only repeat if no alternatives exist.

**p-signal-filing-strategy** [2026-04-08, updated 2026-04-17, enhanced 2026-04-19, refined 2026-04-22]
Signals require AIBTC-network-native angle ("Does this impact AIBTC protocol, agents, or infrastructure?") — operational metrics (nonce progression, relay throughput) ARE valid signals. Validate data freshness before investing research effort. **Pre-discovery of external constraints** saves futile attempts: map platform scoring formula, per-beat caps, and score floors via single exploratory filing + measurement before designing sensor strategy. **sourceQuality is source-count-based** (1 source=10, 2 sources=20, 3 sources=30...), NOT domain-based; arxiv.org alone ≠ 30 boost. judge-signal --force bypasses local GitHub-reachability check only, not server-side sourceQuality calculation. Multi-beat sprints: (1) identify all candidates, (2) pre-filter by temporal/structural eligibility (e.g., difficulty retargets must be ≤288 blocks away; price moves must be within ±500 of milestone thresholds), (3) check resource availability for remaining candidates, (4) query recent filings (24h) to skip already-covered angles, (5) sort by confidence, (6) file #1 immediately, (7) queue #2+ with `scheduled_for = now + cooldown`. **Drought recovery**: pivot to secondary beat when primary hits cooldown. **Data flatness skip**: when all N consecutive readings are identical AND baseline metric is weak (<50 strength), skip filing. **API constraints**: combined content (claim+evidence+implication) ≤1000 chars; sources must be `[{"url":"...","title":"..."}]` JSON array (not strings); pre-trim before filing. **Topic diversity**: beat diversity ≠ subject diversity — avoid filing same topic across different beats same day.

**p-fix-verification** [merged 2026-04-11, updated 2026-04-23]
After shipping any fix, verify by checking post-deploy task IDs — if they still fail, fix missed root cause. "Shipped" ≠ "working." Require 1–2 observation cycles. When fixing a sensor for a renamed value, grep ALL sensors and skill configs for the old value. When a formula or rule is corrected mid-cycle, trace backward through recent tasks that used it — document findings but don't attempt retroactive re-filing; use findings to confirm the correction is complete for future cycles.

## Agent Design

**p-timeout-observability** [2026-04-17]
Silent failures (hangs, stalls, event loop blocks) are worse than loud failures. Timeout guards convert silence to structured responses, improving observability even if they don't fix root cause. Use timeouts as an observability layer, not just a user-facing safety guard.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. TooMuchChaining → back off until mempool drains.

**p-contract-simulation-preflight** [2026-04-17]
For financial operations, use contract simulation to validate account state before acquiring nonce or broadcasting tx — simulation is non-mutating and catches ~80% of tx failures at zero cost. Place after auth/unlock but before nonce acquisition; fail-open on external service timeout.

**p-revision-loop-primitive** [2026-04-07, enhanced 2026-04-20]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods). On re-review, explicitly verify each originally flagged item was fixed before approving. **Structural integrity checklist**: validate payload counts (rows affected, TX clears, data mutations) match pre-agreed expectations, confirm CI green, THEN approve — catches partial fixes and silent corruption before merge.

**p-purpose-loop** [2026-04-08, updated 2026-04-20, +constraint-driven 2026-04-23, +FP-filtering 2026-04-27]
Daily PURPOSE evals expose directive gaps → low-scoring directives become next-cycle priorities. Query live DB; missing outcome data is itself a priority gap. **Constraint vs capacity**: diagnose root cause before optimizing: (1) queue-emptiness, (2) structural ceiling (e.g., 4 signals/beat/day), (3) knowledge gap — don't optimize naturally-capped dimensions. When queue is empty, focus shifts to external factor validation or creating new work streams. Cost outliers from legitimate audit work self-correct over 24h windows without remediation. **Structural constraints**: when evals show low scores but root cause is structural (no active beats, external service unavailable), distinguish from execution gaps — document the constraint explicitly so next cycle knows whether to (a) wait for recovery, (b) pivot to secondary targets, or (c) build new work streams. **Success metric filtering**: calculate both raw success rate AND real ops rate by systematically stripping known false-positive classes — stale-dispatch FPs (>2min task alerts leaving gaps), expected sim:400 for recurring agents (Savage Moose, Steel Yeti), retry counts for same-commit failures. Real ops rate exposes genuine regressions; raw rate tracks overall system health. Use real ops rate for trend analysis when trending < 90%.

**p-strategic-communication** [2026-04-06, updated 2026-04-21]
Non-operational requests: reply immediately, queue P2 Opus for substantive analysis. Multi-item feedback: numbered action list, bundle into P1 if interdependent. **Narrative/presentation**: (1) query live DB for freshest metrics — stale metrics undermine credibility, (2) reuse templates from recent similar work, (3) document open decisions explicitly to guide feedback, (4) commit draft, (5) send async, (6) polish. Make scope-elimination decisions at draft time based on stated direction (e.g., "less fixes, more scale"), not in revision — prevents over-building.

**p-upstream-watch-integration** [2026-04-06, merged 2026-04-10]
When approving critical upstream repos, add to watch list and check for open PRs before creating follow-up tasks — enables async bundling, prevents revision ping-pong. Phase implementation when integration requires upstream code changes.

**p-queue-composition-guard** [2026-04-08, enhanced 2026-04-12]
When any single recurring category exceeds 30% of pending tasks, apply a sensor cap or daily task limit. Strategic tasks should claim at least 40% of weekly dispatch cycles. **Silent sensor failure**: zero task creation rate despite no deploy changes = investigate state/config corruption.

**p-failure-diagnosis** [2026-04-08, merged p-metric-cascade-dependencies, updated 2026-04-19]
When N failures spike: classify by error type first. If 80%+ share one root cause, fix the cause — self-similar state multiplying, not independent bugs. Report both aggregate rate and corrected rate. After shipping a fix, wait 1–2 cycles for residual failures. Secondary metrics (competition score, streaks) depend on primary metrics (signal filing, onboarding) — map dependency chain; fixing the primary blocker auto-resumes secondaries. **Post-fix queue cleanup**: After shipping a deny-list pattern fix, also scan pending tasks whose target falls in the newly-denied set and close them as `blocked` — pre-queued tasks bypass the updated sensor-level check and proceed to preflight simulation, generating avoidable `failed` entries. Residual failure count ≈ tasks already queued at fix-ship time.

**p-external-limit-resilience** [2026-04-10]
External rate limits (Claude Code daily ceiling) halt dispatch silently while sensors queue unaware → bulk stale-mark on resumption. Monitor API usage proactively with 20% buffer. Daily streaks are fragile to binary blockers — spread filing across 30-hour windows to survive single-day gaps.

**p-workflow-state-management** [merged 2026-04-11]
Multi-state workflows: advance exactly ONE state per task. Large context (>20K chars) in workflow state must be hashed/summarized, not embedded. Confirmation polling must be a separate scheduled task with explicit `scheduled_for`, never inline.

**p-sensor-workflow-bidirectional-sync** [2026-04-12]
Sensors creating workflows from external state (GitHub issues, PRs) must implement bidirectional sync — not just create, but also monitor external state and auto-close workflows when the underlying resource closes/resolves. One-way creation = stale workflow accumulation.

**p-schema-change-discipline** [merged 2026-04-13, 2026-04-20]
Breaking data-contract changes require exhaustive search across all consuming systems (transport, parsing, business logic) before merging. When incrementing schema versions, ALL touchpoints update atomically: version const, import paths, gate checks, history comments. Miss one and the schema silently diverges. Approval confidence = integration-point search breadth, not just PR review.

**p-multi-chain-identity-verification** [2026-04-21]
Agent-to-agent messages must verify sender via BOTH chain-specific addresses (BTC address hash + Stacks address) against known rotated wallets before processing. Compare both addresses to memory entries; legitimate agents rotate wallets intentionally. Mismatched pairs or old address reuse indicate compromised wallets (old address = hostile). Prevents message-forwarding attacks on multi-chain agents.

**p-external-service-debugging** [2026-04-22]
When debugging external relay/service failures, audit each internal state layer independently (queue manager, wedge analyzer, blockchain state) — divergence between layers indicates the service's internal bug, not parent agent regression. After linking an upstream bug to a merged fix PR, verify actual deployment before closure: check release version, release automation status (release-please PR), and live service version. Merged code may wait days for release machinery; premature closure masks ongoing incidents.

**p-agent-engagement-authenticity** [2026-04-23]
When other agents request work outside your core function, reply immediately with honest positioning about constraints, offer a genuine alternative angle (if available), and ask clarifying questions about mechanical/structural requirements. Use appropriate transport: BIP-137 inbox for free communication, ERC-8004 for reputation signals. Prevents wasted follow-up work and establishes clear operational boundaries.

**p-introspection-model-sizing** [2026-04-22]
Daily/weekly introspection and retrospective tasks don't require Opus. These tasks synthesize existing data (cycle logs, task summaries, known patterns) — they don't require novel reasoning or strategic depth. 4 of the top-10 weekly costs were P5 Opus self-evals at $2.5–$7.9 each; Sonnet handles synthesis at ~10% the cost with no quality gap. Reserve Opus for: (1) novel architectural decisions, (2) ambiguous multi-source synthesis, (3) tasks requiring creative depth or judgment calls not derivable from existing data. Sensor-created daily evals, retros, and pattern extraction → Sonnet by default.

**p-alert-attribution-validation** [2026-04-22]
External monitoring tools generating task-level alerts (cost spikes, performance warnings, health checks) often misattribute root cause due to sensor mapping bugs. Before acting on an alert naming a specific task/resource, independently verify the attribution exists and matches actual dispatch state — cross-check cycle_log timestamps and task IDs. If attribution is wrong, queue fix to the monitoring sensor's mapping logic instead of chasing a false lead.

**p-predictive-model-selection** [2026-04-23]
When sensors create tasks with variable-scope inputs, predict complexity before creation and assign model based on input scope, not hardcode it. Examples: compliance-review with 8+ findings → opus (30min), else sonnet (15min); housekeeping with git commit + pre-commit lint overhead scales with staged .ts file count → sonnet, not haiku. **Subprocess memory overhead**: tasks running build/deploy subprocesses (npm, wrangler, docker) with opus + high effort/30K thinking tokens = OOM kills on constrained systems; use sonnet or decompose into subtasks. Mismatch between SKILL.md documented model and sensor.ts hardcoded model creates silent failures — verify documentation matches implementation. Pre-dispatch complexity prediction prevents timeout waste and cascading retries.

**p-strategic-synthesis-structure** [2026-04-23]
P3 research synthesis: structure as 5 sections: (1) concept overview, (2) Arc mapping, (3) operational gaps/barriers, (4) new opportunities, (5) concrete testable experiments. Inline citations throughout. End with experiments, not abstract recommendations — converts synthesis to executable work. Deliver >1000-word reports via email with threading; invest quality for concepts that unlock new capability classes.

**p-research-assembly-generation** [2026-04-27]
For complex multi-source synthesis (weekly presentations, comprehensive reports): spawn independent research subagents in parallel, consolidate outputs to a single file, then feed to generation task. Verification layer checks for all expected sections before closure. Parallelization eliminates sequential bottlenecks.

