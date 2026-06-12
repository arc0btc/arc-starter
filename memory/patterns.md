# Patterns
*Reusable operational patterns, validated ≥2 cycles. Last consolidated: 2026-06-10T18:20Z*

## Core Patterns
**p-model-required**
All task-creation paths must include model. Tasks without model fail at dispatch: "No model set."
**p-pr-supersession**
When higher-priority task supersedes pending tasks, close explicitly: `status=failed, summary="superseded by #X"`. Don't leave — inflates failure counts.
**p-cooldown-precheck** [2026-05-07]
Two gates before signal filing: (1) daily task count AND (2) 60-min per-agent cooldown. Both must pass. Dedup by (beat, source_url, data_hash). **Payment ordering**: cooldown check BEFORE x402 payment — task #15946 lost 100 sats paying first.

## Operational Patterns
**p-sensor-state-resilience** [2026-05-07]
Validate persisted state on load; rebuild from empty on version mismatch. Multi-source: fetch all in parallel, continue with available. Write scheduling state AFTER successful run — writing on entry creates multi-hour lockout on failure. When sensor and task code share state files, validate expected fields on read (presence ≠ correct format) and merge on write to preserve sensor metadata.
**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on same nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks. Don't roll back counter on tx failure; resync on staleness (>90s). Lock/cache TTL must exceed p99 operation duration — short TTL → concurrent bypass → duplicate fan-out.
**p-validation-credential-consistency** [merged: p-validation-before-action + p-credential-namespace-consistency]
Before financial ops: validate address format AND maintain deny-list for addresses passing format but rejected downstream. Apply at two layers: (1) sensor-level, (2) execution-time. Track resource state hash; skip if unchanged. Sensor credential reads must match namespace in SKILL.md and actual store — mismatch causes silent skips.
**p-follow-up-task-skill-name-validation** [2026-05-11]
Verify skill names via `arc skills` before `arc tasks add --skills`. Nonexistent names silently ignored at dispatch. Correct mappings: `quantum`→`arxiv-research`, `arc-signal-manager`→`aibtc-news-editorial`.
**p-context-review-keyword-mapping** [2026-05-15]
When scaffolding a new skill domain, update SKILL_KEYWORD_MAP in context-review atomically (same commit). Gaps cause dispatch mismatches where tasks run without correct skill context loaded.
**p-external-api-drift** [2026-05-08]
External platforms silently restructure without notice. On resource retirement, audit ALL hardcoded references across all skills. Documentation updates (AGENT.md, SKILL.md) atomic with code fixes. Classification rules on external error text go stale — audit quarterly.
**p-fix-and-deploy-verification** [merged: p-fix-verification + p-content-publish-deploy-verify]
"Shipped" ≠ "working"; "built" ≠ "deployed." After any fix: require 1–2 observation cycles; define success as `verify_command outputs metric ≥ threshold`. After any publish/deploy: verify the deploy step ran — build success alone doesn't update the live site.

## Signal Quality
**p-preflight-validation** [2026-04-22]
Pre-validate at two layers: (1) Sensor — predict score, discard if below floor; build validators returning bool/error at queue time, preventing wasted dispatch cycles. (2) Filing — query current minimum accepted score; at cap, displacement requires exceeding LOWEST current accepted score.
**p-signal-filing-strategy** [2026-05-11]
Signals need AIBTC-native angle. **sourceQuality is source-count-based** (1=10, 2=20, 3=30). Multi-beat sprints: identify → pre-filter → skip covered angles → sort by confidence → file #1 → queue #2+ with `scheduled_for = now + cooldown`. API: combined content ≤1000 chars; sources = `[{"url":"...","title":"..."}]`. Always pass `--sources` with ALL data sources. Re-filing with improved sourcing is a valid quality lever. Cooldown queue: when cooldown active but clears within task TTL, compose immediately and queue filing as follow-up with `--scheduled_for` — avoids re-queuing research.
**p-timeout-decomposition-preflighting** [2026-05-09]
Complex signal workflows hit 15min timeout when content >150 lines, 3+ external fetches, or novel research. Decompose at creation: (1) research+compose, (2) file. Signal: pre-dispatch cost estimate >$1 → decompose.

