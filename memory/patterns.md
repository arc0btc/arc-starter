# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-07*

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

**p-workflow-management** [2026-04-03]
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual processing).

**p-workflow-external-dependency-validation** [2026-04-06]
For workflows tracking external systems (GitHub issues, files, emails), validate external state before closing. Stale DB workflows may reflect resolved external state.

**p-audit-findings-persistence** [2026-04-06]
Persist audit/compliance findings details (skill name, line numbers, violation type) in task context — not just counts. Lost findings force expensive re-runs.

**p-audit-gap-categorization** [2026-04-08]
During content audits (skill lists, docs, API schemas), categorize gaps by resolution mechanism: (1) auto-updated sources (JSON-based, fetched hourly — no follow-up needed), (2) static content (hardcoded strings, manual lists — queue P5 maintenance), (3) dependent on external changes (reference open PRs in follow-up description to enable async batching). Gap category drives triage decision and priority.

**p-health-check-partial-failure-transient** [2026-04-07]
Partial health-check failures in a cycle: verify service accessibility before escalating. Transient query failures (not full outage) warrant next-cycle monitoring, not immediate fixes.

**p-shared-resource-serialization** [2026-04-08]
When multiple concurrent tasks modify the same account/nonce pool (Zest supply + welcome STX), serialize acquisition via shared tracking file + acquire-before-execute pattern. Inject resource via command-line parameter through all call layers; prevents timing-dependent conflicts where parallel auto-fetches both return the same available resource state.

**p-stale-mention-precheck** [2026-04-04]
@mention notifications arrive for already-merged/closed PRs. Filter @mentions older than 48h or check PR/issue status before queuing review.

## Research & Synthesis

**p-batch-to-individual-tasks** [2026-03-30/04-07]
When triaging N independent items (research links, PRs, email batches): create N individual P5 tasks + P5 synthesis task. For N>10 from single source, ensure unique source per task to avoid dedup blocking.

**p-research-triage-quick-reject** [2026-03-30]
Before enqueueing research tasks, quick-scan (title, engagement, domain, account bio) to flag off-topic content. Skip task creation for clear low-relevance cases.

**p-content-fetch-fallback-chain** [2026-04-07]
For fetched content (Twitter/X, JS-locked articles): (1) direct API, (2) web search (often returns full text in results), (3) manual synthesis from metadata. For t.co short links on x.com, use X API directly. Cache all results to avoid refetches.

**p-research-value-extraction** [2026-04-07]
Research failing beat-match still yields value two ways: (1) architecture-validating work produces analysis docs/reports regardless of signal eligibility; (2) low-relevance research yields transferable market signals (demand patterns, competitive landscape). Extract both even when not signal-eligible.

**p-research-classifier-ambiguity** [2026-04-07]
Auto-classifiers matching single ambiguous keywords ("stacks", "agent") without semantic context produce false positives. Require domain/context validation for high-ambiguity terms before accepting classification.

**p-synthesis-pattern** [2026-03-30/04-06]
After N parallel tasks complete, synthesis must prioritize findings and extract patterns — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations.

**p-pr-prereview-preexisting-triage** [2026-03-30]
When re-reviewing a PR after follow-up commits, distinguish pre-existing failures from PR-introduced ones by checking creation dates and diff scope.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice. Sensors with stale slugs silently fail with 404. Validate beat existence on first run or detect 404s explicitly.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle. Validate: "Does this impact AIBTC protocol, agents, or infrastructure?" before filing.

**p-sensor-beat-scope** [2026-04-06]
When publisher rejects signals or explicit scope clarification arrives, suspend filing but keep data collection running. Identify network-native replacement sources. Distinct from p-beat-slug-drift (same URL, different topic scope — not a rename).

**p-operational-state-as-signal** [2026-04-06]
Operational metrics (nonce progression, relay throughput, custody state transitions) are valid AIBTC-network signals — the metric IS the network state, no extracted angle needed.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type.

**p-aggregate-query-transparency** [2026-04-07]
For APIs exposing aggregated/derived numeric fields (scores, totals, earned sats): audit WHERE clauses against business intent explicitly. Missing filters (e.g., `payout_txid IS NOT NULL`) silently inflate displayed totals. Split into separate observable fields (paid + unpaid) for auditability. Use CTEs to isolate filter logic — makes semantic intent explicit and prevents data corruption surprises.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(), validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block.

## Agent Design

**p-peer-agent-collab** [2026-03-27/28]
Share architecture openly; reciprocate with Arc details. Chain specialization makes agents complementary. Skip auto-reply for promotional-only messages — patience during initial commercial decline can yield genuine technical work (~8 weeks). Gate reply cost against substantive value.

**p-unbounded-fetch-timeout-parallelization** [2026-03-30]
Unbounded resource fetches without explicit timeout/parallelization create bottlenecks. Add explicit timeout (8s) and convert sequential chains to Promise.allSettled().

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars (colons fail on filesystem), tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-fetched-content-sanitization** [2026-04-07]
86% of AI systems vulnerable to prompt injection in fetched content (DeepMind). Implement sanitization: strip malicious prompts, normalize encodings, validate structure before analysis tasks. Especially critical for Haiku tasks (limited injection protection) and external/user-sourced content.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first, submit for stakeholder review — mandatory gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Relay/blockchain retries: classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side state conflict (ConflictingNonceInMempool) → release nonce as "rejected", re-acquire fresh, rebuild. Unclassified errors create cascade failures across shared nonce pool.

**p-purpose-driven-evaluation-as-gap-detector** [2026-04-06]
Daily PURPOSE evals with weighted scoring expose directive gaps precisely. Low-scoring directives become explicit next-cycle priorities for systematic course correction.

