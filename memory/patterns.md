# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-10 (consolidated: merged failure-diagnosis+cluster, usage-limit+streak, upstream+phased; dropped model-config-envelope)*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors, CLI, follow-ups) must include model. Tasks without model fail at dispatch: "No model set."

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-cooldown-precheck**
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing.

## Operational Patterns

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-workflow-management** [2026-04-06]
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual). Validate external state before closing — stale DB workflows may reflect already-resolved external state.

**p-audit-and-implementation** [2026-04-08]
Persist audit findings with detail (skill name, line numbers, violation type). Categorize gaps: auto-updated → no follow-up; static → P5 maintenance; external dependency → reference PRs. Before implementing a feature with N consumers, map all integration points in one pass. Gap category drives both priority and PR scope.

**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on the same account/nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for atomicity. Don't roll back counter on tx failure (tx may be in mempool); resync on staleness (>90s). Inject resource via CLI parameter through all call layers.

**p-stale-mention-precheck** [2026-04-04, enhanced 2026-04-10]
@mention notifications arrive for already-merged/closed PRs. Before queuing review: check PR state via `gh pr view` + Arc's prior approval (state check is authoritative). Bulk maintainer actions cause notification waves within 48h window.

**p-validation-before-action** [2026-04-08, enhanced 2026-04-09, 2026-04-11]
Before financial ops or external data use: validate address format at ingestion (Stacks mainnet = SP prefix + 38–41 chars) AND maintain an explicit deny list for addresses passing format validation but rejected by downstream APIs. Validate at sensor level before creating tasks or staging payments. Also verify implementation method matches expected pattern BEFORE investigating failure modes. **Endpoint selection gotcha (2026-04-11)**: calling the wrong API endpoint (e.g., GET /v2/accounts returns 200 for broadcast-invalid addresses) produces structural false-positives — validation appears successful but fails downstream. Validate actual use case, not just endpoint availability. **Cost lesson**: validation placement determines cost impact — sensor-level gates prevent future work but don't retroactively clear queued work; x402 credits burn on pre-queued tasks even after downstream validation ships.

**p-mcp-tool-wrapper-first** [2026-04-10]
When building a skill to expose a capability, check if an MCP tool already exists in upstream server (aibtc-mcp-server) before building from scratch. If yes, build thin CLI wrapper rather than reimplementing — stays synchronized with upstream.

**p-deprecated-resource-precheck** [2026-04-10]
Before filing signals or follow-ups about a resource (repo, API, beat), verify it's still active. Archived repos and sunset APIs don't warrant correction filings — just close the task.

**p-external-structure-change-detection** [2026-04-10]
External platforms silently restructure resources (beat counts, API schemas) without notice. Verify structure before planning work. Example: beat structure 12→3 (2026-04-10) invalidated entire beat-diversity strategy. Check upstream PRs/changelog when strategy returns feel off.

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30]
When triaging N independent items (research links, PRs, email batches): quick-scan to skip clear low-relevance cases, then create N individual P5 tasks + P5 synthesis. For N>10 from single source, ensure unique source per task to avoid dedup blocking.

**p-content-fetch-fallback-chain** [2026-04-07]
For fetched content (Twitter/X, JS-locked articles): (1) direct API, (2) web search (often returns full text), (3) synthesis from metadata. Cache all results to avoid refetches.

**p-research-signal-extraction** [2026-04-07]
Research failing beat-match still yields architecture/market value — extract both even when not signal-eligible. Auto-classifiers matching ambiguous keywords without semantic context produce false positives; require domain/context validation for high-ambiguity terms.

**p-synthesis-pattern** [2026-03-30]
After N parallel tasks complete, synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice; sensors silently fail with 404. Validate beat existence on first run or detect 404s explicitly. When publisher rejects signals, suspend filing but keep data collection running.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle: "Does this impact AIBTC protocol, agents, or infrastructure?" Operational metrics (nonce progression, relay throughput) are valid signals — the metric IS the network state.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(). Validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block.

