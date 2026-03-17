# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions. Bulk DELETE operations may appear incomplete until WAL is checkpointed; force explicit checkpoint or service restart to finalize cleanup.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns. Export gate state to sensors for async recovery patterns.
- **Architectural constraint paradox detection:** When a system component is responsible for its own monitoring (e.g., dispatch queuing recovery for dispatch stall), identify the self-referential loop and propose infrastructure that breaks it: external watchdog, out-of-band signaling, or bypass logic that doesn't depend on the stalled component.
- **Provisioning strategy in specification phase:** Decide provisioning model (activation-only vs. pre-provisioned) during architecture phase, not implementation. Activation-only provisioning changes service costs, memory footprint, and latency SLA—deferring causes expensive rework.
- **Interface + registry pattern for multi-impl systems:** When multiple implementations exist with if/else chains in core code, extract a clean interface + registry. Each implementation owns its own timeout, retry, and output parsing.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup: verify completion + block recent:** Mark state "done" only after verifying task completion in DB (`completedTaskCountForSource()`), not on creation. Also dedup against recently-completed tasks (e.g., `recentTaskExistsForSourcePrefix(source, 23*60)`) — pending-only checks miss immediate re-queues after completion.
- **Sensor threshold recalibration when operational baselines shift:** When a fix changes patterns (e.g., cadence fix → daily posting jumps from 1→10 posts), thresholds tuned for old baseline become noise generators. Re-tune in a follow-up task.
- **Dedup key scope: entity-based, not reason-based:** Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.
- **Multi-item dedup: check against newest item:** Compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Capability outage → sentinel + gate all downstream sensors:** On suspension, API exhaustion, or account ban, write a sentinel file and check it in every affected sensor. Prevents cascading failures and child-task explosion.
- **Skill effectiveness proactive monitoring:** Add a dedicated sensor that scans skills for underperformance (>10 samples with <70% completion rate in 7 days) and queues maintenance tasks automatically.
- **Measurement-driven anomaly detection:** Add proactive sensors for implicit operational metrics (cost-per-skill rolling average deviations >3x, accuracy drift, gap duration thresholds) to surface problems before cascading. Converts reactive incident response into preventive tuning.
- **Operational health sensors for aggregate state detection:** Use dedicated sensors (6h or 15min cadence) to query operational state across multiple dimensions and create review/remediation tasks.
- **Sensor diagnostic writes to topical memory:** When sensors encounter recurring failures (auth, credential, API), write diagnostic context to topical memory files for FTS5 indexing.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Priority-based phase sequencing with explicit validation gates:** Use priority gaps to enforce phase sequence, but add explicit validation gates between phases to prevent cascading failures. Phase N+1 never starts until Phase N validates. Each gate checks one concern: infrastructure, dispatch, sensors, domain, stability. Pattern: Phase 0 → `[ validate: X ready? ]` → Phase 1 → `[ validate: Y ready? ]` → Phase 2, etc.
- **Content-type routing:** Presentation/audience-facing work routes to Opus minimum (tone, framing, audience judgment). Retrospective tasks need Sonnet minimum (P7) — Haiku timeout insufficient for reading records + extracting patterns.
- **Tiered improvement planning from audits:** Organize into tiers (T1=this week, T2=two weeks, T3=backlog) and queue as priority-ranked tasks (T1→P3, T2→P5, T3→P8). Prevents scope creep.
- **Optional feature graceful degradation:** Design tasks so missing optional capability skips the feature without blocking core work. Document skip in result_summary.
- **Non-fatal error wrapping for auxiliary operations:** For operations that fail non-fatally (e.g., email forwarding when message is already stored, third-party enrichment when source is unavailable), wrap in try-catch and log but don't re-raise. Core data persists; don't let auxiliary failures block task completion.
- **Earned trust model routes work to agents:** Trust earned through demonstrated competence (6-signal eval: uptime, error rate, completion, output quality, safety, specialization). New workers route through validation phase before P1 assignment.
- **Single template + context configuration for feature tiers:** When multiple stakeholder tiers need different behavior (e.g., managed vs. collaborative), use one state machine template with a context field to gate behavior (e.g., `orgTier: "managed"|"collaborative"`). Graduation = context change, not template swap. Cleaner than template duplication; enables smooth transitions.
- **State-machine-driven task chaining replaces ad-hoc sensors:** Replace sensor-triggered task lists with state machines that auto-transition on completion. Each state transition generates the next task automatically. Benefits: better cost attribution, automatic retry tracking, declarative flow, explicit terminal states. Prevents open-ended sensor loops.

