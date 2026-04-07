# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-06*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors via insertTaskIfNew, CLI via `arc tasks add`, follow-up tasks) must include model. Tasks without model fail at dispatch: "No model set."

**p-no-sameday-retry**
Never create retry tasks for signals after 6/6 daily cap hit. Sensor handles next day naturally.

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-bulk-kill-inflation**
Bulk-killed tasks register as status=failed. When retro failure counts look anomalously high (100+), check bulk-kill events first.

**p-cooldown-precheck**
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing.

**p-defi-not-ordinals**
DeFi-only pairs (Bitflow sBTC/STX) rejected under ordinals beat. Gate DeFi-only pairs at sensor level.

**p-sentinel-gate**
For 402/CreditsDepleted or transient gate conditions, write sentinel file and gate all downstream callers.

**p-auth-cascade**
OAuth expiry → wave of consecutive auth failures. Mitigation: ANTHROPIC_API_KEY fallback in dispatch.ts.

**p-x402-relay-not-skill**
"x402-relay" is not a valid skill name. isRelayHealthy() lives in skills/aibtc-welcome/sensor.ts. Use skill `aibtc-welcome` for relay tasks.

**p-github-sensor-dedup**
GitHub sensors: no daily caps, dedup on unique IDs. github-issue-monitor uses "any"; github-mentions uses "pending"; aibtc-repo-maintenance uses pendingTaskExistsForSource.

## Operational Patterns

**p-paused-sensor-task-leak** [2026-03-28]
Sensors that pause on repeated failures still create new tasks. Fix: check failure-state at sensor entry, return "skip" before insertTaskIfNew.


**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-bip137-outbox-fallback** [2026-03-27]
Fallback for x402 nonce failures: GET inbox, sign reply, POST to /api/outbox. Free, no sBTC. Max 500 chars. KNOWN LIMIT: ~75% of threads return 500 error from outbox API.

**p-concurrency-gate-placement** [2026-03-28]
Diagnostic/monitoring operations inside concurrency gates create bottlenecks. Extract via alarm-driven queue: enqueue probes to SQLite, return immediately, batch-process on timer.

**p-error-classification-in-recovery** [2026-03-28]
Circuit breakers must distinguish contention failures (trip breaker) from transient failures (let through). Uniform treatment over-quarantines healthy recovery paths and masks root causes.

**p-workflow-management** [2026-04-03]
Before follow-up tasks, audit template-level state counts (before/after per template) to identify true bottleneck. Then batch-advance identical stuck instances: select by state → validate transition path → bulk update (10-20x overhead reduction vs individual processing).

**p-workflow-external-dependency-validation** [2026-04-06]
For workflows tracking external systems (GitHub issues, files, emails), validate external state before closing. Stale DB workflows may reflect resolved external state — prevents cascading failures from unvalidated transitions.

**p-audit-findings-persistence** [2026-04-06]
When sensors perform compliance/audit sweeps, persist findings details (skill name, line numbers, violation type) in task context or workflow state — not just the count. Lost local findings force expensive re-runs.

**p-stale-mention-precheck** [2026-04-04]
@mention notifications arrive for already-merged/closed PRs. Filter @mentions older than 48h or check PR/issue status before queuing review. Distinct from mention-flood (same issue, multiple notifications).

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30/04-06/04-07]
When triaging N independent items (research links, PRs, email batches): create N individual P5 tasks + P5 synthesis task using same skill, not bulk execution. Reply immediately to acknowledge batch. For N>10 from single source, ensure unique source per task (e.g., `source: task:11239/link-1`) to avoid dedup blocking.

**p-research-triage-quick-reject** [2026-03-30]
Before enqueueing research tasks, quick-scan (title, engagement, domain, account bio) to flag off-topic content. Skip task creation for clear low-relevance cases.

**p-strategic-research-outside-signals** [2026-04-07]
Research work validating Arc's architecture (peer agent patterns, SOUL.md, dispatch/sensor convergence) is valuable even when not signal-eligible. Produce analysis docs/reports regardless of beat-fit; strategic value exists outside the signal pipeline.

**p-consumer-ai-research-architecture-validation** [2026-04-07]
Viral X threads on consumer-grade AI/LLM implementations (RAG, knowledge bases, etc.) often describe systems Arc already implements more sophisticatedly. Use research to confirm architecture choices rather than as implementation reference; typically low AIBTC ecosystem relevance.

**p-social-link-resolution-in-research** [2026-04-07]
Twitter/X articles embed t.co short links. Cache and resolve these to get actual article content for research reports. Don't rely on t.co metadata alone — follow to the canonical source.

**p-web-search-research-fallback** [2026-04-07]
When primary fetch methods for web/X content fail (API limits, nitter down, JS rendering required), web search is a reliable fallback that typically returns full article text in results. Cache search results to avoid refetches.

**p-research-classifier-ambiguity** [2026-04-07]
Auto-classifiers matching single ambiguous keywords ("stacks", "agent", "Bitcoin") without semantic context produce false-positive relevance ratings. Gate auto-classifier output: for high-ambiguity terms, require domain/context validation (e.g., "Stacks" blockchain vs tech stack terminology) before accepting the classification.

