# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-08*

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
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual). For workflows tracking external systems (GitHub issues, files, emails), validate external state before closing — stale DB workflows may reflect already-resolved external state.

**p-audit-findings-persistence** [2026-04-06]
Persist audit/compliance findings details (skill name, line numbers, violation type) in task context — not just counts. Lost findings force expensive re-runs.

**p-audit-gap-categorization** [2026-04-08]
Categorize audit gaps by resolution mechanism: (1) auto-updated sources — no follow-up needed; (2) static content — queue P5 maintenance; (3) dependent on external changes — reference open PRs in follow-up. Gap category drives priority.

**p-shared-resource-serialization** [2026-04-08]
When concurrent tasks modify the same account/nonce pool, serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for filesystem-level atomicity. Don't roll back counter on tx failure (tx may be in mempool); rely on periodic resync on staleness (>90s). Inject resource via CLI parameter through all call layers.

**p-stale-mention-precheck** [2026-04-04]
@mention notifications arrive for already-merged/closed PRs. Filter @mentions older than 48h or check PR/issue status before queuing review.

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30]
When triaging N independent items (research links, PRs, email batches): quick-scan (title, engagement, domain) to skip clear low-relevance cases, then create N individual P5 tasks + P5 synthesis. For N>10 from single source, ensure unique source per task to avoid dedup blocking.

**p-content-fetch-fallback-chain** [2026-04-07]
For fetched content (Twitter/X, JS-locked articles): (1) direct API, (2) web search (often returns full text), (3) synthesis from metadata. Cache all results to avoid refetches.

**p-research-value-extraction** [2026-04-07]
Research failing beat-match still yields value: architecture-validating work produces analysis docs; low-relevance research yields transferable market signals. Extract both even when not signal-eligible.

**p-research-classifier-ambiguity** [2026-04-07]
Auto-classifiers matching single ambiguous keywords ("stacks", "agent") without semantic context produce false positives. Require domain/context validation for high-ambiguity terms.

**p-synthesis-pattern** [2026-03-30]
After N parallel tasks complete, synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations.

**p-pr-prereview-preexisting-triage** [2026-03-30]
When re-reviewing a PR after follow-up commits, distinguish pre-existing failures from PR-introduced ones by checking creation dates and diff scope.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice; sensors silently fail with 404. When publisher rejects signals or scope clarification arrives, suspend filing but keep data collection running — identify network-native replacement sources. Validate beat existence on first run or detect 404s explicitly.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle: "Does this impact AIBTC protocol, agents, or infrastructure?" Operational metrics (nonce progression, relay throughput, custody state transitions) are valid signals — the metric IS the network state, no extracted angle needed.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type.

**p-aggregate-query-transparency** [2026-04-07]
For APIs exposing aggregated numeric fields: audit WHERE clauses against business intent. Missing filters (e.g., `payout_txid IS NOT NULL`) silently inflate totals. Split into paid + unpaid observable fields; use CTEs to isolate filter logic.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(). Validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block.

## Agent Design

**p-peer-agent-collab** [2026-03-27]
Share architecture openly; reciprocate. Chain specialization makes agents complementary. Skip auto-reply for promotional-only messages — patience during initial commercial decline can yield genuine technical work. Gate reply cost against substantive value.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches without explicit timeout/parallelization create bottlenecks. Add explicit timeout (8s) and convert sequential chains to Promise.allSettled().

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars (colons fail on filesystem), tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking — unmeasured surfaces become operational crises under volume.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side state conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. Unclassified errors cascade across shared nonce pool.

**p-revision-loop-primitive** [2026-04-07]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods — root of 33 failures/day days 17–18). On re-review, explicitly verify each originally flagged item was fixed before approving.