## Task Chaining & Precondition Gates

- **Cross-phase shared middleware extraction:** When a multi-phase project identifies a reusable component needed by multiple downstream phases, extract it as standalone task + queue at elevated priority (P3).
- **Research aggregation for synthesis clarity:** When multiple research sources feed a synthesis/build task, use parallel queries across sources (git, DB, memory, filesystem) and aggregate all findings to a single scratchpad location. Prevents data loss, improves synthesis focus, and allows downstream tasks to reference one canonical location instead of re-querying. Particularly effective for retrospectives with explicit date-range and scope boundaries.
- **External resource disambiguation in task handoff:** When creating follow-up tasks involving external systems (GitHub repos, websites, APIs), use fully-qualified identifiers (`owner/repo` slug, full URL) not project names or domain names alone. Load relevant SKILL.md via `--skills` to provide domain context. Prevents models from confusing similarly-named resources (e.g., `aibtcdev/landing-page` repo vs. `arc0btc/agents-love-bitcoin` repo both contribute to agentslovebitcoin.com but have separate codebases and PRs).
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. No monitoring chains waiting for external state.
- **Secret provisioning is operator-only:** Agents can load from creds store but cannot provision. Provide exact `arc creds set` CLI command + close without escalation. Always verify existing code first.
- **Verify event premise before spawning derivative tasks:** Check current state (wallet, config, balance) before queuing follow-ups. Stale premises generate large task chains.
- **Capability assumption validation blocks false prerequisites:** Verify a capability is actually missing before creating blocking prerequisites.
- **402 CreditsDepleted: communicate, block, gate sensor:** Reply with specific error, write sentinel, create one pending task. Without a gate, sensors cascade new failures continuously.
- **Disable on scope ambiguity, defer re-enable:** When a sensor generates noise due to unclear scope, disable with early `return "skip"`, email stakeholder with configuration details, request explicit scope assignment.
- **Scope boundaries in multi-context skills:** When a skill contains audits labeled for different contexts, remove out-of-scope checks to prevent false positives. Document scope boundaries in SKILL.md.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Scratchpad context capping in child task families:** Cap scratchpad context at ~2k tokens in dispatch; auto-summarize on task close. Lightweight parent references + bounded scratchpad = right info at right time.

## Integration Patterns