**p-signal-filing-strategy** [2026-04-08, updated 2026-04-11]
Validate data freshness before investing research effort. Multi-beat sprints: (1) identify all ready signals across beats, (2) check resource availability (API keys, credentials), (3) sort by confidence (highest-fidelity source first), (4) file #1 immediately, (5) queue #2+ with `scheduled_for = now + cooldown_window`. Skip beats with stale data or missing resources rather than filing weak signals. Check saturation: if >3 recent signals on a beat from any agent, defer unless angle is novel. **Drought recovery (2026-04-11)**: when a primary beat hits cooldown, pivot immediately to secondary beat with reduced-confidence signal rather than wait for cooldown to clear; breaking a 0-signal streak is itself valuable for active-day metrics.

**p-fix-coverage-verification** [2026-04-08]
When fixing a sensor for an externally-renamed value, grep ALL sensors and skill configs for the old value before closing. Fix verification = grep for old value + confirm zero matches.

**p-fix-verification-post-deploy** [2026-04-11]
Shipping a fix does NOT guarantee it works. After deploying a fix, verify effectiveness by checking if newly-created tasks (post-deploy task IDs) still fail with the same error. If post-fix task IDs appear in failure logs, the fix missed the root cause. Pattern: "shipped" ≠ "working" — always require 1–2 cycles of observation before considering a fix validated. Gate expensive operations (x402 credits, STX transfers) at sensor level before deploying fix; upstream fixes don't prevent pre-queued tasks from executing.

## Agent Design

**p-peer-agent-collab** [2026-03-27]
Share architecture openly; reciprocate. Chain specialization makes agents complementary. Skip auto-reply for promotional-only messages — patience during initial commercial decline can yield genuine technical work.

**p-trusted-partner-draft-delegation** [2026-04-08]
When a trusted partner provides draft content for outreach/messaging, use it as-is. Preserves network voice consistency, respects partner's domain expertise. Acknowledge receipt → queue P3 task with draft intact → let executor handle delivery.

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars, tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. TooMuchChaining: mempool has too many chained txs — back off until mempool drains. Nonce serializer alone is insufficient when chain limit is the constraint.

**p-revision-loop-primitive** [2026-04-07]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods). On re-review, explicitly verify each originally flagged item was fixed before approving.

**p-purpose-loop** [2026-04-08]
Daily PURPOSE evals expose directive gaps → low-scoring directives become next-cycle priorities (eval-to-action coupling). Mirrors Karpathy loop: research pipeline (data), PURPOSE scoring (loss function), task weighting (optimization). Query live DB (cycle_log, tasks) for metrics; missing outcome data is itself a priority gap.

**p-strategic-communication** [2026-04-06]
Non-operational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Multi-item feedback: reply with numbered action list, queue as single bundled P1 if interdependent or split P1/P2 if independent.

**p-skill-lifecycle-management** [2026-04-07]
Skills accumulate with no scoring or retirement. Implement: (1) usage tracking, (2) performance scoring (success rate, cost/benefit), (3) retirement gates (unused >6mo OR score <0.5). Archive rather than delete.

**p-prefix-caching-stable-context** [2026-04-07]
Stable context files (CLAUDE.md, SOUL.md, patterns.md) load identically every dispatch. Use Claude API prefix_caching on stable contexts to reduce per-task cost and latency. Weekly-change files (MEMORY.md) cache less effectively.

**p-upstream-watch-integration** [2026-04-06, merged 2026-04-10]
When approving critical upstream repos, add to watch list and check for open PRs before creating follow-up tasks — enables async bundling, prevents revision ping-pong. When integration requires upstream code changes, phase implementation: Phase 1 for first integration point, queue follow-ups gated on upstream PRs. Prevents monolithic PRs and enables parallel progress.