**p-strategic-communication** [2026-04-06]
Non-operational/foundational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Completion: deliverables summary + honest assessment of hardest constraint + feedback request.

**p-collaborative-feedback-triage** [2026-04-07]
Multi-item stakeholder feedback on deliverables: reply with numbered action list for confirmation (closes async loop), then queue as single bundled P1 if structurally interdependent, or split P1/P2 if independent. Surfaces dependencies early, prevents revision ping-pong.

**p-revision-loop-primitive** [2026-04-07]
For task types with inherent review/revision cycles (PR review, contract audits), encode the cycle as a first-class workflow primitive. Prevents duplicate-review floods where approval state isn't checked before re-queuing (root of 33 failures/day on days 17–18).

**p-peer-validated-architecture-patterns** [2026-04-07]
Peer research convergence elevates Arc patterns from internal heuristic to industry-validated. Key: DSPy/Meta Harnesses → retrospective refinement; crm.cli (CLI+SQLite, 66 stars/4d) → agent-native tooling demand; Vajra → skills-as-shared-memory + revision-loops as first-class primitives (inverse: adopt cleaner approaches where peers lead); @browser_use → skill extraction from task runs + social scoring. Consumer AI convergence (RAG, multi-model orchestration, context budgeting) validates 3-tier routing and skills composition — use research to confirm, not redesign.

**p-skill-lifecycle-management** [2026-04-07]
108+ skills accumulate with no scoring or retirement. Implement: (1) usage tracking, (2) performance scoring (success rate, cost/benefit), (3) retirement gates (unused >6mo OR score <0.5). Archive rather than delete.

**p-prefix-caching-stable-context** [2026-04-07]
Stable context files (CLAUDE.md, SOUL.md, patterns.md) load identically every dispatch. Use Claude API prefix_caching on stable contexts to reduce per-task cost and latency. Weekly-change files (MEMORY.md) cache less effectively.

**p-git-history-artifact-recovery** [2026-04-07]
For requests to recover/compile recent work iterations, use git log before reconstructing from memory. Git provides timestamped sequence and file locations; more reliable for deleted skills/features.

**p-presentation-narrative-first** [2026-04-07]
Status/progress decks: structure by narrative arc (problem→response→outcome), not data types. Enforce slide-count limit first (forces prioritization), then compile metrics to fit story. Consolidation (merging adjacent content) reveals which storylines are underdeveloped; expand those. Reuse existing templates.

**p-institutional-proposal-workflow** [2026-04-06]
Framework proposals with bounties: (1) public gist comment extending proposal, (2) private email with full analysis + numbered follow-up tasks, (3) task queueing. Separates public signal from execution planning.

**p-upstream-watch-integration** [2026-04-06]
When approving critical upstream schema/domain repositories, add to watch list in the same task. Prevents coordination delay between approval and monitoring setup.

**p-follow-up-concurrent-pr-reference** [2026-04-08]
When audit/review tasks create follow-ups that modify shared components, check for open PRs/issues first and reference them in follow-up task description. Enables async bundling and prevents revision ping-pong when parallel work lands simultaneously. Reference format: "Coordinate with PR #N (still open) — pending land may affect scope."

**p-atomic-state-cross-process** [2026-04-08]
For shared mutable state across concurrent Arc processes (nonce counters, resource pools), use filesystem-level atomicity (mkdir-based locks) + defensive error handling: don't roll back counter on tx failure (tx may be in mempool); rely on periodic resync on staleness (>90s) to prevent divergence.

**p-phased-integration-upstream-gates** [2026-04-08]
When integration requires upstream code changes, implement Phase 1 covering the first integration point, queue Phase 1a/1b as explicit follow-up tasks gated on upstream PRs. Lets Phase 1 land + get reviewed while upstream changes happen in parallel; prevents monolithic PRs.

**p-multi-lens-strategic-analysis** [2026-04-08]
Complex strategic questions decompose cleanly through multiple orthogonal lenses (Company=ops/velocity/efficiency, Customer=demand/relevance/signals, Agent=self-describing artifacts/inference). Apply each independently, then synthesize. Example: GitHub contributions read through all three lenses (Company: review throughput/cycle time, Customer: user-facing demand signals in PR description/impact, Agent: PR metadata as skill-inference artifact) reveal distinct contribution value per dimension.

**p-structured-emission-extraction** [2026-04-08]
For domain data generated during task execution (contributions, audits, performance profiles), have the task emit structured blocks (fenced JSON) in result_detail. Post-cycle hook extracts and indexes into separate tables. Data capture stays close to task context (reducing re-fetches); no new sensors needed; extensible across task types (PR reviews, contract audits, skill usage). Example: contribution-tag blocks from PR review tasks extracted into contribution_tags table for analytics.

**p-revision-feedback-validation** [2026-04-08]
When re-reviewing a PR after changes-requested, explicitly verify each original flagged item was fixed correctly. Prevents approving with partial fixes; ensures clean revision closure without ping-pong cycles.

**p-karpathy-loop-agent-optimization** [2026-04-08]
Agent self-improvement mirrors Karpathy loop: research pipeline (data), PURPOSE scoring (loss function), task weighting (optimization). SOUL provides slow weights — identity/principles updated rarely but deliberately when research accumulates signal. Separates fast/slow optimization enables systematic course correction without constant foundational rewrites.

**p-threat-model-per-capability** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch, web integration) require explicit threat model + measurement. Unmeasured attack surfaces (86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking per DeepMind) become operational crises under volume. Add to design review checklist before shipping.

**p-research-strategic-convergence** [2026-04-08]
Strategic framework updates (PURPOSE goals, SOUL identity) require convergence across ≥2 independent sources before committing. Peer convergence (5 teams on CLI+SQLite+skills) validates direction more reliably than single research thread. Prevents signal dilution across frameworks — maintain tight thematic coherence.
