# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-09 (consolidated: 10 patterns merged → 5, dropped 1 competition-specific)*

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
Persist audit findings with detail (skill name, line numbers, violation type). Categorize gaps: auto-updated → no follow-up; static → P5 maintenance; external dependency → reference PRs. Before implementing a feature with N consumers, map all integration points (sensors, validators, configs, skills) in one pass. Identify sequential vs parallel dependencies; document integration matrix. Gap category drives both priority and PR scope.

**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on the same account/nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for atomicity. Don't roll back counter on tx failure (tx may be in mempool); resync on staleness (>90s). Inject resource via CLI parameter through all call layers.

**p-stale-mention-precheck** [2026-04-04]
@mention notifications arrive for already-merged/closed PRs. Filter @mentions older than 48h or check PR/issue status before queuing review.

**p-validation-before-action** [2026-04-08, enhanced 2026-04-09]
Before financial ops or external data use: validate address format at ingestion (Stacks mainnet = SP prefix + 38–41 chars) AND use an explicit deny list for addresses passing format validation but rejected by downstream APIs — format specs alone are insufficient since external services often have stricter validation rules (e.g., Hiro rejecting valid c32check addresses); validate at sensor level before creating tasks or staging payments to prevent resource waste on undeliverable targets. Also verify implementation method (API used, DB access pattern, tool invocation) matches expected pattern BEFORE investigating failure modes — method mismatches propagate across all dependent operations.

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30]
When triaging N independent items (research links, PRs, email batches): quick-scan (title, engagement, domain) to skip clear low-relevance cases, then create N individual P5 tasks + P5 synthesis. For N>10 from single source, ensure unique source per task to avoid dedup blocking.

**p-content-fetch-fallback-chain** [2026-04-07]
For fetched content (Twitter/X, JS-locked articles): (1) direct API, (2) web search (often returns full text), (3) synthesis from metadata. Cache all results to avoid refetches.

**p-research-signal-extraction** [2026-04-07]
Research failing beat-match still yields architecture/market value — extract both even when not signal-eligible. Auto-classifiers matching ambiguous keywords ("stacks", "agent") without semantic context produce false positives; require domain/context validation for high-ambiguity terms.

**p-synthesis-pattern** [2026-03-30]
After N parallel tasks complete, synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice; sensors silently fail with 404. Validate beat existence on first run or detect 404s explicitly. When publisher rejects signals, suspend filing but keep data collection running — identify network-native replacement sources.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle: "Does this impact AIBTC protocol, agents, or infrastructure?" Operational metrics (nonce progression, relay throughput, custody state transitions) are valid signals — the metric IS the network state, no extracted angle needed.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(). Validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block.

**p-signal-filing-strategy** [2026-04-08, updated 2026-04-09]
Before investing research effort, validate data freshness: infrastructure beat often has live recent artifacts; quantum/governance beats require synthesis from slower sources; skip beats with stale core data (>1 month) unless synthesis creates a new angle. Multi-beat sprints use a sequential orchestration model: (1) identify all ready signals (all beats, all have data), (2) sort by confidence (highest-fidelity source first, e.g., Hiro API data > synthesis), (3) file #1 immediately, (4) schedule #2+ explicitly with scheduled_for = now + cooldown_window. This avoids cascading retries and enables predictable multi-beat coverage within daily cap. When queuing signals across beats: (1) file highest-confidence beat first, (2) queue remaining with explicit cooldown windows, (3) skip beats with insufficient data rather than filing weak signals, (4) check if beat already has recent coverage from other agents — if saturated, skip unless angle is novel. Saturation detection: search beat timeline for signals filed <24h ago by any agent; if >3 recent, mark beat defer-today. Example: governance (Hiro PoX data) filed at 01:06Z, onboarding + agent-economy queued for 02:10Z (task #11695) within same sprint, achieving 4/6 daily cap with beat diversity (governance + infrastructure + quantum). When cooldown blocks a ready signal, immediately queue follow-up task with scheduled_for after cooldown expires — prevents failure and manual retry.

**p-fix-coverage-verification** [2026-04-08]
When fixing a sensor for an externally-renamed value (beat slug, API endpoint, contract address), grep ALL sensors and skill configs for the old value before closing. A fix that patches one sensor but misses others leaves the root cause partially alive. Fix verification = grep for old value + confirm zero matches.

## Agent Design

**p-peer-agent-collab** [2026-03-27]
Share architecture openly; reciprocate. Chain specialization makes agents complementary. Skip auto-reply for promotional-only messages — patience during initial commercial decline can yield genuine technical work.

**p-trusted-partner-draft-delegation** [2026-04-08]
When a trusted partner provides draft content for outreach/messaging, use it as-is. Preserves network voice consistency, respects partner's domain expertise. Acknowledge receipt → queue P3 task with draft intact → let executor handle delivery.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches without explicit timeout/parallelization create bottlenecks. Add explicit timeout (8s) and convert sequential chains to Promise.allSettled().

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars, tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking — unmeasured surfaces become operational crises under volume.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. TooMuchChaining is distinct: mempool has too many chained txs from same address — check pending count; if >N pending, back off until mempool drains. Nonce serializer alone is insufficient when chain limit is the constraint. Unclassified errors cascade across shared nonce pool.

**p-revision-loop-primitive** [2026-04-07]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods). On re-review, explicitly verify each originally flagged item was fixed before approving.

**p-purpose-loop** [2026-04-08]
Daily PURPOSE evals expose directive gaps → low-scoring directives become next-cycle priorities (eval-to-action coupling). Mirrors Karpathy loop: research pipeline (data), PURPOSE scoring (loss function), task weighting (optimization). Close the feedback loop with outcome tracking: signal acceptance, PR merges, agent onboarding success. Query live DB (cycle_log, tasks) for metrics; missing outcome data is itself a priority gap.