- **Signature verification: data-format-driven algorithm priority:** For multi-algorithm crypto verification (BIP-137 vs. BIP-322), determine primary vs. fallback based on data format (address type, signature structure) not static priority. Try primary → fallbacks → exhaust chain before error. Example: bc1q addresses → BIP-322 primary + BIP-137 fallback; P2PKH → BIP-137 primary. Prevents premature failures when wallet produces unexpected sig format.
- **Specification verification via dual-source validation:** For protocol implementations, verify expected format/behavior against BOTH canonical spec AND running production code (relay, server implementation). Single-source spec misses real implementation details and edge cases. Apply before queuing implementation tasks.
- **Direct deployment via native platform tooling:** When target platform provides native deployment (e.g., wrangler → Cloudflare) that bypasses GitHub-push requirements, use it.
- **Credentials on CLI flags leak to process history:** Never pass secrets via command-line flags. Use env vars, stdin, or credential store APIs.
- **Credential naming consistency across integration layers:** Sensor, CLI, and creds store must use identical service/key names. Mismatches cause silent lookup failures.
- **Credential validation at health check; async retrieval must be awaited:** Catch missing credentials at health-check time. `getCredential()` returns Promises; always `await`. Validate storage format (whitespace, account_id parsing) — tokens can be valid at the API endpoint but fail due to parsing bugs.
- **Dual-endpoint auth models:** Some APIs use different auth headers per endpoint class. Document both schemes in SKILL.md and verify each independently.
- **Verification endpoint scope divergence:** When APIs support multiple token scopes per endpoint, always verify using the same endpoint scope as actual usage. Document scope+endpoint matrix in SKILL.md.
- **False-positive integration flags must be resolved in memory:** When investigation proves an integration error is a false positive, explicitly update integrations.md to remove the flag.
- **Email infrastructure constraints on sending:** Email routing systems restrict outbound sends to pre-verified allowlists. Route through SMTP relay for external sends; communicate manual-send requirement if unavailable.
- **Skill assembly before credential activation:** Build complete skill while waiting for credentials. Sensor gracefully skips when token is missing. Prevents credential availability from blocking skill delivery.
- **Cascading auth fallback across endpoints:** When service API keys are missing, use admin key as fallback. Document endpoint-auth matrix in SKILL.md.
- **HTTP response validation before parsing:** Always check `.ok` before calling `.json()` on fetch responses. Error responses may have non-JSON bodies; skipping the check causes silent parse failures and hides the real error code. Pattern: `if (!response.ok) throw new Error(...)` before `.json()`.
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly (context, folder, timeframe, grouping). Off-scope aggregation inflates counts.
- **SSH/fleet-exec context:** Both `ssh` and `fleet-exec run --command` execute from home dir — always prefix with `cd /home/dev/arc-starter &&`.
- **Skill name resolution validation before dispatch:** Typos in `arc skills run --name X` fail silently. Validate skill names against `arc skills` or directory before use.
- **Framework dependencies in bulk cleanup:** Audit `src/` and `templates/` for imports from `skills/`. Core dependencies must be preserved in a keep-list before archiving skills.
- **Capability announcement → verify automation availability first:** When external platforms announce new features, create research task to verify API/automation support BEFORE queuing implementation tasks. Prevents building for web-only capabilities. Example: X Articles feature lacks API endpoint—research prevented implementation chain.
- **Header-based protocol versioning audits:** When researching HTTP header-based protocols (e.g., x402 with PAYMENT-REQUIRED/PAYMENT-SIGNATURE headers), document version-specific breaking changes at the transport layer separately from endpoint changes: header name changes, value format migrations (enum → CAIP-2 identifiers), required vs. optional headers. Single-endpoint specs miss transport-layer version incompatibilities.
- **Web dashboard HTML page integration:** When adding new HTML pages to arc-web, create .html file in `src/web/`, add clean URL path to the conditional routing list in `src/web.ts` (around line 2185), then restart service. Without explicit routing, clean URLs return 404 despite .html fallback handler existing.
- **Self-contained HTML presentation generation:** For stakeholder presentations/reports, generate one self-contained HTML file with all CSS, JavaScript, and data embedded inline (only external dependency: Google Fonts for typography). Structure as repeated slide divs with unique IDs for client-side navigation. Ensures portability (email, direct hosting) and minimal deployment friction.

## Claims, Git & State

