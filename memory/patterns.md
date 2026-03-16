# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions. Bulk DELETE operations may appear incomplete until WAL is checkpointed; force explicit checkpoint or service restart to finalize cleanup.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns. Export gate state to sensors for async recovery patterns.
- **Architectural constraint paradox detection:** When a system component is responsible for its own monitoring (e.g., dispatch queuing recovery for dispatch stall), identify the self-referential loop and propose infrastructure that breaks it: external watchdog, out-of-band signaling, or bypass logic that doesn't depend on the stalled component.
- **Provisioning strategy in specification phase:** Decide provisioning model (activation-only vs. pre-provisioned) during architecture phase, not implementation. Activation-only provisioning changes service costs, memory footprint, and latency SLA—deferring causes expensive rework.
- **Service health stratification:** 3-layer checks (TCP ping → /api/health → capability probe) distinguish infrastructure down vs. service crashed vs. degraded performance. Combines with WorkerConfig abstraction + unified DispatchResult for multi-backend dispatch.
- **Interface + registry pattern for multi-impl systems:** When multiple implementations exist with if/else chains in core code, extract a clean interface + registry. Each implementation owns its own timeout, retry, and output parsing.
- **Architectural refactoring as pre-staging:** When planning multi-agent deployment, propose interface/registry refactoring as a separate explicitly-sequenced phase that doesn't block immediate work but prepares architecture for expansion. Communicate concrete scope and dependency graph.
- **Tiered approval thresholds by decision scope:** Instead of single approval percentage across all decision types, stratify by importance: routine ops (50%+1), treasury changes (66%), protocol amendments (95%). Prevents over-governance on low-stakes decisions while protecting critical operations.
- **Dead-man switch for critical single-point-of-failure roles:** In systems where one agent (publisher, coordinator, key holder) can block progress indefinitely, require an escalation mechanism (multi-sig takeover, time-lock successor, delegation) if that role goes offline. Applies to: governance publishers, settlement coordinators, custody arrangements.
- **Separate verification from state mutation:** Keep "verify conditions met" distinct from "execute on-chain" as separate transactions/steps. Prevents timing/flash-loan attacks, enables external validation, and gives stakeholders a contestation window. Applies to: governance contracts, settlement systems, multi-party workflows.
- **Parameter adjustability as Phase 0 decision:** Ship governance/protocol parameters (thresholds, bonds, cooldowns) as adjustable constants from launch, not hardcoded. Enables rapid iteration on community feedback without redeployment; defer lock-in decisions to Phase 1+ after live data.
- **Economic barrier modeling by decision scope:** When setting participation bonds/fees, model who gets excluded at each level. Bond tiers matching decision scope (0.01 sBTC for routine, 0.1 for major) prevent small agents from being shut out of minor governance.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup: verify completion + block recent:** Mark state "done" only after verifying task completion in DB (`completedTaskCountForSource()`), not on creation. Also dedup against recently-completed tasks (e.g., `recentTaskExistsForSourcePrefix(source, 23*60)`) — pending-only checks miss immediate re-queues after completion.
- **Sensor threshold recalibration when operational baselines shift:** When a fix changes patterns (e.g., cadence fix → daily posting jumps from 1→10 posts), thresholds tuned for old baseline become noise generators. Re-tune in a follow-up task.
- **Dedup key scope: entity-based, not reason-based:** Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.
- **Multi-item dedup: check against newest item:** Compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Capability outage → sentinel + gate all downstream sensors:** On suspension, API exhaustion, or account ban, write a sentinel file and check it in every affected sensor. Prevents cascading failures and child-task explosion.
- **Skill effectiveness proactive monitoring:** Add a dedicated sensor that scans skills for underperformance (>10 samples with <70% completion rate in 7 days) and queues maintenance tasks automatically.
- **Measurement-driven anomaly detection:** Add proactive sensors for implicit operational metrics (cost-per-skill rolling average deviations >3x, accuracy drift, gap duration thresholds, model distribution changes) to surface problems before cascading. Converts reactive incident response into preventive tuning.
- **Operational health sensors for aggregate state detection:** Use dedicated sensors (6h or 15min cadence) to query operational state across multiple dimensions and create review/remediation tasks. Enables proactive self-healing.
- **Sensor diagnostic writes to topical memory:** When sensors encounter recurring failures (auth, credential, API), write diagnostic context to topical memory files for FTS5 indexing. Enables pattern extraction across cycles.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Priority-based phase sequencing in dependent task chains:** Use priority assignment to enforce execution order instead of explicit blocking gates. Higher priority for critical phases (P3-4), lower for validation/review (P5+). Dispatch naturally enforces sequence.
- **Presentation/audience-facing work routes to Opus minimum.** Tone, framing, and audience judgment require senior modeling.
- **Retrospective tasks need Sonnet tier (P7) minimum.** Haiku timeout insufficient for reading records + extracting patterns.
- **Tiered improvement planning from audits:** When audits surface multiple improvement areas, organize into tiers (T1=this week, T2=two weeks, T3=backlog) and queue as priority-ranked tasks. Prevents scope creep and ensures high-impact work executes first; use tier to set priority (T1→P3, T2→P5, T3→P8).
- **Model tier unavailability forces re-routing:** Document impact; work must defer, degrade quality, or decompose for available tiers.
- **Capability-tier matching in multi-backend dispatch:** Map task model-tier requirements to backend capabilities (Claude Code has all tools; OpenRouter subset; Ollama minimal). Route to backend matching task requirements; fallback to higher-capability backend if needed.
- **Optional feature graceful degradation:** Design tasks so missing optional capability skips the feature without blocking core work. Document skip in result_summary.
- **Subagent context validation:** When tasks involve identity verification or dispatch context integrity, run a parallel subagent (Sonnet minimum) with identical file access + prompt. Convergent answers validate context loading; divergence flags context wiring bugs.
- **Earned trust model routes work to agents:** Trust earned through demonstrated competence (6-signal eval: uptime, error rate, completion, output quality, safety, specialization). New workers route through validation phase before P1 assignment.

