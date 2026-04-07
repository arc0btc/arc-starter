# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last updated: 2026-04-06*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors via insertTaskIfNew, CLI via `arc tasks add`, follow-up tasks) must include model. Tasks without model fail at dispatch: "No model set."

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.


**p-cooldown-precheck**
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing.

**p-auth-cascade**
OAuth expiry → wave of consecutive auth failures. Mitigation: ANTHROPIC_API_KEY fallback in dispatch.ts.


## Operational Patterns


**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.



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
Viral X threads and industry expert tips on consumer-grade AI/LLM implementations (RAG, knowledge bases, multi-model orchestration, context budgeting) often validate systems Arc already implements. Use research to confirm architecture choices and prioritize validated patterns; typically low AIBTC ecosystem relevance but high confidence value for implementation priorities (e.g., KSimback validation of 3-tier routing, skills composition, lifecycle hooks).

**p-social-link-resolution-in-research** [2026-04-07]
Twitter/X articles embed t.co short links. On x.com, t.co links often resolve back to the original tweet (JS-blocked page); use X API directly instead of following the link crawl. For JS-locked articles (require browser rendering), fallback chain: (1) X API metadata, (2) web search (often returns full text in results), (3) manual synthesis from metadata + cache partial findings. Cache all API/search results to avoid refetches.

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

**p-tool-state-verification** [2026-04-07]
External tools may report state changes (cache hits, file writes, API success) without actually persisting. Watch for: (1) filename output with invalid characters (e.g., colons, which bash formats as timestamps but fail on filesystem), (2) tool console output claims success but file doesn't exist. When a tool claims success but subsequent operations fail (file not found, cache miss), bypass the tool's state and use direct API calls. Verify tool outputs empirically rather than trusting status reports.

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

**p-revision-loop-primitive** [2026-04-07]
For task types with inherent review/revision cycles (PR review, contract audits, synthesis reviews), encode the cycle as a first-class workflow primitive rather than generating new downstream tasks. Prevents duplicate-review floods where approval state isn't checked before re-queuing. Exemplar: Vajra's built-in "Changes Requested → fetch review context → revision pipeline → update PR" prevents Arc's duplicate-PR-review pattern (33 failures/day on days 17–18, task #11183).

**p-market-signal-in-low-relevance-research** [2026-04-07]
Research failing beat-match often contains transferable market signals (demand patterns, competitive landscape, content-strategy implications). Extract these as architectural/positioning inputs even when not signal-eligible.

**p-production-systems-pattern-validation** [2026-04-07]
Production inference-serving research often converges with Arc's existing patterns (e.g., Baseten's recording proxy = cycle_log trace model, environment-as-user interaction). Note convergences as architectural confidence signals; high convergence = mature industry-validated patterns.

**p-auth-gated-resource-delegation** [2026-04-07]
When Arc encounters resources outside its access scope (auth-gated: Google Drive PDFs, private APIs; cross-system: files on whoabuddy's local machine not on Arc server), immediately reply explaining the limitation and request workaround (public URL, server copy, scp transfer). Queue follow-up task with parent_id for when resource becomes accessible. Don't attempt inline workarounds — defer to the human with access.

**p-peer-validated-architecture-patterns** [2026-04-07]
Peer research validating Arc's existing architectural patterns elevates pattern status from internal heuristic to industry-validated approach. Examples: (1) DSPy/Meta Harnesses' trace-based auto-optimization matching Arc's manual retrospective refinement; (2) Braintrust's object-storage+WAL+compaction validating dispatch/sensor convergence; (3) @dzhng's crm.cli independently arrived at CLI+SQLite for agents and hit 66 stars in 4 days — validates BOTH technical rightness and market demand for agent-native tools; (4) Shlok Khemani's Vajra (@zamana_hq, open-sourced 2026-04-07) — validates skills-as-shared-memory, file-based checkpointing, isolated workspaces; **INVERSE VALIDATION**: Vajra's built-in PR review→revise workflow is architecturally cleaner than Arc's loose sensor→new-task approach, suggesting revision-loops should be first-class primitives to prevent duplicate-task floods; (5) @browser_use/Gregor Zunic's self-evolving agent system converged on "skills as knowledge containers," automated skill extraction from task runs, and social scoring (peer feedback + written reasons for votes). At hundreds of thousands of tasks/day scale, same exploration-exploitation insight Arc uses. Formalize as automation priority: use cycle_log/task results as first-class optimization input; explore post-dispatch review agents for auto-skill-extraction + scoring (social feedback loop).

**p-fetched-content-sanitization** [2026-04-07]
Arc processes fetched content (research papers, tweets, PDFs, emails) without input sanitization. DeepMind research shows 86% of AI systems compromised via prompt injection in fetched content. Implement sanitization layer: strip malicious prompts, normalize encodings, validate structure before passing to analysis tasks.

**p-skill-lifecycle-management** [2026-04-07]
108+ skills accumulate with no formal scoring or retirement. Implement: (1) usage tracking (skill citations in successful tasks), (2) performance scoring (success rate, cost/benefit), (3) retirement gates (unused >6mo OR score <0.5). Archive rather than delete; prevents skill bloat and maintains signal-to-noise in SKILL.md loads.

**p-prefix-caching-stable-context** [2026-04-07]
Stable context files (CLAUDE.md, SOUL.md, patterns.md, MEMORY.md) load identically every dispatch. Use Claude API prefix_caching on stable contexts to reduce per-task token cost and latency. Identify cache boundaries: weekly-change files (MEMORY.md) vs stable (SOUL.md) to maximize hits.

**p-git-history-artifact-recovery** [2026-04-07]
For requests to recover/compile recent work iterations, use git log (grep commit messages + filenames) to find artifact trail before reconstructing from memory. Git provides timestamped iteration sequence and file locations; more reliable than scattered MEMORY.md notes. Particularly effective when skills/features are deleted — commit messages preserve design decisions that explain why removal happened.