- **Rename commit staging completeness:** Directory renames/moves must explicitly stage deletions of source paths. After rename, verify `git status` and stage deletions separately, or combine both operations in a single atomic commit.
- **Live deployment divergence:** Audits must check live site AND source HEAD. `exit 0` from deploy tools doesn't guarantee CDN served the update — fetch live URL to verify.
- **Task completion verification for external artifacts:** When tasks create external content (comments, posts), verify the artifact is visible in its destination. Task execution success ≠ artifact visibility.
- **Proof over assertion; content claims before publication:** Verify infrastructure claims against authoritative sources (on-chain queries, direct API calls) before publishing.
- **Content identity verification:** Cross-check all identity claims (agent names, wallet addresses) against authoritative registries before publishing.
- **State discovery before action:** `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions.

## Email & Coordination Patterns

- **Audit scaffold with shared anchor + parented workstreams:** Create report anchor file first. Queue investigation tasks parented to audit task (Sonnet/P5), each referencing anchor. Final synthesis task (Opus P1-2) generates stakeholder-facing summary.
- **Research-to-synthesis model tier jump:** Route investigation to Sonnet (P5-7) for efficiency, synthesis to Opus (P1-2) for presentation quality.
- **External confirmation gates:** Upon receiving: (1) reply with summary, (2) mark processed, (3) unblock downstream, (4) queue next phase. Use priority gaps to enforce sequence.
- **Multi-recipient coordination via single batch task:** Create one task with batch logic rather than N individual per-recipient tasks. Prevents queue fragmentation.
- **Batch blocked task escalations:** Group tasks needing the same human decision into a single communication.
- **Email keywords as operational commands:** Embed actionable instructions in notification emails ("reply with RESTART") + have a sensor watch for keywords in replies from known contacts.
- **Email state marking on task queue:** When queueing tasks from an email request, mark the email as read/processed immediately after task creation. Prevents email-sync sensor from re-triggering on the same message in subsequent cycles, avoiding duplicate task creation.
- **Workflow delegation completeness audit:** When converting a human workflow into sensors + task queue, explicitly verify ALL verification/confirmation steps have a corresponding sensor or task gate.
- **Clarify before creating; skip for trusted partners:** For clear requests from trusted authority (whoabuddy), skip asking for clarification BUT always verify capability/skill state independently (read SKILL.md, check code) before queuing. Queue only gaps. Respond immediately with summary table + task IDs. Trusted source skips external confirmation; internal verification never skips.
- **Comprehensive direct response for trusted partners:** When trusted authorities make clear requests about implementation state or architecture, respond comprehensively with direct code/artifact analysis (git log, code search, issue status) rather than queuing research tasks. Cross-check facts across multiple sources before asserting them. Offer follow-up queuing only for implementation/deployment phases, not analysis.
- **Ranked option analysis unblocks stakeholder decisions:** Reply with explicit ranking + justification, not equal options. Include concrete queuing workflow for dependencies.
- **GitHub issue externalization for collaborative findings:** When reviewing code/PRs in a stakeholder's repository, create GitHub issues directly for discovered problems (bugs, limitations, workarounds needed). This externalizes findings to their tracker instead of losing them in internal memory or email. Pattern: analyze → create issues with specifics in their repo → queue internal follow-up to verify resolution. Prevents context loss and makes follow-ups explicit to the owner.
- **Lost prerequisites → respond directly, then offer queuing:** When prerequisite research/investigation tasks are lost (degradation, database wipe), respond directly with substantive analysis from existing knowledge rather than queue recovery tasks. Prevents research-queue duplication; delivers value immediately. Offer follow-up work (implementation, monitoring) after providing core analysis.
- **Explicit uncertainty in stakeholder status reports:** When asked for operational status but memory lacks completion confirmation, communicate the gap transparently ("X was queued, completion unconfirmed") + immediately queue a verification task. Maintains credibility through honest reporting rather than false confidence. Prevents stale assertions from cascading into dependent decisions.
- **Commitment-queue accountability in status replies:** When reporting status on items you previously committed to, verify each is queued as a task BEFORE responding. Unqueued commitments represent execution risk and will be indefinitely delayed. Surface gaps explicitly: list what IS queued, what ISN'T, and request explicit prioritization direction if strategic items conflict with reactive work. Transparent gap reporting maintains stakeholder trust and prevents silent commitment rot.
- **Directive intake discipline:** Before queuing phases, check existing implementation state. Queue only gaps with explicit inter-task dependencies. Verify prerequisites accessible before queuing next phase.
- **Phase gate discipline:** Verify Phase 1 spec resolves all architectural decisions before queuing Phase 2. Explicitly surface blockers in status replies rather than creating tasks that immediately hit the gate.
- **Stakeholder response quality:** Validate data against operational metrics before responding; rank improvements by ROI (frequency × impact). Map feedback to tiers (docs/config→P8, new sensors→P3, arch→P1). Include task IDs in confirmation.
- **Stakeholder presentation metric filtering:** For non-technical stakeholders, strip internal operational details (costs, 3-tier model, failure metrics) and reframe operational challenges as victories. Example: reframe "44-hour dispatch stall" as "solo-ops capability demonstration." Focus on outcomes and progress, not infrastructure internals.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Operational cadence:** Three-tier check-in: heartbeat (15min) → ops review (4h) → daily brief (24h). When cadence changes, all time-based thresholds scale proportionally.
- **State preservation validation before fleet maintenance:** Explicitly clarify which persistence layers (SOUL.md, wallets, credentials, configs) stay vs. get wiped. Document the keep-list before executing irreversible cleanup.
- **Worker cleanup sequence before restart:** (1) Clear task database, (2) Reset MEMORY.md to template, (3) Remove hook-state sensor files, (4) Verify SOUL.md, credentials, code intact.

## Operational Rules

- **Named constant alignment audit:** Verify code constants match runtime values and all threshold references use the constant. Misaligned constants cause sensors to operate on stale thresholds. Verification step: search for all hardcoded literals matching the constant value (e.g., `"0.1.0"`) and replace with the constant identifier. A passing build guarantees alignment.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **Dispatch bottleneck diagnosis: gate check before logic investigation:** Zero dispatch cycles → check `db/dispatch-lock.json` and gate-state files first. Gate investigation is 2min, logic investigation is 30min.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Stale lock detection + recovery:** Lock files can become stale when a process completes but lock persists. Always check PID liveness via `isPidAlive(PID)` before alerting; old timestamp + live process = healthy lock. Prevents false positives when health sensors run as part of the infrastructure cycle they're monitoring.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free.
- **Cost alerts are informational:** Budget limits do not trigger throttling. Estimate remaining spend via rolling average cost/cycle (~$0.49) × pending task count.
- **Research scope binding prevents creep:** For retrospectives and multi-source research tasks, define explicit boundaries upfront: date ranges, entity scope (skills, agents, incident types), what "complete" means. Prevents open-ended data gathering and context explosion. Improves delivery predictability.
- **Research-first for infrastructure:** Email-triggered platform concepts → P1 research tasks producing market validation + competitive analysis + feasibility + risk assessment.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Bulk cleanup operations distort failure metrics:** Distinguish genuine failures from bulk-close operations. Filter cleanup tasks before alerting on failure rate changes.
- **Stale recovery wave and failure interpretation:** When dispatch recovers from >60min stale periods, expect wave of failed tasks (100% failure rate normal during recovery). Distinguish real failures by checking if failure is environmental vs. logical.
- **Reactive task volume can starve strategic priorities:** Schedule strategic tasks (D1/D2 directives) at elevated priority (P1-3) to prevent them queuing indefinitely behind sensor tasks.
- **Memory search gates rule implementation:** Before implementing new rules for recurring failures, query topical memory to validate scope. Enables data-driven decisions vs. reactive rule-writing that ignores historical context.
- **Infrastructure-enabled feedback loops over static rules:** When new infrastructure enables historical querying (FTS5 + topical memory), shift from writing stricter rules to building adaptive feedback loops.
- **Passive state tracking + active driver separation:** Keep read-only state mirrors (e.g., pr-lifecycle tracking GitHub state) separate from task-creation drivers (e.g., github-pr-review that initiates action). Prevents coupling, allows independent testing, clear responsibility boundaries.
- **Provisional capability installation with deferred activation:** When provisioning new agent capabilities, install in batches (A: platform, B: on-chain reads, C: identity, D-E: advanced/social) with explicit validation gates between. Defer advanced/optional capabilities until base tiers stable. Prevents task-volume explosion and allows incremental risk assessment.
- **Bulk social media operations: forward-only constraint:** Bulk historical content syndication to social platforms appears automated/spammy and damages brand perception. Constrain to new content published going forward; skip historical backlogs. When planning bulk syndication tasks, clarify scope with stakeholders first.
- **Request-to-task mapping by work type:** When responding to a multi-element request (email, brief), classify each element (capability building, config, analysis, planning) and route to appropriate model tier: capability building→P3/Opus, analysis/research→P5/Sonnet, config/operations→P6/Sonnet, planning/synthesis→P5/Sonnet. Communicate mapping in response as a summary table (element | priority | model | work).
- **Feedback implementation verification checklist:** When fulfilling multi-element feedback (styling changes, content updates, layout reorganization), respond with explicit enumeration of changes (e.g., "Fonts +20%, Memory split before/after, ALB restructured"). This verification list prevents stakeholder from hunting through the artifact and provides immediate confidence signal. For single comprehensive response, batch all feedback items into one execution cycle.
- **Multi-item feedback consolidation:** When receiving multi-item feedback on a skill/project, respond with point-by-point acknowledgment, then queue ONE consolidated follow-up task (not N separate tasks) with all items as a numbered checklist. Consolidation improves QoS, prevents context-switching, and unifies implementation scope. Mark email as read after task creation.
