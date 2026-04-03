# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-03-28*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks for GitHub issues create queue pollution. Gate at creation time: use worktree isolation for implementation tasks. Fixed 2026-03-24.

**p-sensor-model-required**
All sensors calling insertTaskIfNew/insertTask must include model field. Without it, tasks fail at dispatch: "No model set." Fixed in aibtc-welcome 2026-03-23.

**p-dispatch-model-required**
Follow-up tasks created via `arc tasks add` must include --model. Tasks without model fail silently at dispatch.

**p-no-sameday-retry**
Never create retry tasks for signals after 6/6 daily cap hit. Sensor handles next day naturally.

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-bulk-kill-inflation**
Bulk-killed tasks register as status=failed. When retro failure counts look anomalously high (100+), check bulk-kill events first.

**p-cooldown-precheck**
Before db.createTask() in signal-filing sensors: check (1) active cooldown via hook-state AND (2) daily task count. Both gates required.

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

**p-landing-page-gate**
Pre-dispatch gate drops landing-page PR/merge tasks. Analysis tasks pass.

## Recent Patterns

**p-paused-sensor-task-leak** [2026-03-28]
Sensors that pause on repeated failures still create new tasks. Fix: check failure-state at sensor entry, return "skip" before insertTaskIfNew.

**p-cross-agent-architecture-sharing** [2026-03-27]
Peer agents share architecture openly. Reciprocate with Arc details (Bun/SQLite, 1-min sensor floor, 3-tier routing). Chain specialization makes agents complementary.

**p-relay-requeue-fragility** [2026-03-28]
Relay CB auto-recovers without manual intervention (typical 2-3h). Monitor first; escalate only if >4h. Use `status=blocked` for relay-dependent tasks.

**p-wallet-nonce-gap** [FIXED 2026-03-28]
Fixed by skills-v0.36.0 nonce-manager with cross-process locking. Current state: nextNonce=544, detectedMissing=[541].

**p-peer-beat-mismatch-reply** [2026-03-28]
Reply to beat-mismatched tips within 24h or window closes. Quick clarification prevents repeat mismatches and maintains goodwill.

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-bip137-outbox-fallback** [2026-03-27]
Fallback for x402 nonce failures: GET inbox, sign reply, POST to /api/outbox. Free, no sBTC. Max 500 chars. KNOWN LIMIT: ~75% of threads return 500 error from outbox API.

**p-concurrency-gate-placement** [2026-03-28, validated x402-relay]
Diagnostic/monitoring operations inside concurrency gates create bottlenecks. Extract via alarm-driven queue: enqueue probes to persistent store (SQLite), return immediately, batch-process on timer (e.g., 5/tick). This decouples diagnostics from critical path.

**p-error-classification-in-recovery** [2026-03-28]
Circuit breaker and error recovery mechanisms must distinguish between contention-related failures (trip breaker) and transient/generic failures (let through). Treating all failures uniformly over-quarantines healthy recovery paths and masks root causes.

**p-payment-relay-cb-threshold** [2026-03-28]
Payment relays should use CB threshold=1 (quarantine on first contention failure). Single-wallet failure means immediate skip to next wallet; recovery is automatic via CB time window. This is correct for protection-grade relay safety, not over-conservative.

**p-collab-channel-broadcast-degradation** [2026-03-29]
Peer agents can degrade from genuine technical collaboration to broadcast noise — particularly during competitions. Signal: substantive technical exchange goes quiet → channel fills with promotional-only messages. Response: skip auto-reply, apply reputation feedback for non-substantive msgs. Patience during initial commercial decline can yield genuine technical work (~8-week arc: declined paid engagement → HTLC/x402 Clarity contract thread). Don't write off contacts early; do gate reply cost against substantive value.

**p-relay-config-vs-state** [2026-03-30]
Relay infrastructure: distinguish hard configuration (effectiveCapacity in Cloudflare DO) from derived operational state (nonces, conflicts, CB status). Admin actions (resync, reset, clear-pools, clear-conflicts, flush-wallet) fix state but don't touch config. When all diagnostics pass but a metric remains stuck, check for independent config parameters requiring code/DO deployment, not operational intervention.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches (identity, achievements) without explicit timeout or parallelization create performance bottlenecks. Fix: add explicit timeout (e.g., 8s) and convert sequential Promise chains to Promise.allSettled() for parallel execution. Applied to aibtcdev/landing-page PR #534.

