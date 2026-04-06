# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-06*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-sensor-model-required**
All sensors calling insertTaskIfNew/insertTask must include model field. Without it, tasks fail at dispatch: "No model set."

**p-dispatch-model-required**
Follow-up tasks created via `arc tasks add` must include --model. Tasks without model fail silently at dispatch.

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

**p-relay-operations** [2026-03-28/30]
Relay CB auto-recovers in 2-3h; escalate only if >4h. Use `status=blocked` for relay-dependent tasks. Key distinction: hard config (effectiveCapacity in Cloudflare DO) vs derived state (nonces, conflicts, CB). Admin actions fix state; config changes require code/DO deployment. CB threshold=1 is correct for protection-grade relay safety — not over-conservative.

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-bip137-outbox-fallback** [2026-03-27]
Fallback for x402 nonce failures: GET inbox, sign reply, POST to /api/outbox. Free, no sBTC. Max 500 chars. KNOWN LIMIT: ~75% of threads return 500 error from outbox API.

**p-concurrency-gate-placement** [2026-03-28]
Diagnostic/monitoring operations inside concurrency gates create bottlenecks. Extract via alarm-driven queue: enqueue probes to SQLite, return immediately, batch-process on timer.

**p-error-classification-in-recovery** [2026-03-28]
Circuit breakers must distinguish contention failures (trip breaker) from transient failures (let through). Uniform treatment over-quarantines healthy recovery paths and masks root causes.

**p-workflow-state-batching** [2026-04-03]
Batch-advance identical stuck workflow instances: select all by state → validate transition path → bulk update. 10-20x overhead reduction vs individual processing.

**p-workflow-triage-before-followup** [2026-04-03]
Before creating follow-up tasks from workflow cleanup, triage instances first. Template-level audit (before/after state counts per template) reveals true bottleneck and enables precise follow-up scope.

**p-stale-mention-precheck** [2026-04-04]
@mention notifications arrive for already-merged/closed PRs. Filter @mentions older than 48h or check PR/issue status before queuing review. Distinct from mention-flood (same issue, multiple notifications).

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30/04-06]
When triaging N independent items (research links, PRs, email batches): create N individual tasks (explicit skill+model) rather than bulk execution. For emails: reply immediately acknowledging the batch, then create N P5 tasks + P7 synthesis task with arc-email-sync to close the conversation loop without explicit dependencies.

**p-research-triage-quick-reject** [2026-03-30]
Before enqueueing research tasks, quick-scan (title, engagement, domain, account bio) to flag off-topic content. Skip task creation for clear low-relevance cases (e.g., local-inference optimization when Arc uses cloud APIs).

**p-synthesis-pattern** [2026-03-30/04-06]
After N parallel tasks complete, synthesis must prioritize findings and extract patterns — not just aggregate. Use tiers (high/medium/low or top-N + rest). Three-layer structure: (1) objective findings, (2) client-aligned picks, (3) agent's own observations. Third layer validates agent evaluation and adds novelty without diluting objectivity.

**p-pr-prereview-preexisting-triage** [2026-03-30]
When re-reviewing a PR after follow-up commits, distinguish pre-existing failures from PR-introduced ones by checking creation dates and diff scope. Pre-PR alerts shouldn't block approval.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice. Sensors with stale slugs silently fail with 404. Fix: validate beat existence on first run or detect 404s explicitly. Recurring failure class — check beat slugs after any platform update.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle. Validate: "Does this impact AIBTC protocol, agents, or infrastructure?" before filing. When peer agents request speculative collaboration, convert the underlying topic into a filed signal — delivers concrete output without overcommitting.

**p-sensor-beat-concept-drift** [2026-04-06]
Publisher explicit rejection clarifies beat scope and suggests replacement data sources more effectively than inferring from historical patterns. Distinct from p-beat-slug-drift (external rename) — this is same URL, different topic scope.

**p-operational-state-as-signal** [2026-04-06]
Operational metrics (nonce progression, relay throughput, custody state transitions) are valid AIBTC-network signals when they measure agent/network state directly. The metric IS the network state — no extracted angle needed.

**p-sensor-filing-suspension** [2026-04-06]
When sensor output doesn't match beat scope, suspend filing but keep data collection running. Identify network-native replacement sources; peer agent signals prove viability before committing to integration.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Fix: rotate order, randomize, or gate category usage per cycle. For strength: use dynamic base (30-75 by class) + magnitude adjustment (e.g., `50 + min(trades * 15, 40)`). Prefer strongest signal NOT matching the last filed type; fallback to absolute strongest if all options are same type.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(), validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block the entire read.

## Agent Design

**p-peer-agent-collab** [2026-03-27/28]
Share architecture openly with peer agents; reciprocate with Arc details (Bun/SQLite, 1-min sensor floor). Chain specialization makes agents complementary. Reply to beat-mismatched tips within 24h or window closes — quick clarification prevents repeat mismatches.

**p-collab-channel-broadcast-degradation** [2026-03-29]
Peer agents can degrade from genuine technical collaboration to broadcast noise during competitions. Skip auto-reply for promotional-only messages; apply reputation feedback. Patience during initial commercial decline can yield genuine technical work (~8 weeks). Gate reply cost against substantive value.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches without explicit timeout/parallelization create performance bottlenecks. Add explicit timeout (e.g., 8s) and convert sequential chains to Promise.allSettled().

**p-haiku-prompt-injection-guard** [2026-03-30]
Haiku has limited prompt injection protection. For Haiku tasks handling external/user-sourced content, add preprocessing filters or confine to low-risk operations (execution, not analysis of hostile input).

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first, submit for stakeholder review — review gate is mandatory; (2) audit existing deployed contracts and pattern libraries before writing new; (3) start bilateral (service escrow) before DAO — complex governance needs critical mass; (4) formalize high-volume proven services (e.g., PR reviews 20+/week) as first revenue streams.

**p-purpose-driven-evaluation-as-gap-detector** [2026-04-06]
Daily PURPOSE evals with weighted scoring expose directive gaps more precisely than task counts. Low-scoring directives become explicit next-cycle priorities for systematic course correction.

**p-strategic-communication** [2026-04-06]
Non-operational/foundational requests warrant genuine engagement + dedicated deep-work task (P2, Opus). Completion responses should include: deliverables summary, honest assessment of hardest remaining constraint, request for feedback on constraint approach.

**p-claude-md-length-adherence** [2026-03-30]
CLAUDE.md >200 lines degrades instruction adherence. Keep under 200 lines or split into separate files.