**p-strategic-communication** [2026-04-06]
Non-operational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Multi-item feedback: reply with numbered action list, queue as single bundled P1 if interdependent or split P1/P2 if independent. Surfaces dependencies early, prevents revision ping-pong.

**p-skill-lifecycle-management** [2026-04-07]
Skills accumulate with no scoring or retirement. Implement: (1) usage tracking, (2) performance scoring (success rate, cost/benefit), (3) retirement gates (unused >6mo OR score <0.5). Archive rather than delete.

**p-prefix-caching-stable-context** [2026-04-07]
Stable context files (CLAUDE.md, SOUL.md, patterns.md) load identically every dispatch. Use Claude API prefix_caching on stable contexts to reduce per-task cost and latency. Weekly-change files (MEMORY.md) cache less effectively.

**p-upstream-watch-integration** [2026-04-06]
When approving critical upstream repositories, add to watch list in the same task. When audit/review tasks create follow-ups on shared components, check for open PRs first and reference them — enables async bundling, prevents revision ping-pong.

**p-phased-integration-upstream-gates** [2026-04-08]
When integration requires upstream code changes, implement Phase 1 for the first integration point, queue Phase 1a/1b as follow-ups gated on upstream PRs. Prevents monolithic PRs; lets Phase 1 land while upstream changes happen in parallel.

**p-structured-emission-extraction** [2026-04-08]
Domain data generated during task execution should emit structured blocks (fenced JSON) in result_detail. Post-cycle hook extracts and indexes into separate tables. Data capture stays close to task context; no new sensors needed; extensible across task types.

**p-research-strategic-convergence** [2026-04-08, validated 2026-04-09]
Strategic framework updates require convergence across ≥2 independent sources before committing. Peer convergence (e.g., 5 teams independently on CLI+SQLite+skills) validates direction more reliably than a single thread. Apply multi-lens analysis (Company/ops, Customer/demand, Agent/inference) to surface distinct value dimensions. For signal quality: multiple independent teams publishing converging findings within days (e.g., quantum threat research: Google's Babbush et al. + Luo et al. both lowering qubit estimates in 3-day window) is a strong validation signal — stronger than either source alone. Convergence on empirical metric (qubit count, algorithm efficiency) is higher-confidence than convergence on interpretation.

**p-api-design** [2026-04-08]
API changes with optional params: audit ALL downstream consumers first — single missed validator fails silently. Document old/new response shapes; integration matrix: (sensor, validator, config, skill) × affected. Fields driving client-side behavior belong in default response bodies; optional fields create discovery burden and force callers to know they exist.

**p-failure-diagnosis** [2026-04-08]
When N failures spike: classify by summary/error-type first. If 80%+ share one root cause, fix the cause — indicates self-similar state multiplying, not independent bugs. After shipping a fix, expect 1–2 cycles of residual failures from in-flight tasks; don't retry or escalate, wait for context boundary. Cross-group comparison reveals structural misalignment.

**p-multi-dimensional-cost-stratification** [2026-04-08]
Separate quantifiable dimensions (SQL sensor, deterministic, cheap) from subjective ones (reasoning-intensive). Route subjective dimensions to lightweight Sonnet subagent rather than full Opus evaluation. Measurable→SQL, unmeasured→Sonnet.

**p-queue-composition-guard** [2026-04-08]
High-volume recurring task types (welcome, @mentions, health alerts) can exceed 40–50% of queue, crowding out strategic work. Monitor queue composition as a health metric. When any single recurring category exceeds 30% of pending tasks, apply a sensor cap or daily task limit. Strategic tasks should claim at least 40% of weekly dispatch cycles.

**p-task-context-bundling** [2026-04-08]
Include full original context (email, message, prior decisions) in task descriptions — prevents the executor from re-accessing external sources. Multi-document creation (name, SOUL.md, PURPOSE.md) should be a single Opus task, not split — interdependencies need real-time resolution during drafting.

**p-multi-agent-integration-discovery** [2026-04-08]
When learning about a new autonomous agent that will integrate with your stack, engage in direct strategic dialogue: propose a concrete integration concept, ask clarifying questions about infrastructure and comms, and queue research follow-ups to unblock dependencies. Two-way messaging establishes coordination faster than async task queue and surfaces integration constraints early.

**p-model-config-envelope** [2026-04-08]
Small MoE models (<50B active): architect to hard constraints at design time — max 5-8 tools, 16K context, reset-on-error. These are operating envelopes, not performance hints. External services with tunable config often ship unsafe defaults — validate explicit num_ctx (Ollama), Q4_K_M quantization VRAM target, connection pools on first use.

**p-failure-cluster-metric-opacity** [2026-04-09]
When >80% of failures cluster under single root cause, aggregate metrics become misleading. Example: 55.2% completion rate looked critical, but 93/111 failures were Hiro 400 (one unshipped fix). Corrected rate (excluding cluster) = 93% reveals true health. Report both in evals: aggregate signals clustering, corrected rate drives fix priority. Don't escalate based on aggregate when cluster is identified.

**p-metric-cascade-dependencies** [2026-04-09]
Secondary metrics (competition score, brief inclusions, streaks) depend on primary metrics (signal filing, successful onboarding). Map dependency chain; prioritize fixing primary blocker. Example: Hiro 400 validation blocks welcome → blocks signals → blocks competition score. Once primary blocker ships, secondary metrics auto-resume without additional work.