## Research & Synthesis
**p-research-synthesis** [2026-05-07]
N items: quick-scan to skip low-relevance, delegate to P2 Opus orchestrator creating N P5 tasks + synthesis. Reports >1000 words via email. Batch dispatch: N parallel tasks (unique `source = "task:<parent>:<index>"`) + 1 synthesis task (P3, scheduled 6–8h later). Archive previous output atomically before committing replacement.
**p-multi-repo-research-planning** [2026-06-08]
Before queuing multi-repo research tasks, enumerate actual scope via org API (not assumptions) and get stakeholder agreement on decomposition axis. By-repo decomposition is cheaper than by-dimension when the latter requires redundant external scans (e.g., awesome-lists). Plan collaboratively, then queue fan-out — reversed order wastes cycles on disagreement.

## Agent Design
**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model before shipping. Sanitize fetched content. DeepMind rates: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.
**p-contract-operations** [2026-04-29]
Design: spec inputs/outputs/state-transitions/errors first. Audit existing contracts before writing new. Pre-flight: simulate before nonce acquisition (catches ~80% failures at zero cost). Start bilateral escrow before DAO.
**p-revision-loop-primitive** [2026-05-11, merged: p-pr-reversion-source-verification]
Before accepting re-review, check if flagged issues were actually addressed — if unchanged, decline. When re-verifying author fix-claims, fetch actual file content at HEAD SHA via `gh api repos/OWNER/REPO/contents/PATH?ref=<sha> --jq .content | base64 -d`, NOT cached `gh pr diff`. Stale diffs cause false negatives as much as false positives. Write-path verification: walk all mutation paths; verify each triggers invariant maintenance.
**p-purpose-loop** [2026-05-07]
Daily PURPOSE evals expose directive gaps → low scores become priorities. If ANY PURPOSE dimension ≤2, queue P2 boost task ONLY if queue has existing work. Empty queue + low scores = structural constraint — investigate root cause instead; don't queue phantom boost tasks.
**p-architectural-finding-escalation** [2026-05-19]
Task findings identifying schema changes, dispatch core modifications, or multi-system refactors should surface to decision-maker with explicit rationale BEFORE queuing implementation tasks.
**p-queue-composition-guard** [2026-05-05]
When any single category exceeds 30% of pending tasks, apply sensor cap or daily limit. Strategic tasks ≥40% of weekly cycles. Cap-driven dequeue → `status=completed`, not `failed`. Gate "[repo] Implement #N" tasks at creation; use worktree isolation.
**p-failure-diagnosis** [2026-05-07]
When N failures spike, classify by error type. 80%+ same root cause → fix the cause. After fix, scan pending tasks and close as `blocked` — pre-queued tasks bypass updated sensor checks. Active task + dead PID + stale cycle_log (>2min) → validate vs cycle_log; consistent→resume, inconsistent→archive+restart.
**p-scheduled-task-false-positive** [2026-05-19]
Pending tasks with `scheduled_for` > current_time are not stuck—they're waiting to dispatch. Before escalating "stuck": verify (1) `scheduled_for` timestamp vs current time, (2) parent-task aggregation, (3) priority boost on next cycle.
**p-identity-verification** [2026-04-21]
Verify sender via BOTH chain-specific addresses against known wallets. Mismatched pairs or old address reuse = compromised wallet. SIP-018/BIP-137 messages may arrive in multiple wire formats — try all combinations; check both mainnet and testnet addresses in same test.
**p-model-selection** [2026-04-22]
Daily/weekly introspection uses Sonnet (~10% cost vs Opus, no quality gap). Reserve Opus for: novel architectural decisions, ambiguous multi-source synthesis, creative depth. When a recurring task class becomes dominant cost driver, downgrade model if domain permits; quantify actual ROI first.
**p-emerging-model-cost-monitoring** [2026-06-10]
When new model releases appear (e.g., Claude Fable 5 at 33% lower cost than Opus 4.8), add to cost-watch tracking and monitor quality signals across 2–3 dispatch cycles before fleet-wide adoption. Pattern: one task per model using the candidate on real workload, measure latency + quality vs baseline; blocks fleet decision until ROI confirmed. Prevents premature downgrade churn.
**p-pr-sensor-creation-gate** [2026-05-07]
PR review tasks: validate at creation (1) PR exists, (2) PR is open, (3) no pending task for (repo, PR#). All three checked independently. Per-resource cap: 1 pending task per (repo, PR#).
**p-simplify-preflighting** [2026-05-08]
Run `/code-review` on all changed files BEFORE opening a PR. Higher-ROI in sensors due to event-driven divergence. Catches dead code, unused constants, duplicated helpers, filter-chain inefficiencies.
**p-policy-deprecation-atomicity** [merged: p-policy-deprecation-three-layer-atomicity + p-schema-query-render-alignment]
Policy deprecations and new data fields must touch three layers atomically: (1) storage/policy documentation, (2) code/CLI that implements it, (3) presentation/consuming layers. Missing any layer causes recurring failures or silent data gaps.
**p-supply-chain-audit** [2026-05-12, merged: p-cve-batch-cross-repo-triage]
Vuln disclosures: immediate ack, queue audit with scope-assessment skills. CVE names lie — enumerate all vectors, not just the primary. IOC sweeps: build multi-marker list (packages + filenames + SHAs + exfil hosts), sweep all lockfiles in parallel. Identical CVE across multiple repos: triage risk ONCE and apply uniformly — don't assess N times independently.
**p-x-deleted-tweet-prescreen** [2026-05-13]
External resource dependencies fail silently. Pre-screen at three layers: (1) extraction time, (2) creation time — probe API before queuing, (3) dispatch time — early-exit if all resources inaccessible.
**p-integration-sensor-version-dedup** [2026-05-13]
Integration sensors must check `pendingOrCompletedTaskExistsForSource` scoped to specific release version before queuing. Pattern: `source = "sensor:<skill>:<repo>:<version>"`. Multi-task orchestration: use `source = "task:<parent_id>:<scope>"` to prevent dispatch dedup on parallel follow-ups.
**p-claude-usage-quota-outage** [2026-05-14]
Claude Code quota exhaustion → dispatch-gate `rate_limited` stop. **Prevention**: parse "resets HH:MM (Timezone)" from `stop_reason`; if current time ≥ reset time, auto-reset (safe for rate-limit class only).
**p-external-side-effect-idempotency** [merged: p-append-idempotency + p-external-side-effect-idempotency; extended 2026-06-12]
Tasks with external side effects (email send, STX send, x402 payment, CLI post-chat) must self-verify before acting: check sent folder / tx history / payment receipt / channel messages within a recent time window. Rule: before executing any external side effect, check if it already occurred — close idempotently without repeating. Add idempotency check as FIRST step of any send path. Applies equally to dispatch-level tasks and credential-gated CLIs (e.g., whop's `post-chat` — before re-running a failed post task, query the channel for a matching message). Append-only operations must also dedup against both in-memory state AND persisted store.
**p-sensor-source-key-interval-flood** [2026-05-16]
Sensors with static source keys + short intervals flood when trigger condition persists. Gate via date-scoping (`source = "sensor:name:YYYY-MM-DD HH"`) or condition-state files.
**p-large-audit-aggregator-cli** [2026-05-16]
Any task reading ≥10 files: build a CLI aggregator instead. `sensor-health-report` replaces 73 sensor.ts reads. Architecture reviews: scope to git diff since last SHA. @mention responses: read comment thread only, no full PR diff.
**p-state-machine-dedup-auto-advance** [2026-05-24]
When a state machine creates a dedup'd task, the state must advance immediately upon task creation — else sensors re-detect and re-queue each cycle. Every task-creation action in a dedup'd state must include `autoAdvanceState: <target_state>`. Belt-and-braces: workflow meta-sensor also gates on `recentTaskExistsForSource(source, 60min)` — safety net, not a substitute.
**p-external-signal-window-blindspot** [2026-06-05]
External APIs with pagination limits create invisible ranges where state transitions aren't observed. Add completed-task dedup layer independent of external pagination — track task completion by versioned source key; skip re-queue if completed task exists even if external signal hasn't appeared. Versioned keys (`pr-review:v1`, `pr-review:v2`) allow per-commit re-review while preventing loops.
**p-architecture-review** [2026-05-16, hardened 2026-06-10]
Architecture review sensors should gate on SHA diff — persist review SHA after each cycle; compare HEAD SHA on next fire; if unchanged, return `"skip"`. Each cycle documents explicit "carry-watch" items in result_summary. Major findings (schema changes, dispatch core modifications, architectural innovations like ARC-0011) must be documented in state machine or technical spec form — not just flagged. [NEW-ACTION] items identified in prior reviews should be closed out in follow-ups; implement and re-verify in next cycle.
**p-wave-backfill-primitive-audit** [2026-06-10]
When shipping multi-wave features (primitives added in Wave N, wired into callers in Wave N+1), audit that the new primitive is called from ALL appropriate code paths—not just error recovery. Trace all callers and verify the primitive fires on every exit branch. Missing calls in happy-path create delayed repair loops (e.g., alarm-driven recovery masking incomplete state advancement).
**p-audit-completeness** [merged: p-audit-completeness + p-multi-dispatch-path-completeness]
When adding a fallback or fix, audit ALL code paths independently (legacy + new, sync + async). When discovering a data gap in one item, audit the category and fix related gaps preemptively in the same PR. Return type changes must thread through ALL dispatch paths. Persist audit findings with detail (skill name, line numbers, violation type).
**p-credential-exposure-pr** [2026-05-22]
PR credential exposure: credentials are public from push time regardless of review status — CHANGES_REQUESTED blocks merge, NOT data. Immediately post blocking review + escalate with incident summary, affected wallet, ranked actions (close PR, rotate, investigate source). Track days-elapsed-since-exposure as the risk indicator.
**p-policy-secondary-effects** [2026-05-19]
Policy disables have two aspects: (1) Scope — gate disabled feature within multi-purpose sensors; skip entirely sensors whose sole purpose is the disabled feature; audit for orphaned pending tasks. (2) Secondary effects — monitoring systems will flag the pause as anomalous. Document expected secondary effects in the policy summary.
**p-feedback-task-decomposition** [2026-05-19]
On receiving feedback via email: (1) reply immediately with concrete revision plan, (2) decompose revisions into specific execution tasks with model sized for the work, (3) link via `parent_id`.
**p-resource-constraint-batch-closure** [merged: + p-filter-deploy-queue-sweep]
When a shared resource constraint (wallet balance, API quota, credential expiry) causes repeated failures: (1) close ALL pending tasks of that class, (2) create ONE escalation task scoped to the resource, (3) do not re-queue until resource confirmed restored. After deploying a new sensor filter: immediately sweep the pending queue for tasks matching rejection criteria and close them — pre-screens only apply to newly-queued tasks.
**p-cross-repo-threat-actor-scan** [2026-05-23]
When a threat actor appears in one repo, proactively check other repos before closing the incident. Cross-repo confirmation changes severity: single-repo = possible mistake; multi-repo = persistent threat actor. Use `gh search prs --author <actor>` across org repos.
**p-subagent-output-schema-contract** [2026-05-26]
When delegating research/synthesis to parallel subagents whose outputs will be merged at orchestrator boundary, explicitly document expected output schema in AGENT.md (array vs object, field names, required fields). Schema drift → normalization cycles.
**p-dispatch-infra-config** [2026-05-27]
HTTP/SSE MCP transports silently cap tool calls at 60s — set `MCP_TOOL_TIMEOUT=120000` in dispatch env; silent timeout ≠ error. Configure `--fallback-model sonnet` so Opus unavailability doesn't block tasks.
**p-dispatch-gate-stop-false-positive** [2026-05-27]
Dispatch-stale health alerts are always gate-stop false positives. Verification: check `db/dispatch-lock.json` presence + `cycle_log` timestamp. If lock present AND cycle_log stale → gate-stopped, not crashed. Resolution: manual `arc run` — do NOT restart services.
**p-agent-md-authoring-trigger** [2026-05-27]
Author `AGENT.md` for a skill when: (1) dispatched 3+ times, (2) each dispatch required re-deriving multi-step flows from scratch (high token-in), (3) SKILL.md alone doesn't contain procedural detail. `AGENT.md` is a subagent briefing — never load into orchestrator context.
**p-batch-uniform-error-diagnosis** [2026-05-29]
Batch operations returning uniform error signature indicate service-level issue (rate-limit/outage), not individual failures. Queue ONE orchestration task with diagnose-before-fanout: retry with backoff, classify service state, conditionally fan out.
**p-reflect-per-task-closure** [2026-05-29]
Write learnings at task close (via `arc tasks close --summary "insight"`), not waiting for periodic evals. If task revealed a reusable heuristic or architectural insight, capture as 1–2 sentence summary. Accumulates in `memory/recent.log` for monthly consolidation.
**p-threshold-sensor-cooldown-gate** [2026-06-02, hardened 2026-06-06]
Threshold-based sensors fire repeatedly when action doesn't reduce the triggering condition. Pattern: persist action result hash via `getLastCompletedTaskBySource`; before re-firing, verify condition improved OR cooldown active + no progress. RULE: any sensor with threshold-based fire logic and non-reducing actions needs this guard.
**p-exclusion-rule-accumulation-refactor** [2026-06-03]
When skip/exclusion conditions accumulate to ~20+ and cluster by semantic type, replace scattered prefix guards with a dedicated pattern table. Transparent, testable, maintainable at scale.
**p-completed-task-terminal** [2026-06-03]
A completed task is terminal — no code path should set its status back to `pending`. Safe fix requires two layers: (1) catch-block status check before any requeue call, (2) `UPDATE ... WHERE status != 'completed'` guard in `requeueTask()`. After shipping a resurrection guard, sweep for tasks already left in bad `pending` state — the guard is preventive, not curative.
**p-cicd-prereq-before-verify** [2026-06-03]
Before queuing a `verify-*-deployed` task, confirm deployment infrastructure exists. A PR merged without a deployment workflow causes health endpoints to return 404 indefinitely. Gate `verify-deployed` task creation on CI/CD signal existence; when missing, queue "add CI/CD workflow" task first.
**p-stale-blocking-suppress** [2026-06-06]
Blocked tasks showing no new signals beyond age threshold (48h+) are stale-only candidates. Apply long suppress window (168h+) to prevent repeated reviews that won't change the outcome. Pattern: `source = "task:<parent>:<timestamp>"` with last-completed check.
**p-fallback-path-observability** [2026-06-06]
When systems have fallback mechanisms (model downgrade, retry strategies, circuit-breakers), ensure the actual execution path is observable in logs. Extract actual model from stream and compare against requested; log mismatch + update `cycle_log.model` when fallback activates. Blind fallbacks hide cost/quality deviations.
**p-kickoff-task-parameter-capture** [2026-06-08]
When queuing a kickoff task after stakeholder approval for multi-phase work, embed all agreed parameters in the task description (scope, decomposition approach, deliverables, constraints). Prevents context loss between dispatch cycles where the executor can't easily re-read the approval email.
**p-documented-inventory-atomicity** [2026-06-08]
When adding/updating features in a documented artifact collection (README tables, skill registries, install paths), changes must be atomic: (1) feature implementation, (2) update all referential documentation, (3) verify discovery/install mechanisms. Silent addition (off-tree, missing from README) causes agent-visible inventory inconsistency — `open-responses/` skill added but not listed, invisible to automated discovery.
**p-scaffold-template-version-sync** [2026-06-08]
Scaffold templates that teach API patterns (e.g., `create-agent-tui` teaching `@openrouter/agent`) must track upstream library versions. Lag >1 minor version means agents copy outdated dependency pins and learn deprecated APIs. Research scope: include template version check vs published version; flag if lag ≥2 minor.
**p-repository-lifecycle-forensics** [2026-06-08]
When investigating claimed migrations/deprecations, verify via commit logs (explicit source attribution + dates + message tone) rather than relying on archive status or README alone. A 15–30 day rapid cycle (create→archive→rebuild) + gap timing indicates intentional prototype validation, not abandonment. Forks of archived repos that survive + gain stars reveal ecosystem demand for the simpler design.
**p-ecosystem-fork-taxonomy** [2026-06-08]
Categorize forks into structural groups to assess platform strength: (1) direct tools (built specifically for the platform), (2) native adoption (platform is primary gateway), (3) ecosystem integrations (platform is one of N providers), (4) adjacent infrastructure (not primarily consumers). Most forks fall into (3); (2) forks gaining >10× stars indicate design-market fit. Absence from (1) signals platform tool gaps.
**p-directory-curation-gap-analysis** [2026-06-08]
Community-curated registries/directories (awesome-lists, package registries) are PR-gated and incomplete. High-star projects absent from directories indicate adoption not self-reported. When evaluating platform adoption metrics, cross-check registries against dependency graphs + GitHub "used by" counts + fork stars to estimate hidden adoption. Registry-only metrics are floor values, not ceiling.
**p-dead-code-detection-during-audit** [2026-06-10]
Systematic code audits (architecture reviews, security scans) provide high-signal opportunity to flag unused imports, exports, and helper functions within the diff context. Add to implementation queue only if safe to remove (no cross-skill re-exports); surfaces ~2-5 dead-code items per major review cycle. Prune atomically with related changes in same PR.
**p-version-gated-upgrade-preflight** [2026-06-10]
Any task that upgrades version-gated artifacts (model IDs, Claude Code API flags, SDK min-version features) must run `claude --version` (or equivalent) as step 1 and bail out with `status=blocked` if the version is insufficient. Do not let the safety gate be the first line of defense — the task itself should check preconditions upfront. Pattern: task subject starting with "update MODEL_IDS" or "upgrade to claude-fable" → prepend version check. If version insufficient, queue `[[claude-code-version-deploy]]` as P2 prerequisite and close current task as `blocked`. Validated: task #18510 (v2.1.161 attempted fable-5 requiring v2.1.170+).
**p-haiku-code-edit-floor** [2026-06-10]
Haiku has a ~5-minute dispatch timeout and cannot complete multi-step code modification tasks. Floor rule: any task whose subject starts with `fix:`, `feat:`, `refactor:`, or `chore:` touching TypeScript/source files must be assigned `sonnet` minimum — never `haiku`. Haiku is valid only for: bounded reads (status checks, log tails), single-file query tasks, simple CLI operations with deterministic output. Sensor-level model assignment should enforce this: if task subject matches code-edit pattern → override model to `sonnet`. Validated: task #18516 timed out after 5min adding a dedup guard (haiku tier); MEMORY.md misc rule "Haiku = simple, fast, bounded operations only."
**p-transient-api-failure-backoff** [2026-06-10]
Transient external API failures (429 rate-limit, timeout) on sensor-driven tasks should not re-queue immediately — the sensor will re-fire and hit the same wall the next minute. Pattern: after task closes as `failed` with a 429/timeout reason, the next sensor fire must check for a recent same-source failure within 4h and, if found, skip or schedule with `scheduled_for += 4h`. Without this guard, rate-limited APIs generate same-subject failures on consecutive days (tasks #18255 and #18295 — arXiv 429 on June 4 and June 5). Implementation: in sensor, `getLastFailedTaskBySource(source, windowHours=4)` before queuing; if present, return `"skip"`. Related: `p-threshold-sensor-cooldown-gate` (condition-not-improving guard for threshold sensors).
**p-credential-gated-cli-graceful-fail** [2026-06-12]
Skills with credential-gated CLIs should land before credentials exist, failing with a clear message (exit 1) if the key is absent. Pattern: in cli.ts, `const key = getCredential(service, name); if (!key) exit(1, "Missing credential...")` instead of silently succeeding. Enables safe pre-landing of a skill, discovery of channel/experience IDs via `list` commands, and clear onboarding (whoabuddy knows exactly what to provision). Task #18598: whop skill's `whoami` command works without `api_key` to show the pattern is landing-safe; missing-key failures are explicit.
**p-strategy-doc-design-anchor** [2026-06-12]
Multi-phase features should produce a STRATEGY.md in the same PR as the first-phase CLI, isolating design decisions (roadmap, architecture, credential schema, unknowns) from implementation. STRATEGY.md avoids loading into orchestrator context; subagents reference it via `skills/*/STRATEGY.md` when designing follow-up work. Decouples "what we're building" (stable, strategic) from "how we're building phase 1" (volatile, tactical). Task #18598: whop/STRATEGY.md clarifies blog→chat (a1, wedge) vs blog→course (a2, phase 2) vs agent-stack courses (b, backlog) — follow-up tasks use this anchor without re-deriving the scope.
**p-staged-rollout-human-gate** [2026-06-12]
Side-effecting features with low operational history should gate initial runs via human approval before full automation. Pattern: queue dispatch tasks for whoabuddy's OK-or-reject (e.g., "post this hot-topic" tasks), or stage posts to a private channel first. Ties the gate to reputational risk and voice quality (SOUL: must add information, ask a question, or make someone want to respond). Task #18598: whop post-chat recommends human-review gate on first N posts to avoid low-value spam on paying members. Gate duration: until voice is trusted (2–4 posts) or until a quality sensor exists.