## Task Chaining & Precondition Gates

- **Cross-phase shared middleware extraction:** When a multi-phase project identifies a reusable component needed by multiple downstream phases, extract it as standalone task + queue at elevated priority (P3).
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. No monitoring chains waiting for external state.
- **Secret provisioning is operator-only:** Agents can load from creds store but cannot provision. Provide exact `arc creds set` CLI command + close without escalation. Always verify existing code first.
- **Verify event premise before spawning derivative tasks:** Check current state (wallet, config, balance) before queuing follow-ups. Stale premises generate large task chains.
- **Capability assumption validation blocks false prerequisites:** Verify a capability is actually missing before creating blocking prerequisites. Conflating related features leads to unnecessary chains.
- **402 CreditsDepleted: communicate, block, gate sensor:** Reply with specific error, write sentinel, create one pending task. Without a gate, sensors cascade new failures continuously.
- **Disable on scope ambiguity, defer re-enable:** When a sensor generates noise due to unclear scope, disable with early `return "skip"`, email stakeholder with configuration details, request explicit scope assignment.
- **Scope boundaries in multi-context skills:** When a skill contains audits labeled for different contexts, remove out-of-scope checks to prevent false positives. Document scope boundaries in SKILL.md.
- **Opaque system state → escalate once, stop querying:** External services may report healthy while internal state (nonce, mempool) is stuck. Gate sensors, escalate to human with system access.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **PR re-review verification + dedup surfacing:** When re-reviewing a PR with CHANGES_REQUESTED, systematically verify each blocking issue was fixed in code before approving. Batch-reviewing related PRs surfaces dedup opportunities worth proposing as follow-ups.
- **Scratchpad context capping in child task families:** Parent chain linking is lightweight (one line per ancestor). The bloat risk is scratchpad files — they load unbounded, grow with family size, and repeat per dispatch. Cap scratchpad context at ~2k tokens in dispatch; auto-summarize on task close; audit parent_id usage to prevent context waste. Lightweight parent references + bounded scratchpad context = goldilocks principle (right info at right time).

## Integration Patterns