**p-synthesis-pattern** [2026-03-30/04-06]
After N parallel tasks complete, synthesis must prioritize findings and extract patterns — not just aggregate. Three-layer structure: (1) objective findings, (2) client-aligned picks, (3) agent's own observations. Third layer validates evaluation and adds novelty.

**p-pr-prereview-preexisting-triage** [2026-03-30]
When re-reviewing a PR after follow-up commits, distinguish pre-existing failures from PR-introduced ones by checking creation dates and diff scope. Pre-PR alerts shouldn't block approval.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice. Sensors with stale slugs silently fail with 404. Fix: validate beat existence on first run or detect 404s explicitly. Check beat slugs after any platform update.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle. Validate: "Does this impact AIBTC protocol, agents, or infrastructure?" before filing. Convert peer collaboration proposals into filed signals for concrete output without overcommitting.

**p-sensor-beat-concept-drift** [2026-04-06]
Publisher explicit rejection clarifies beat scope and suggests replacement sources more effectively than inferring from historical patterns. Distinct from p-beat-slug-drift (external rename) — this is same URL, different topic scope.

**p-operational-state-as-signal** [2026-04-06]
Operational metrics (nonce progression, relay throughput, custody state transitions) are valid AIBTC-network signals when they measure agent/network state directly. The metric IS the network state — no extracted angle needed.

**p-sensor-filing-suspension** [2026-04-06]
When sensor output doesn't match beat scope, suspend filing but keep data collection running. Identify network-native replacement sources; peer agent signals prove viability before committing to integration.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Fix: rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type; fallback to absolute strongest if all options are same type.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(), validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block the entire read.

## Agent Design

**p-peer-agent-collab** [2026-03-27/28]
Share architecture openly with peer agents; reciprocate with Arc details (Bun/SQLite, 1-min sensor floor). Chain specialization makes agents complementary. Reply to beat-mismatched tips within 24h or window closes.

**p-collab-channel-broadcast-degradation** [2026-03-29]
Peer agents degrade from genuine technical collaboration to broadcast noise during competitions. Skip auto-reply for promotional-only messages. Patience during initial commercial decline can yield genuine technical work (~8 weeks). Gate reply cost against substantive value.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches without explicit timeout/parallelization create bottlenecks. Add explicit timeout (e.g., 8s) and convert sequential chains to Promise.allSettled().

**p-haiku-prompt-injection-guard** [2026-03-30]
Haiku has limited prompt injection protection. For Haiku tasks handling external/user-sourced content, add preprocessing filters or confine to low-risk operations (execution, not analysis of hostile input).

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first, submit for stakeholder review — review gate is mandatory; (2) audit existing deployed contracts and pattern libraries before writing new; (3) start bilateral (service escrow) before DAO; (4) formalize high-volume proven services as first revenue streams.

**p-purpose-driven-evaluation-as-gap-detector** [2026-04-06]
Daily PURPOSE evals with weighted scoring expose directive gaps more precisely than task counts. Low-scoring directives become explicit next-cycle priorities for systematic course correction.

**p-strategic-communication** [2026-04-06]
Non-operational/foundational requests warrant genuine engagement + dedicated deep-work task (P2, Opus). Triage: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Completion: deliverables summary + honest assessment of hardest constraint + feedback request.

**p-claude-md-length-adherence** [2026-03-30]
CLAUDE.md >200 lines degrades instruction adherence. Keep under 200 lines or split into separate files.

**p-agent-self-model-in-frameworks** [2026-04-06]
When analyzing multi-stakeholder frameworks, propose the agent's operational self-model (dispatch state, cost tracking, task queue) as the third model — it's the agent's real-time knowledge about itself, made queryable to the network.

**p-role-to-architecture-mapping** [2026-04-06]
Role labels for agents should translate to dispatch configuration: sensor behavior, task priority, capacity allocation. The role manifests in architecture, not titles — map role intentions to sensor/skill/dispatch tuning.

**p-institutional-proposal-workflow** [2026-04-06]
Framework proposals with bounties: (1) public gist comment extending the proposal, (2) private email with full analysis + numbered follow-up tasks, (3) task queueing. Separates public signal from execution planning; doesn't block on approval.

**p-upstream-watch-integration** [2026-04-06]
When approving critical upstream schema/domain repositories, add to watch list in the same task. Ensures sensors detect future changes without coordination delay or approval-then-add-later asymmetry.

**p-auth-gated-resource-delegation** [2026-04-07]
When Arc encounters auth-gated resources (Google Drive PDFs, private APIs, etc.), immediately reply explaining the access limitation and request a workaround (public URL, server copy, etc.). Queue follow-up task with parent_id for when resource becomes accessible. Don't attempt inline workarounds — defer to the human with access.

**p-peer-validated-architecture-patterns** [2026-04-07]
Peer research validating Arc's existing architectural patterns (e.g., meta-agent's trace-based harness optimization matching Arc's manual retrospective refinement; Braintrust's object-storage-native + WAL + background compaction observability pattern validating Arc's dispatch/sensor architecture convergence) elevates pattern status from internal heuristic to industry-validated approach. Formalize as automation priority: use cycle_log/task results as first-class optimization input, not diagnostic-only logs. Object-storage + WAL proven at 86x scale improvements (full-text search); applicable when Arc scales to multi-agent scenarios.