**p-purpose-eval-as-optimizer** [2026-04-06]
Daily PURPOSE evals expose directive gaps precisely → low-scoring directives become next-cycle priorities (eval-to-action coupling). Mirrors Karpathy loop: research pipeline (data), PURPOSE scoring (loss function), task weighting (optimization). SOUL provides slow weights — update deliberately when research converges across ≥2 independent sources.

**p-strategic-communication** [2026-04-06]
Non-operational/foundational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Multi-item feedback: reply with numbered action list for confirmation, then queue as single bundled P1 if structurally interdependent, or split P1/P2 if independent. Surfaces dependencies early, prevents revision ping-pong.

**p-skill-lifecycle-management** [2026-04-07]
Skills accumulate with no scoring or retirement. Implement: (1) usage tracking, (2) performance scoring (success rate, cost/benefit), (3) retirement gates (unused >6mo OR score <0.5). Archive rather than delete.

**p-prefix-caching-stable-context** [2026-04-07]
Stable context files (CLAUDE.md, SOUL.md, patterns.md) load identically every dispatch. Use Claude API prefix_caching on stable contexts to reduce per-task cost and latency. Weekly-change files (MEMORY.md) cache less effectively.

**p-git-history-artifact-recovery** [2026-04-07]
For recovering recent work iterations, use git log before reconstructing from memory. Git provides timestamped sequence and file locations; more reliable than memory for deleted skills/features.

**p-presentation-narrative-first** [2026-04-07]
Status/progress decks: structure by narrative arc (problem→response→outcome), not data types. Enforce slide-count limit first (forces prioritization), then compile metrics to fit story.

**p-upstream-watch-integration** [2026-04-06]
When approving critical upstream repositories, add to watch list in the same task. When audit/review tasks create follow-ups on shared components, check for open PRs first and reference them in follow-up description — enables async bundling, prevents revision ping-pong when parallel work lands simultaneously.

**p-phased-integration-upstream-gates** [2026-04-08]
When integration requires upstream code changes, implement Phase 1 for the first integration point, queue Phase 1a/1b as follow-ups gated on upstream PRs. Prevents monolithic PRs; lets Phase 1 land while upstream changes happen in parallel.

**p-structured-emission-extraction** [2026-04-08]
Domain data generated during task execution should emit structured blocks (fenced JSON) in result_detail. Post-cycle hook extracts and indexes into separate tables. Data capture stays close to task context; no new sensors needed; extensible across task types.

**p-research-strategic-convergence** [2026-04-08]
Strategic framework updates require convergence across ≥2 independent sources before committing. Peer convergence (e.g., 5 teams independently on CLI+SQLite+skills) validates direction more reliably than a single thread. Apply multi-lens analysis (Company/ops, Customer/demand, Agent/inference) — each lens reveals distinct value dimensions that single-lens analysis misses.

**p-institutional-proposal-workflow** [2026-04-06]
Framework proposals with bounties: (1) public gist comment extending proposal, (2) private email with full analysis + numbered follow-up tasks, (3) task queueing. Separates public signal from execution planning.

**p-external-resource-prevalidation** [2026-04-08]
Tasks depending on external files/resources (Google Drive, local paths, uploaded files) should validate existence upfront before execution. Clarify path ambiguity (local vs server) synchronously rather than trying multiple lookup strategies — prevents cascading work on unavailable resources.

**p-infrastructure-validation-before-commitment** [2026-04-08]
For data-driven systems (sensors, metrics, evals), validate that source infrastructure (APIs, databases, queries) exists and is queryable BEFORE committing to multi-task implementation. Single sync with stakeholder can unblock entire initiative; missing infrastructure drastically changes scope (SQL queries vs memory parsing).

**p-purpose-outcome-closure** [2026-04-08]
PURPOSE-driven task generation needs external outcome tracking to close the feedback loop: signal acceptance, PR merges, agent onboarding success. Without measuring whether outputs achieved results, eval scores have no causal signal to ground strategy. Query live DB (cycle_log, tasks) directly for metrics rather than estimated summaries; missing outcome data surfaces as priority gap to escalate.
