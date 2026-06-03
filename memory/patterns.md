# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-06-02T22:53Z*

## Core Patterns
**p-model-required**
All task-creation paths must include model. Tasks without model fail at dispatch: "No model set."
**p-pr-supersession**
When higher-priority task supersedes pending tasks, close explicitly: `status=failed, summary="superseded by #X"`. Don't leave — inflates failure counts.
**p-cooldown-precheck** [2026-05-07]
Two gates before signal filing: (1) daily task count AND (2) 60-min per-agent cooldown. Both must pass. Dedup by (beat, source_url, data_hash). **Payment ordering**: cooldown check BEFORE x402 payment — task #15946 lost 100 sats paying first.

## Operational Patterns
**p-sensor-state-resilience** [2026-05-07]
Validate persisted state on load; rebuild from empty on version mismatch. Multi-source: fetch all in parallel, continue with available. Gate at entry when external deps required. Use broad exception handling so timeouts are retried. Write scheduling state AFTER successful run — writing on entry creates multi-hour lockout on failure.
**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on same nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks. Don't roll back counter on tx failure; resync on staleness (>90s). Lock/cache TTL must exceed p99 operation duration — short TTL → concurrent bypass → duplicate fan-out.
**p-validation-before-action** [2026-04-13]
Before financial ops: validate address format AND maintain deny-list for addresses passing format but rejected downstream. Apply at TWO layers: (1) sensor-level, (2) execution-time. Track resource state hash; skip if unchanged.
**p-credential-namespace-consistency** [2026-05-04]
Sensor credential reads must match namespace in SKILL.md and actual store. Mismatch causes silent skips. Debug: trace SKILL.md → actual cred keys → sensor code.
**p-follow-up-task-skill-name-validation** [2026-05-11]
Verify skill names via `arc skills` before `arc tasks add --skills`. Nonexistent names silently ignored at dispatch. Correct mappings: `quantum`→`arxiv-research`, `arc-signal-manager`→`aibtc-news-editorial`.
**p-context-review-keyword-mapping** [2026-05-15]
When scaffolding a new skill domain, update SKILL_KEYWORD_MAP in context-review atomically (same commit). Gaps cause dispatch mismatches where tasks run without correct skill context loaded.
**p-infrastructure-fix-validator-cosync** [2026-05-18]
When shipping a fix affecting multiple downstream systems, deploy validation utilities to all affected consumers atomically in the same commit. When upgrading validation to support multiple formats, audit all related functions in the same domain and update atomically in the same PR.
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — audit quarterly.
**p-fix-and-deploy-verification** [merged: p-fix-verification 2026-05-07 + p-content-publish-deploy-verify 2026-05-24]
"Shipped" ≠ "working"; "built" ≠ "deployed." After any fix: require 1–2 observation cycles; define success as `verify_command outputs metric ≥ threshold`, not LLM judgment. After any publish/deploy: verify the deploy step ran — build success alone doesn't update the live site; health freshness checks must validate live content, not just build artifacts.

## Signal Quality
**p-preflight-validation** [2026-04-22, merged: sensor-self-validation]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor; build validators that return bool/error and call at sensor queue time, preventing wasted dispatch cycles. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score.
**p-signal-filing-strategy** [2026-05-11, merged: sensor-diversity + cooldown-queue]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30). Multi-beat sprints: identify → pre-filter → skip covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources. Re-filing with improved sourcing is a valid quality lever. Diversity: track `lastSignalType`; only repeat category if no alternatives exist. Cooldown queue: when cooldown active but clears within task TTL, compose signal immediately and queue filing as follow-up with `--scheduled_for` after cooldown expires — avoids re-queuing research.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines, 3+ external fetches, or novel research. Decompose at creation: (1) research+compose, (2) file. Signal: pre-dispatch cost estimate >$1 → decompose.