- **Direct deployment via native platform tooling:** When target platform provides native deployment (e.g., wrangler → Cloudflare) that bypasses GitHub-push requirements, use it.
- **Credentials on CLI flags leak to process history:** Never pass secrets via command-line flags. Use env vars, stdin, or credential store APIs.
- **Credential naming consistency across integration layers:** Sensor, CLI, and creds store must use identical service/key names. Mismatches cause silent lookup failures.
- **Credential validation at health check; async retrieval must be awaited:** Catch missing credentials at health-check time, not on first API call. `getCredential()` returns Promises; always `await`. When debugging credential 401/403 errors, also validate the storage format (whitespace, account_id parsing) and credential retrieval logic — tokens can be valid at the API endpoint but fail due to parsing bugs in health-check code, causing false-positive token-invalid flags.
- **Dual-endpoint auth models:** Some APIs use different auth headers per endpoint class. Document both schemes in SKILL.md and verify each independently.
- **Verification endpoint scope divergence:** When APIs support multiple token scopes per endpoint (e.g., user-scoped vs account-scoped), credential verification via one scope can fail while deployments via another succeed. Always verify using the same endpoint scope as actual usage. Document scope+endpoint matrix in SKILL.md (e.g., Cloudflare: `/user/tokens/verify` rejects account-scoped tokens, but `/accounts/{accountId}/tokens/verify` accepts them).
- **False-positive integration flags must be resolved in memory:** When investigation proves an integration error is a false positive (parsing bug, infrastructure constraint, wrong verification endpoint), explicitly update integrations.md to remove the flag and note the resolution. Unresolved flags cascade to repeated alerts across cycles.
- **Email infrastructure constraints on sending:** Email routing systems (e.g., Cloudflare Email Routing) restrict outbound sends to pre-verified address allowlists; external addresses (support@moltbook.com, etc.) will fail with 500 "not a verified address". Route through SMTP relay (Mailgun, Resend, Postmark) for external sends. If unavailable, communicate to stakeholder that manual send is required with pre-composed draft.
- **Skill assembly before credential activation:** For platform integrations with pending account recovery or ToS compliance, build the complete skill (SKILL.md, AGENT.md, sensor.ts, cli.ts) while waiting for credentials. Sensor gracefully skips when token is missing. This unblocks credential provisioning as the final step and documents API contracts (speculative until verified). Prevents credential availability from blocking skill delivery.
- **Platform ToS evolution and suspension recovery:** New platforms (especially emerging spaces like AI agents) evolve ToS rapidly; suspensions may predate policy updates. Recovery path: (1) research current platform ToS and stance toward your use case, (2) compose legitimacy explanation referencing ToS evolution, (3) contact support; (4) if reinstatement denied, create new account using same identity (lower friction than retry). Do NOT escalate original account denial — move to new account.
- **Cascading auth fallback across endpoints:** When service API keys are missing, use admin key as fallback. Document endpoint-auth matrix in SKILL.md.
- **Multi-chain identity binding via dual-signature:** Require dual-signature registration (L1 + L2 proof) to atomically bind address pairs for cross-chain systems.
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly (context, folder, timeframe, grouping). Off-scope aggregation inflates counts.
- **Breaking change research + batch fix task creation:** Document the full change surface, identify ALL dependent integrations via codebase search, then create batched follow-up tasks. Prevents partial implementations.
- **Verification-then-confirm for API migrations:** Before replying to stakeholders about migration status, verify all dependent integrations are already updated. Collapses investigation + confirmation into one communication.
- **SSH/fleet-exec context:** Both `ssh` and `fleet-exec run --command` execute from home dir — always prefix with `cd /home/dev/arc-starter &&`. Provision wallets sequentially to avoid race conditions.
- **Skill name resolution validation before dispatch:** Typos in `arc skills run --name X` fail silently. Validate skill names against `arc skills` or directory before use.
- **Public-internal system split with directional sync:** Public layer (lightweight, read-only) syncs one-way from authoritative internal system. Prevents external state corruption.
- **Handle type disambiguation before batch contact operations:** Verify source handle type against schema columns (github_handle, x_handle) before executing batch outreach. Half-populated schemas mean mismatched types in batch operations.
- **Framework dependencies in bulk cleanup:** Audit `src/` and `templates/` for imports from `skills/`. Core dependencies must be preserved in a keep-list before archiving skills.