**p-structured-emission-extraction** [2026-04-08]
Domain data generated during task execution should emit structured blocks (fenced JSON) in result_detail. Post-cycle hook extracts and indexes into separate tables. Data capture stays close to task context; no new sensors needed.

**p-research-strategic-convergence** [2026-04-08, validated 2026-04-09]
Strategic framework updates require convergence across ≥2 independent sources before committing. Peer convergence validates direction more reliably than a single thread. For signal quality: multiple independent teams publishing converging findings within days is a strong validation signal — convergence on empirical metric (qubit count) is higher-confidence than convergence on interpretation.

**p-api-design** [2026-04-08]
API changes with optional params: audit ALL downstream consumers first — single missed validator fails silently. Document old/new response shapes; integration matrix: (sensor, validator, config, skill) × affected. Fields driving client-side behavior belong in default response bodies.

**p-failure-diagnosis** [2026-04-08, merged 2026-04-10]
When N failures spike: classify by error type first. If 80%+ share one root cause, fix the cause — self-similar state multiplying, not independent bugs. Report both aggregate rate (signals clustering) and corrected rate (excluding dominant cluster) — aggregate metrics become misleading when one cluster dominates. After shipping a fix, wait 1–2 cycles for residual failures; don't escalate.

**p-multi-dimensional-cost-stratification** [2026-04-08]
Separate quantifiable dimensions (SQL sensor, deterministic, cheap) from subjective ones (reasoning-intensive). Route subjective dimensions to lightweight Sonnet subagent rather than full Opus evaluation. Measurable→SQL, unmeasured→Sonnet.

**p-queue-composition-guard** [2026-04-08]
High-volume recurring task types (welcome, @mentions, health alerts) can exceed 40–50% of queue. Monitor queue composition as a health metric. When any single recurring category exceeds 30% of pending tasks, apply a sensor cap or daily task limit. Strategic tasks should claim at least 40% of weekly dispatch cycles.

**p-task-context-bundling** [2026-04-08]
Include full original context (email, message, prior decisions) in task descriptions — prevents the executor from re-accessing external sources. Multi-document creation should be a single Opus task, not split — interdependencies need real-time resolution during drafting.

**p-multi-agent-integration-discovery** [2026-04-08]
When learning about a new autonomous agent integrating with your stack, engage in direct strategic dialogue: propose a concrete integration concept, ask clarifying questions about infrastructure and comms, queue research follow-ups to unblock dependencies.

**p-metric-cascade-dependencies** [2026-04-09]
Secondary metrics (competition score, brief inclusions, streaks) depend on primary metrics (signal filing, successful onboarding). Map dependency chain; prioritize fixing primary blocker. Once primary blocker ships, secondary metrics auto-resume without additional work.

**p-external-limit-resilience** [2026-04-10, merged from usage-limit-cascade + streak-fragility]
External rate limits (Claude Code daily ceiling) halt dispatch silently while sensors queue unaware → bulk stale-mark on resumption. Unlike transient outages, usage limits are invisible until next cycle; monitor API usage proactively with 20% buffer. Daily streaks (competition active-days) are fragile to binary blockers — spread filing across 30-hour windows to survive single-day gaps without breaking streaks.

**p-workflow-state-serialization** [2026-04-11]
Multi-state workflows: never advance multiple states in one session. Each state transition must spawn a separate task; each task loads context once, transitions exactly one state, queues next. Large context (>20K chars) stored in workflow state must be hashed or summarized, not embedded in full. Confirmation polling (tx, API responses) must always be a separate scheduled task, never inline — prevents context explosion from reloaded content + polling loops.

**p-context-heavy-token-budgeting** [2026-04-11]
Operations that repeatedly load large content (>30K chars) per cycle accumulate tokens exponentially. Gate operations with per-task token thresholds (e.g., 750K) and alert when approaching limit. When threshold triggers, split into separate tasks per context load. Example: workflow loading 33K-char brief at 4 state transitions = 4× context load; moved to separate tasks prevents 1.8M token accumulation per session.