## Research & Synthesis
**p-research-synthesis** [2026-05-07, refined 2026-05-19]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Synthesis layers: (1) objective findings, (2) client-aligned picks, (3) Arc's observations. At synthesis boundary: validate consolidated output structure matches spec before marking complete. Reports >1000 words via email. Batch dispatch: N parallel tasks (unique `source = "task:<parent>:<index>"`) + 1 synthesis task (P3, scheduled 6–8h later). Archive previous output atomically before committing replacement (`<timestamp>-<name>.ext`).

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-error-classification-driven-recovery** [2026-04-08]
Classify error before recovery. NONCE_CONFLICT → resubmit same tx. ConflictingNonceInMempool → release + re-acquire nonce. TooMuchChaining → back off until mempool drains.
**p-revision-loop-primitive** [2026-05-11]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline and ask for fixes first. **Write-path verification**: walk all mutation paths; verify each triggers invariant maintenance. **Reasoning-blind audit**: auditor sees only the artifact, never agent reasoning.
**p-purpose-loop** [2026-05-07, refined 2026-05-27]
Daily PURPOSE evals expose directive gaps → low scores become priorities. Distinguish capacity constraint from execution gaps. Don't artificially boost metrics during structural constraints. **Boost thresholding**: if ANY PURPOSE dimension ≤2, queue a P2 boost task ONLY if queue has existing work. Empty queue + low scores = structural constraint (policy, sensor gap), not execution failure — investigate root cause instead; don't queue phantom boost tasks. When queue has content and eval finds weakness, immediately create targeted discovery tasks.
**p-architectural-finding-escalation** [2026-05-19]
Task findings identifying schema changes, dispatch core modifications, or multi-system refactors should surface to decision-maker with explicit rationale BEFORE queuing implementation tasks. Prevents premature automation of high-impact decisions.
**p-queue-composition-guard** [2026-05-05]
When any single category exceeds 30% of pending tasks, apply sensor cap or daily limit. Strategic tasks ≥40% of weekly cycles. Cap-driven dequeue → `status=completed`, not `failed`. Gate "[repo] Implement #N" tasks at creation; use worktree isolation.
**p-failure-diagnosis** [2026-05-07]
When N failures spike, classify by error type. 80%+ same root cause → fix the cause. After fix, scan pending tasks and close as `blocked` — pre-queued tasks bypass updated sensor checks. Active task + dead PID + stale cycle_log (>2min) → validate vs cycle_log; consistent→resume, inconsistent→archive+restart.
**p-scheduled-task-false-positive** [2026-05-19]
Pending tasks with `scheduled_for` > current_time are not stuck—they're waiting to dispatch. Past-due scheduled tasks get +2 priority boost automatically. Before escalating "stuck": verify (1) `scheduled_for` timestamp vs current time, (2) parent-task aggregation (intentional staging), (3) priority boost on next cycle.
**p-identity-verification** [2026-04-21, merged: multi-chain + sig-format-tolerance]
Verify sender via BOTH chain-specific addresses against known wallets. Mismatched pairs or old address reuse = compromised wallet. SIP-018/BIP-137 messages may arrive in multiple wire formats (RSV/VRS/raw 64-byte, recovery-id 0/1/27/28) — try all combinations; check both mainnet and testnet addresses in same test. Prevents message-forwarding attacks.
**p-model-selection** [2026-04-22, merged: introspection-sizing + predictive + cost-downgrade]
Daily/weekly introspection uses Sonnet (~10% cost vs Opus, no quality gap). Reserve Opus for: novel architectural decisions, ambiguous multi-source synthesis, creative depth. Predict complexity before task creation; assign model based on input scope. Subprocess memory overhead: opus + build tools = OOM on constrained systems. When a recurring task class becomes dominant cost driver, downgrade model if domain permits; quantify actual ROI before any efficiency refactor.
**p-failure-taxonomy-escalation** [2026-05-07]
4-class taxonomy: loops/give-ups/errors/recovery. Escalation: 3 discards→REFINE, 5→PIVOT, 2 PIVOTs→web search, 3→soft blocker. One success resets.
**p-pr-sensor-creation-gate** [2026-05-07]
PR review tasks: validate at creation (1) PR exists, (2) PR is open, (3) no pending task for (repo, PR#). All three checked independently. Per-resource cap: 1 pending task per (repo, PR#).
**p-simplify-preflighting** [2026-05-08]
Run `/code-review` on all changed files BEFORE opening a PR. Higher-ROI in sensors due to event-driven divergence. Catches dead code, unused constants, duplicated helpers, filter-chain inefficiencies.
**p-policy-deprecation-three-layer-atomicity** [2026-05-11]
Policy deprecations must touch three layers atomically: (1) SKILL.md documents policy, (2) CLI removes/flags path `unsupported`, (3) workflow tasks re-routed. Missing any layer causes recurring failures.
**p-supply-chain-audit** [2026-05-12, merged: cve-naming, multi-vector, ioc-sweep, vuln-disclosure]
Vuln disclosures from trusted partners: immediate high-priority ack, then queue lower-priority audit with scope-assessment skills. CVE names lie ("Query vulnerability" may spare packages without "Query" in the name).
CVE names lie ("Query vulnerability" may spare packages without "Query" in the name). Supply chain attacks layer vectors sequentially — enumerate all vectors, not just the primary. IOC sweeps: build list with multiple marker types (package names + filenames + SHAs + magic strings + exfil hosts), sweep all lockfiles in parallel, use org-wide code search (`gh api search/code`). Distinguish benign hits from breaches via path context.
**p-x-deleted-tweet-prescreen** [2026-05-13, expanded 2026-05-20]
External resource dependencies fail silently: X returns empty body for deleted/private tweets; dead links return 404. Pre-screen at three layers: (1) extraction time—filter bad references, (2) creation time—probe API before queuing, (3) dispatch time—early-exit if all resources inaccessible. Document prescreen workflow in AGENT.md when delegating external-dependent tasks.
**p-integration-sensor-version-dedup** [2026-05-13]
Integration sensors must check `pendingOrCompletedTaskExistsForSource` scoped to specific release version before queuing. Pattern: `source = "sensor:<skill>:<repo>:<version>"`. Multi-task orchestration: use `source = "task:<parent_id>:<scope>"` to prevent dispatch dedup on parallel follow-ups.
**p-claude-usage-quota-outage** [2026-05-14]
Claude Code quota exhaustion → dispatch-gate `rate_limited` stop. **Prevention**: parse "resets HH:MM (Timezone)" from `stop_reason`; if current time ≥ reset time, auto-reset (safe for rate-limit class only, not consecutive-failure stops).
**p-schema-query-render-alignment** [2026-05-19]
New fields on data models must be exposed atomically across three layers: (1) storage schema, (2) query layer (SELECT must include it), (3) presentation layer (UI must render it). Audit all models when adding fields; verify query reaches detail routes and feed routes separately.
**p-append-idempotency-multi-layer-dedup** [2026-05-15]
Append-only operations must dedup against BOTH in-memory state AND persisted store. On init: read persisted artifact, build dedup set, check before appending.
**p-sensor-source-key-interval-flood** [2026-05-16]
Sensors with static source keys + short intervals flood when trigger condition persists. Gate via date-scoping (`source = "sensor:name:YYYY-MM-DD HH"`) or condition-state files.
**p-large-audit-aggregator-cli** [2026-05-16]
Any task reading ≥10 files: build a CLI aggregator instead. `sensor-health-report` replaces 73 sensor.ts reads. Architecture reviews: scope to git diff since last SHA. @mention responses: read comment thread only, no full PR diff.
**p-state-machine-dedup-auto-advance** [2026-05-24, task #17585/#17590]
When a state machine creates a dedup'd task (checked via `pendingTaskExistsForSource` on workflow state), the state must advance immediately upon task creation. If state remains pending after task creation, sensors re-detect it on next cycle and re-queue — causing duplicate floods. Pattern: every task-creation action in a dedup'd state must include `autoAdvanceState: <target_state>`. Fix validated: retrospective_pending actions now auto-advance to completed, stopping 116-duplicate re-creation loop across 9 workflow machines. **Belt-and-braces** (shipped task #17590): workflow meta-sensor also gates on `recentTaskExistsForSource(source, 60min)` so any future autoAdvanceState omission caps damage at 1 duplicate per hour instead of one per 5-min cycle. Authors of new workflow templates: still add `autoAdvanceState` — the sensor gate is a safety net, not a substitute.
**p-architecture-review** [2026-05-16, merged: sha-gate + carry-watches]
Architecture review sensors should gate on SHA diff — persist review SHA after each cycle; compare HEAD SHA on next fire; if unchanged, return `"skip"`. Each cycle documents explicit "carry-watch" items in result_summary.
**p-multi-dispatch-path-completeness** [2026-05-16]
Return type changes in systems with multiple dispatch paths (legacy + new, sync + async) must thread through ALL paths. Identify all paths → thread change → test each independently before PR.
**p-audit-completeness** [2026-05-18, merged: fallback-mechanism-audit + category-gap-preemptive-fix + audit-and-implementation]
When adding a fallback or supplementary mechanism, audit ALL code paths that would consume it independently. When discovering a data gap in one item, audit the category and fix related gaps preemptively in the same PR. Persist audit findings with detail (skill name, line numbers, violation type). Audits discovering untracked files supporting active ops → trigger P5 follow-ups immediately.
**p-credential-exposure-pr** [2026-05-22, merged: escalation + pr-review-not-protection]
PR credential exposure: credentials are public from push time regardless of review status — CHANGES_REQUESTED blocks merge, NOT data. (1) Immediately post blocking review + escalate to decision-maker with incident summary, affected wallet, ranked actions (close PR, rotate, investigate source). (2) Track days-elapsed-since-exposure, not review status, as the risk indicator. Treat exposed credentials as fully compromised at push time.
**p-policy-secondary-effects** [2026-05-19/2026-05-27]
Policy disables have two aspects: (1) Scope — gate disabled feature within multi-purpose sensors; skip entirely sensors whose sole purpose is the disabled feature; audit for orphaned pending tasks. (2) Secondary effects — monitoring systems (freshness, activity metrics) will flag the pause as anomalous. Document expected secondary effects in the policy summary; mark as expected in triage to prevent false escalations.
**p-feedback-task-decomposition** [2026-05-19]
On receiving feedback via email: (1) reply immediately with concrete revision plan, (2) decompose revisions into specific execution tasks with model sized for the work, (3) link via `parent_id`. Establishes decision trail; prevents feedback stalling in queue-limbo.
**p-resource-constraint-batch-closure** [2026-05-20]
When a shared resource constraint (wallet balance, API quota, credential expiry) causes repeated failures across a task class: (1) close ALL pending tasks of that class, (2) create ONE escalation task scoped to the resource, (3) do not re-queue workflow tasks until resource confirmed restored. Independent retry per task wastes retry budget when root cause is shared.
**p-filter-deploy-queue-sweep** [2026-05-20]
After deploying a new sensor pre-screen or filter: immediately sweep the pending queue for tasks matching rejection criteria and close them. Pre-screens only apply to newly-queued tasks — already-queued tasks bypass the filter and burn a full dispatch cycle.
**p-cross-repo-threat-actor-scan** [2026-05-23]
When a threat actor appears in one repo (supply chain attack, credential exposure, malicious PR), proactively check other repos they've touched before closing the incident. Cross-repo confirmation changes severity: single-repo = possible mistake; multi-repo = persistent threat actor. Use `gh search prs --author <actor>` across org repos. Document actor identity in MEMORY.md [A] with cross-repo confirmation status.
**p-subagent-output-schema-contract** [2026-05-26, task #17688]
When delegating research/synthesis to multiple parallel subagents whose outputs will be merged at the orchestrator boundary, explicitly document expected output schema in AGENT.md (array vs object, field names, required fields). Subagent schema drift → normalization cycles at dispatch boundary. Schema contracts in delegation docs prevent rework.
**p-dispatch-infra-config** [2026-05-27, task #17751]
Three dispatch infrastructure rules: (1) HTTP/SSE MCP transports silently cap tool calls at 60s — set `MCP_TOOL_TIMEOUT=120000` in dispatch env; silent timeout ≠ error, causes mysterious failures on x402/Stacks. (2) Model unavailability: configure `--fallback-model sonnet` so Opus unavailability doesn't block tasks. (3) Framework config hot-reload: write flag file on change → SessionStart hook detects + consumes flag on next session → clears after consuming; prevents stale config without service restart.
**p-dispatch-gate-stop-false-positive** [2026-05-27, tasks #17145/#17151/#17163/#17167]
Dispatch-stale health alerts are always gate-stop false positives, not service crashes. Verification: check `db/dispatch-lock.json` presence + `cycle_log` timestamp. If lock present AND cycle_log updated within 2min → dispatch is mid-cycle; if lock present AND cycle_log stale → gate-stopped (lock not released), not crashed. Resolution: manual `arc run` to trigger next cycle — do NOT restart services. Never close as `failed` without verifying both signals; 4 identical FP failures this week from skipping this check.
**p-multi-vm-migration-identity-preservation** [2026-05-29, task #17861]
Multi-system agent migrations require atomic identity preservation: snapshot old state (commit SHA), document in legacy README, validate cryptographic identity on BOTH chains (Bitcoin Taproot + Stacks), maintain separate state dirs, phase-gate via RFC numbering. Enables safe infrastructure evolution with verified rollback paths and prevents partial/orphaned migrations.
**p-agent-md-authoring-trigger** [2026-05-27, 7 skills: defi-zest, jingswap, arc-worktrees, daily-brief-inscribe, defi-bitflow, arc-payments, dao-zero-authority]
Author `AGENT.md` for a skill when: (1) skill has been dispatched 3+ times, (2) each dispatch required re-deriving multi-step flows from scratch (detectable via high token-in on tasks using that skill), (3) SKILL.md alone doesn't contain procedural detail (only architecture/CLI). `AGENT.md` is a subagent briefing — never load into orchestrator context. After authoring, dispatch context shrinks because orchestrator delegates execution to subagent reading `AGENT.md` directly. Batch authoring when multiple skills qualify simultaneously — reduces the identification overhead.
**p-batch-uniform-error-diagnosis** [2026-05-29, task #17787]
Batch operations returning uniform error signature (e.g., all 46 tweets return "API returned HTTP error") indicate service-level issue (rate-limit/outage), not individual failures. Don't fan out N tasks; queue ONE orchestration task with explicit diagnose-before-fanout: retry with backoff, classify service state, conditionally fan out. Prevents wasted dispatch cycles on cascading individual failures when root cause is shared.
**p-reflect-per-task-closure** [2026-05-29, task #17794]
Write learnings at task close (via `arc tasks close --summary "insight"` or brief shared entry), not waiting for periodic evals. This shifts reflection from batch eval cadence to continuous signal capture. Pattern: if task revealed a reusable heuristic, debugging technique, or architectural insight, capture as 1–2 sentence summary. Accumulates in `memory/recent.log` for monthly consolidation into MEMORY.md or shared entries. Cheap experiment: captures signal at full context (when learning is fresh), not after context flush.
**p-external-research-structure-gate** [2026-05-29, task #17794]
Section-scoped research (task description specifies "Section: X") must validate source structure at orchestration boundary. Missing validation causes skill to fall back to default behavior (alphabetically-first entries) instead of scoped subset. Pattern: decompose into (1) structure validation + section-path confirmation (cheap upfront probe), (2) deep-dive tasks. If section validation fails, close orchestrator as `failed` with specific scope error — don't proceed to deep-dives.
**p-hook-sensor-async-coordination** [2026-05-29, task #17807]
Hook-to-sensor async IPC: Stop hook writes structured files (YAML frontmatter) to inbox/<peer>/<ts>.md; sensor scans inbox/agent/ at fixed cadence, deduplicates via source key, queues tasks, archives processed. Atomic writes (temp→rename), dedup set built at sensor init. Applies: inter-agent messages, audit trails, side-effect logging. Generalizes to any async notification where hook fires outside task queue.
**p-multi-source-state-file-coordination** [2026-05-29, task #17895]
When sensor infra and task code both write to the same state file, validate field format on read (presence ≠ correct format) and merge on write to preserve sensor metadata — arc-email-worker cursor bug: loadCursorState assumed file existence = initialization, but sensor infra wrote `{last_ran, version}` while task expected `{inbox, sent}`.
**p-multi-layer-optimization-validation** [2026-05-29, task #17938]
Performance optimizations may require complementary fixes at different layers. Arc-email-worker cursor fix (polling layer, 13% reduction: 125k → 82k/hr) still required composite index fix (query execution layer, targeting <1k/hr). After verifying first optimization, identify whether remaining cost is same-layer inefficiency (suggesting a second fix) or different root cause. Prevents premature "fixed" closure when metric improves but misses target.
**p-file-dep-pin-illusion** [2026-05-30, task #17998]
File-based dependency pins in prose (e.g., `file:../substrate-db@SHA`) are documentation only — actual resolved dependency is on-disk state. Local checkouts can be stale and pre-date PR changes. When verifying PR changes affecting file deps, check function signatures against the PINNED SHA in the actual upstream repo, not local clones.
**p-distributed-job-double-execution-window** [2026-05-30, task #17998]
Job dedup based on status prevents duplicate CLAIMS but not double EXECUTION. If claim→enqueue→execute time exceeds the lease TTL, a job can be claimed again before the first execution completes. Verify TTL >> p99 execution time AND validate actual side effects (not just status) before assuming idempotency in distributed job systems.
**p-cve-batch-cross-repo-triage** [2026-06-02, tasks #18110-18112]
When the same CVE appears across multiple repos (e.g., vitest CVE-2026-47429 in landing-page, aibtc-mcp-server, x402-sponsor-relay), triage risk once and apply uniformly. Pattern: (1) assess actual exploitability (platform/config requirements, not just CVSS score), (2) apply the same verdict to all affected repos in a batch, (3) Dependabot auto-fix approval is appropriate when risk is low and all repos share the same environment constraints. Don't triage the same CVE N times independently — the first assessment is the pattern.
**p-threshold-sensor-cooldown-gate** [2026-06-02, validated: arc-housekeeping e96561a0 + recent.log 15547bf3]
Threshold-based sensors fire repeatedly when the action doesn't reduce the triggering condition (e.g., >300 lines, but archival is no-op when entries <30d old; "0 fixes applied" on 2 issues detected). Pattern: persist action result hash via `getLastCompletedTaskBySource`; before re-firing, verify either (1) condition improved, or (2) skip if cooldown active AND no progress. Arch review found this pattern validated twice: arc-housekeeping (zero-fix churn loop, 4h cooldown) and recent.log (consolidation no-op loop, 4h cooldown). RULE: any sensor with threshold-based fire logic and non-reducing actions needs this guard.
**p-filesystem-state-detection-before-replace** [2026-06-02, task #18149]
When creating filesystem resources (symlinks, directories) that may already exist, use `lstatSync` to detect the actual state before attempting creation; unconditionally `rm -rf` before replacing. Entry-count checks (`entries.length <= 1`) fail when untracked files coexist — silently throwing EEXIST. Discovered when worktree isolation was failing: `createWorktree` check didn't account for SVG files alongside `arc.db`, causing symlink to fail and dispatch to silently fall back to non-isolated main tree (error caught, no signal).
**p-exclusion-rule-accumulation-refactor** [2026-06-03, task #18189]
When skip/exclusion conditions accumulate to ~20+ and cluster by semantic type (e.g., domain-content words vs operational keywords), replace scattered prefix guards with a dedicated pattern table (e.g., `CONTENT_TASK_PATTERNS`, `OPERATIONAL_KEYWORDS`). Transparent, testable, maintainable at scale—context-review skip list at ~18 conditions approaching refactor threshold.
**p-bounty-submission-api-signing** [2026-06-03, task #18169]
DeFi audit bounties require BIP-137/BIP-322 signed submissions: construct message `AIBTC Bounty Submit | {bountyId} | {btcAddr} | {message} | {contentUrl} | {signedAt}`, sign via `arc skills run --name bitcoin-wallet -- btc-sign`, submit `POST /api/bounties/{id}/submit` with `submitterBtcAddress`, `submitterStxAddress`, `contentUrl`, `message`, `signedAt`, `signature`. Pattern: create gist with audit findings, pass gist URL as contentUrl. Applies to 4 pending audit bounties (Bitflow, ALEX, Starknet, etc.); submit early to avoid deadline crunch.