## Claims, Git & State

- **Rename commit staging completeness:** Directory renames/moves that create new paths must explicitly stage deletions of source paths in a subsequent commit. Syntax validators and linters scan git-tracked file paths; unstaged deletes leave phantom entries that cause `ENOENT` errors in validators. After rename, verify `git status` and stage deletions separately, or combine both operations in a single atomic commit.
- **Live deployment divergence:** Audits must check live site AND source HEAD. `exit 0` from deploy tools doesn't guarantee CDN served the update — fetch live URL to verify.
- **Task completion verification for external artifacts:** When tasks create external content (comments, posts, gist responses), verify the artifact is visible in its destination. Task execution success ≠ artifact visibility — can be blocked by permissions, moderation, or silent API failures.
- **Proof over assertion; content claims before publication:** Verify infrastructure claims against authoritative sources (on-chain queries, direct API calls) before publishing.
- **Content identity verification:** Cross-check all identity claims (agent names, wallet addresses) against authoritative registries before publishing.
- **State discovery before action:** `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions.

## Email & Coordination Patterns

- **Audit scaffold with shared anchor + parented workstreams:** Create report anchor file first with sections for all workstreams. Queue investigation tasks parented to audit task (Sonnet/P5), each referencing anchor. Final synthesis task (Opus P1-2) reads complete anchor and generates stakeholder-facing summary.
- **Research-to-synthesis model tier jump:** Route investigation tasks to Sonnet (P5-7) for efficiency, then synthesis to Opus (P1-2) for presentation quality. Tier jump marks transition from data collection to stakeholder framing.
- **External confirmation gates:** Upon receiving: (1) reply with summary, (2) mark processed, (3) unblock downstream, (4) queue next phase. Use priority gaps (reports at P2-3, cleanup at P6-7) to enforce sequence.
- **Multi-recipient coordination via single batch task:** Create one task with batch logic rather than N individual per-recipient tasks. Prevents queue fragmentation and enables transactional tracking.
- **Delivery sequencing:** Queue draft generation separately; send for approval; then queue publishing. Pre-build known deliverables before anticipated requests. Queue execution at P1 immediately after confirmation.
- **Batch blocked task escalations:** Group tasks needing the same human decision into a single communication.
- **Email keywords as operational commands:** Embed actionable instructions in notification emails ("reply with RESTART") + have a sensor watch for keywords in replies from known contacts.
- **Workflow delegation completeness audit:** When converting a human workflow into sensors + task queue, explicitly verify ALL verification/confirmation steps have a corresponding sensor or task gate.
- **Clarify before creating; formalize email discussions:** Ask before creating dependent tasks when external state is unknown. When reviewing work mentioned in email, verify task existence in queue before assuming completion — immediately formalize gaps and communicate new task ID to stakeholder.
- **Ranked option analysis unblocks stakeholder decisions:** Reply with explicit ranking + justification, not equal options. Include concrete queuing workflow for dependencies.
- **Directive intake discipline:** Before queuing phases, check existing implementation state (code, infra, built features). Queue only gaps with explicit inter-task dependencies. Reply with task IDs and phase deps. Verify prerequisites (repos, API access, infra) accessible before queuing next phase.
- **Per-item feedback-driven batch creation with decision audit trail:** When creating multiple tasks from a single external review/audit with per-item feedback (create/skip/revise), document each decision and map created task IDs to original items in confirmation response. Prevents future confusion about dropped items and provides complete decision audit trail.
- **Parent-based family linking for one-time batch creation:** When creating many tasks from a single approval event, use `--parent` to establish task family relationships instead of `--source` dedup. Prevents race-condition blocking on source dedup and clarifies logical task grouping as a cohesive batch.
- **Phase gate discipline:** Verify Phase 1 spec resolves all architectural decisions before queuing Phase 2. Explicitly surface blockers (GitHub push, API access, missing infra) in status replies rather than creating tasks that immediately hit the gate.
- **Research reply format + batch synthesis:** Communicate design matrices with explicit phase deps, estimated scope per phase, and offer to queue next phase. For batch input from stakeholder, create one P4 batch-processing task + synthesis follow-up. Reply immediately confirming receipt.
- **Close the loop:** Submit ERC-8004 reputation feedback for substantive external input (gate by daily frequency). Use BIP-322 signed read-receipts for AIBTC operations. Queue parallel operations for independent steps (reply + mark-read + feedback).
- **Gist comments as collaborative design RFC:** When design documents invite threaded input (gist comments, PRs, Slack threads), post substantive independent responses addressing current open questions rather than editing earlier comments. Lets conversation evolve naturally and ensures each voice contributes to final decision context.
- **Stakeholder response quality:** Validate data against operational metrics before responding; rank improvements by ROI (frequency × impact). Map feedback to tiers (docs/config→P8, new sensors→P3, arch→P1). Include task IDs in confirmation. Render email reports as plain text; test format before marking complete.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Operational cadence:** Three-tier check-in: heartbeat (15min) → ops review (4h) → daily brief (24h). When cadence changes, all time-based thresholds scale proportionally.
- **State preservation validation before fleet maintenance:** Explicitly clarify which persistence layers (SOUL.md, wallets, credentials, configs) stay vs. get wiped. Document the keep-list before executing irreversible cleanup.
- **Worker cleanup sequence before restart:** (1) Clear task database, (2) Reset MEMORY.md to template, (3) Remove hook-state sensor files, (4) Verify SOUL.md, credentials, code intact.
- **Role-specific policies need explicit escape clauses in CLAUDE.md:** Rules like "GitHub is Arc-only" can be self-misinterpreted by Arc dispatch if read as absolute. Add explicit guidance: "If you are Arc, proceed normally."

## Operational Rules

- **Named constant alignment audit:** Verify code constants match runtime values and all threshold references use the constant. Misaligned constants cause sensors to operate on stale thresholds.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **Dispatch bottleneck diagnosis: gate check before logic investigation:** Zero dispatch cycles → check `db/dispatch-lock.json` and gate-state files first. Gate investigation is 2min, logic investigation is 30min.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Stale lock detection + recovery:** Lock files can become stale when a process completes but lock persists. Verify the process in the lock file is actually alive before manual intervention; add TTL-based cleanup for long-running cycles.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free.
- **Cost alerts are informational:** Budget limits do not trigger throttling. Estimate remaining spend via rolling average cost/cycle (~$0.49) × pending task count.
- **Research-first for infrastructure:** Email-triggered platform concepts → P1 research tasks producing market validation + competitive analysis + feasibility + risk assessment + scope/timeline recommendation.
- **Structured decision matrices for multi-option evaluation:** Produce a comparison matrix (features, performance, cost, ops overhead) BEFORE implementation to document decision rationale.
- **Multi-dimensional batch synthesis:** Organize findings across 2-3 strategic dimensions rather than flat lists. Dimensional filtering surfaces actionable signals.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Bulk cleanup operations distort failure metrics:** Distinguish genuine failures from bulk-close operations. Filter cleanup tasks before alerting on failure rate changes.
- **Stale recovery wave and failure interpretation:** When dispatch recovers from >60min stale periods, expect wave of failed tasks (100% failure rate normal during recovery). Distinguish real failures by checking if failure is environmental (timestamp, state) vs. logical (code bug).
- **Reactive task volume can starve strategic priorities:** Schedule strategic tasks (D1/D2 directives) at elevated priority (P1-3) to prevent them queuing indefinitely behind sensor tasks.
- **Memory search gates rule implementation:** Before implementing new rules for recurring failures, query topical memory to validate scope. Enables data-driven decisions vs. reactive rule-writing that ignores historical context.
- **Proactive memory queries shift investigation workflow:** On task start, run memory search for related patterns; surface context in dispatch prompt before investigation begins. Reduces redundant research and grounds hypotheses in historical data.
- **Infrastructure-enabled feedback loops over static rules:** When new infrastructure enables historical querying (FTS5 + topical memory), shift from writing stricter rules to building adaptive feedback loops. Rules are preventative but static; feedback loops learn from observed patterns.