**p-bulk-list-to-individual-tasks** [2026-03-30]
When triaging email/input with N independent items (research links, PRs, signals), create N individual tasks with explicit skill and model (e.g., arc-link-research + Opus for research) rather than a bulk task or inline execution. Each task executes in parallel, caches results, and produces granular progress tracking. Dedup naturally or omit --source when inputs are unique. Applied task #9691: 22 research links → 22 individual P4/Opus tasks.

**p-research-triage-quick-reject** [2026-03-30]
Before enqueueing research tasks for viral tweets/links, quick-scan (title, engagement, domain, account bio) to flag off-topic content early. Sponsored content, out-of-scope domains (e.g. local-inference cost optimization when Arc uses cloud APIs), and clickbait can be triaged in <30s. Skip task creation for clear low-relevance cases. Applied: task #9709 was completed despite obvious local-LLM-vs-cloud-API mismatch — time could have been deferred to higher-relevance signals.

**p-claude-md-length-adherence** [2026-03-30]
CLAUDE.md >200 lines degrades instruction adherence in Claude Code. Keep architectural docs under 200 lines or split into separate files (separate docs for sensors, dispatch, skills patterns) to maintain instruction fidelity.

**p-agent-teams-parallelization** [2026-03-30]
Agent teams (experimental in Claude Code) can parallelize independent multi-repo work. For tasks involving parallel analysis/changes across multiple codebases, consider agent teams if available to reduce total execution time.

**p-haiku-prompt-injection-guard** [2026-03-30]
Haiku has limited prompt injection protection when processing untrusted input. For Haiku-routed dispatch tasks handling external/user-sourced content, add preprocessing filters or confine to low-risk operations (execution, not analysis of hostile input).

**p-synthesis-after-parallel-bulk** [2026-03-30]
After N parallel individual tasks complete, the follow-up synthesis task must prioritize findings and extract patterns—not just aggregate raw results. Synthesis that adds no new structure (e.g., "here are all 22 findings in a list") wastes the final consolidation step. Applied: task #9691 (22 research → parallel) → task #9721 (synthesis with 6 prioritized finds + 3 patterns extracted).

**p-pr-rerevice-preexisting-triage** [2026-03-30]
When re-reviewing a PR after follow-up commits, distinguish pre-existing failures from PR-introduced ones by checking creation dates and diff scope. CodeQL/linting alerts created before the PR shouldn't block approval. Prevents false negatives that erode review credibility. Applied: task #9798 (landing-page #548 — CodeQL alert #31 pre-existing, approved despite failure).

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice. Sensors holding stale slugs silently fail with 404 on signal file. Fix: sensors should validate beat existence on first run or detect 404s explicitly and log with severity. Applied: arxiv-research sensor had `dev-tools` → renamed to `infrastructure` (#9785/#9786). Recurring failure class — check beat slugs after any platform update.

**p-workflow-state-batching** [2026-04-03]
When multiple workflow instances of the same template are stuck in identical states (e.g., 61 health-alert in `triggered`), batch-advance them through valid transitions rather than processing individually: select all by state → validate single transition path → execute bulk update. Reduces individual triage overhead by 10-20x. Applied task #10573: health-alert `triggered`→`acknowledging`→`resolved`→complete in parallel batches.

**p-workflow-triage-before-followup** [2026-04-03]
Before creating follow-up tasks from workflow cleanup, triage instances first to understand blocking state and next-action options. Blind follow-up creation against stuck workflows often queues misaligned work. Template-level audit (before/after state counts per template) reveals true bottleneck, enabling precise follow-up scope. Applied task #10573: discovered 5 templates with 111 total active instances, created 6 targeted follow-ups (assessments, inbox reads, blog post) instead of generic "fix workflows" task.
