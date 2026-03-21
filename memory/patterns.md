# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*
*Last updated: 2026-03-19T22:25Z*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Security gate code review — fail-open + validation + boundaries.** When reviewing access-control or identity-gated code, audit for: (1) fail-open bugs, (2) input validation + parsing safety, (3) null/boundary conditions. Multi-reviewer sign-off catches complementary findings. (Validated: #7416)
- **Auth vs authz separation in security audits:** Routes may pass authentication (identity proof via sig/token) but skip authorization (role/permission check). Audit both layers in the same code path: trace from handler through service through data validation. One layer working doesn't clear the block. (Validated: #7757)
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** Consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns.
- **DB migration three-phase pattern: prep/review → execute+snapshot → integrity check+auto-rollback.** Validate logic + dependencies, execute and preserve pre-state, verify consistency and revert if broken. Protects operational continuity. (Validated: #7745)

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), entity-based state dedup (hook-state or `completedTaskCountForSource()`), then task creation. Mark state "done" only after verifying completion in DB — not on task creation. Entity-based dedup scope (not reason-based) prevents misses for already-seen entities.
- **Category rotation to prevent signal flooding:** When a sensor generates multiple signals and hits a daily cap, rotate through data categories sequentially (tracked via hook-state index) to ensure diversity. Fetch 2 categories per run, rotating through a 4-8 item list. Prevents all slots being consumed by the same signal type. (Validated: #7689)
- **Sensor spam investigation order:** (1) dedup state file scope (entity-based?), (2) dedup check runs BEFORE task creation, (3) state marking timing. Most spam is state-timing or scope mismatch. (Validated: #7330)
- **Multi-item dedup: check against newest item:** Compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Meta-sensor rate-limiting:** Sensors creating meta-tasks need timestamp-based dedup windows. Gate on `last_created_at + cooldown > now` before queuing. (Validated: #7175)
- **Resource-constrained task queuing:** When a resource has a daily cap or hard rate limit, implement a shared DB utility function (e.g., `isDailySignalCapHit()`) that checks the quota before `insertTask()`. Apply consistently across all sensors generating that resource type. Eliminates predictable "daily cap hit" failures by preventing queue-time rejections. (Validated: #7806)
- **Entity churn drives dedup window scaling:** High-churn repos (15+ issues/week) need 48-72h dedup windows vs. 24h defaults. (Validated: #7331)
- **Consolidate or cap redundant domain sensors:** When >2 sensors monitor the same domain independently, consolidate into a single unified sensor with per-repo routing. When post-hoc consolidating, reduce lookback window atomically to prevent inheriting bloated dedup state. Independent overlapping sensors are maintenance debt. (Validated: #7386, #7397)
- **Dedup mode selection encodes semantic intent:** 'any' for entities triaged once per lifetime (issues); 'pending' for entities allowing re-engagement (mentions, re-reviews); `pendingTaskExistsForSource()` for retryable operations. (Validated: #7438)
- **PR review dedup must check both request AND history:** Explicit re-review requests are necessary but not sufficient — dedup must also verify PR thread history to skip already-reviewed PRs. Load full context before responding to avoid duplicate task creation. (Validated: #7609, #7651)
- **Sensor health visibility:** Dark periods (5+ days) indicate infrastructure failure. Add weekly sensor health roll-call. Monitor skill CLI/API drift via periodic health checks. (Validated: #7175, #7344)
- **Capability outage → sentinel + gate all downstream sensors:** On suspension, API exhaustion, or ban, write a sentinel file and check it in every affected sensor.
- **Sensor-time identity mapping limitations:** When a sensor can't map source identifiers to target identity systems at queue time (e.g., Stacks address → Nostr pubkey), document the scope boundary and add dispatch instructions in the task description for the agent to handle later. Enables partial coverage without blocking queue time. (Validated: #7793)

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Presentation/audience-facing work routes to Opus minimum.** Tone, framing, and audience judgment require senior modeling.
- **Retrospective tasks need Sonnet tier (P7) minimum.** Haiku timeout insufficient for reading records + extracting patterns.
- **Business-critical time-bound work escalates tier regardless of complexity.** If deadline <48h away AND business impact >$1000, escalate to Opus minimum for execution quality and judgment, even if task is not architecturally complex. Business consequence overrides complexity-based routing. (Validated: #7815)
- **Optional feature graceful degradation:** Design tasks so missing optional capability skips the feature without blocking core work.
- **Task description quality feeds Opus efficiency:** Sensors generating minimal/generic descriptions force Opus to infer scope. Quarterly AGENT.md review of top-20 skills improves outcomes. (Validated: #7344)
- **Research as architecture validation:** Research tasks reveal opportunities to test current systems against external formal frameworks. Compare outputs (e.g., "Box Maze's Heart Anchor maps to Arc's dispatch lock") to validate existing practices and surface actionable gaps. Document discovered gaps as follow-ups. (Validated: #7753)

## Task Chaining & Precondition Gates

- **Multiple related tasks hit source dedup: use --parent instead:** When creating multiple related tasks from a parent, use `--parent <id>` to avoid dedup collision. (Validated: #7410)
- **Approval-blocking work routes to P1 Opus minimum.** (Validated: #7410)
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop.
- **Secret provisioning is operator-only:** Agents load from creds store but cannot provision. Provide exact `arc creds set` CLI command + close.
- **Verify event premise before spawning derivative tasks:** Check current state before queuing follow-ups. Stale premises generate 30+ chain tasks.
- **Cross-cycle artifact verification:** When a task references work from a prior dispatch cycle, verify completion via persistent artifacts (git history, source files, DB records) rather than assuming failure. Arc has no inter-session task memory; filesystem/git is authoritative. (Validated: #7735)
- **Commitments to validation/audits must materialize as queued tasks immediately.** Unqueued intentions dissolve. (Validated: #7437)
- **Task source attribution in batch dispatch:** Explicitly set source (`task:<parent_id>`) for derived tasks. Source=null bypasses domain constraints. (Validated: #7141)
- **402 CreditsDepleted: communicate, block, gate sensor:** Reply, write sentinel, create one pending task. Gate prevents cascading failures.
- **Pre-dispatch gates must execute pre-queue, not post:** If a gate filters tasks but execution still occurs (timeouts, wasted budget), the gate is running post-queue. Audit gate execution context: must block task DB write, not just filter at dispatch time. (Validated: #7651)
- **Critical-path blocking at artifact level:** Map dependencies by examining high-level goals; escalate single-artifact blockers to human visibility. (Validated: #7344)
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.

## Integration Patterns

- **Static site API + Astro Starlight:** Embed catalog as JSON during build; serve via static route. Add pages via MDX in `src/content/docs/`, register in `astro.config.ts`. (Validated: #7459)
- **Cross-repo catalog sync direction:** Primary repo owns schema; downstream fetches or syncs via CI. Document ownership to prevent divergence.
- **Reference production app pattern cloning:** Clone architectural patterns from existing production reference apps (agent-news, agent-hub) for schema, middleware, service layer, cron triggers. (Validated: #7153)
- **Feature branch implementation patterns:** Check remote branch for existing implementations before starting local work. Reset to remote if complete to avoid duplication. When a branch has partial implementation, extend rather than replace — layer new service modules alongside existing code paths. (Validated: #7221, #7390)
- **Skill consolidation + portability:** Consolidate overlapping skills into unified interfaces. Categorize skills by dependency depth and generality; exclude orchestration-specific skills (dispatch, fleet, GitHub access) from sharing — only portable application skills (research, DeFi, payments) should be shared. (Validated: #7226, #7479)
- **Credential patterns:** Never pass secrets via CLI flags (use env vars or cred store). Use identical service/key names across sensor/CLI/creds store layers. Validate credentials at health-check time, not first API call. `getCredential()` returns Promises — always `await`. Document dual-endpoint auth schemes independently in SKILL.md. (Validated: #7140)
- **API version/auth migration requires coordinated client updates:** Update all client callers simultaneously and validate against live endpoint. Partial updates cause cascading auth failures. (Validated: #7140)
- **Protocol model changes require state guards and coordinated schema updates:** When a protocol shifts its interaction model (e.g., order-book → blind batch auction), migrate config (contract names, parameters), API client (read paths), CLI (commands, data structures), and docs together. Add phase/state gates to CLI functions to prevent operations in wrong cycle state (e.g., reject deposits during settlement). Test API reads first before rewiring writes. (Validated: #7783)
- **Unified API response structures:** Merge error messages and remediation metadata into a single structured array rather than parallel arrays. (Validated: #7450)
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly. Off-scope aggregation inflates counts.
- **Fleet provisioning caveats:** `fleet-exec run` passes `--command` verbatim — always prefix with `cd /home/dev/arc-starter &&`. Provision wallets sequentially.
- **Platform-UI-only feature detection before skill development:** Verify features are accessible via public API — not just the UI. Document confirmed non-API features in SKILL.md. (Validated: #6216, #6068, #6437)
- **X daily post budget: pre-check before queuing, schedule on exhaustion:** 25-post/day cap. If exhausted, schedule via `--scheduled-for` next UTC midnight + 5 min. (Validated: #6488, #6503)
- **Multi-agent signal ownership: verify beat assignment before filing.** Arc owns: ordinals. Beat slugs must be verified live — documented names may differ from API. (Validated: #6681, #7140)
- **Required-field defaults in CLI/API integration:** When a downstream API requires a field but the CLI makes it optional, provide a sensible default (e.g., disclosure metadata, auth headers). Prevents cascading rejections. Document default in SKILL.md. (Validated: #7681)
- **Test-before-requeue for integration fixes:** After fixing an API client/auth/field issue, create an immediate test task to verify end-to-end before requeuing dependent failed tasks. Catches deployment gaps. (Validated: #7681, #7683)
- **Pre-formatted task generation with structured metadata:** When queuing publication/filing tasks, construct the full signal payload (headline, claim, evidence, implication, sources array with url+title, tags) at data-fetch time rather than during dispatch. Queue tasks with pre-formatted CLI commands. Reduces editorial work downstream and ensures consistent data quality. (Validated: #7689)
- **Multi-API aggregation for market signals:** Combine APIs with different auth patterns (some requiring credentials, others unauthenticated) in a single sensor. Each data category should fetch from 2+ sources and cross-reference in the signal's implication. Prevents API-specific biases and strengthens signal credibility. (Validated: #7689)
- **Protocol evaluation framework:** Evaluate in order: (1) real production volume from authoritative sources, (2) implementation landscape, (3) production user examples, (4) academic backing. Volume reality often contradicts narrative. Verify protocol philosophy alignment with agent identity (e.g., x402 EVM-first vs L402 Bitcoin-native for Arc) before committing. Document narrative-vs-adoption timeline gap. (Validated: #7289)
- **MCP tool architecture: separate tools from service logic.** Create dedicated tool files per domain; consolidate business logic in service layer; register in both `index.ts` and `skill-mappings.ts`. Thin tools delegate to thick service methods. (Validated: #7367, #7382, #7390)
- **Cross-repo skill porting workflow:** (1) inspect target repo conventions, (2) check for existing branches, (3) remove Arc-specific infrastructure, (4) adapt and test locally, (5) use fleet-handoff for GitHub ops. (Validated: #7482)
- **Atomic batch migrations with state preservation:** Use single `INSERT ... ON CONFLICT DO UPDATE` batch; preserve derived state (created_at, version timestamps) before deletion. (Validated: #7164)
- **Eliminate pre-check queries:** Use atomic SQL ops (INSERT ... ON CONFLICT) instead of separate SELECTs. Reduces query count and prevents race conditions. (Validated: #7184)
- **Release automation coordination:** After merging a feature PR, release-please creates an automated version-bump PR. Merge it immediately after CI completes to keep source and package versions synchronized. Don't defer — version lag between code and published package creates user confusion and docs divergence. (Validated: #7769)
- **Shared CLI-wrapper helpers for cross-skill safety gates:** When the same verification check applies across multiple domain skills (e.g., trust scoring, sybil detection), implement it once as a shared CLI-wrapping helper (e.g., trust-gate.ts) that runs checks in parallel and returns a structured decision object. Domain skills import and use it. Ensures gating consistency and reduces maintenance. (Validated: #7793)
- **Optional identity parameters enable graceful feature degradation:** Safety gates and premium features should be behind optional `--flag` parameters (e.g., `--counterparty-pubkey`, `--pubkey`). When omitted, the feature no-ops with a "skip" decision instead of failing. Add `--force` override for exceptional cases. Reduces friction for core operations while providing upgrade path. (Validated: #7793)
- **External registry contribution workflow:** Audit registry structure (categories, frontmatter, example entries) first; identify content gaps (missing domains, zero entries in relevant category); draft entries in exact repo format (SKILL.md + SOURCE.md or equivalent); email draft for stakeholder review + tone validation; once approved, PR. Batch-drafting multiple related entries (4 skills × 2 files) in a single email avoids queue spam and enables one-pass schema/tone feedback. (Validated: #7856)

## Claims, Git & State

- **Live deployment divergence:** Audits must check live site AND source HEAD. Service processes don't auto-reload on file changes — verify `systemctl restart <service>` after code commits. (Validated: #7339)
- **Proof over assertion:** Verify all claims against authoritative sources before publishing. Calculated estimates are unreliable; require DB-validated data for financial reports. (Validated: #7175)
- **Output quality signals vs. process metrics:** Define a quality signal for retrospective/strategic work. Process metrics prove machinery worked; quality signals prove it mattered. (Validated: #7344)
- **Executable tests validate audits:** Create a live test task and execute it to verify end-to-end behavior. Code inspection is second pass.
- **Code review blocking verification:** Verify original concerns actually exist in current code before clearing a block. Multi-layer: scan diffs → trace call stack (handler/service/data layers) → verify fix spans all layers. Single-file reviews miss partial implementations across files. (Validated: #7417, #7757)
- **Self-authored PR review restriction:** Provide detailed review comments but do not self-approve. Delegate merge decision to another maintainer. (Validated: #7418, #7420)
- **Explicit blocking/suggestion labels in reviews:** Mark each feedback item as [blocking] or [suggestion]. Blocking = must fix before merge (security, data integrity, breaking API). Suggestions = nice-to-have, can merge without. Clarifies scope and prevents developer drift. (Validated: #7757)

## Email & Coordination Patterns

- **External confirmation gates with dedup awareness:** Verify current state before queuing; follow stakeholder direction on duplicates. (Validated: #7398)
- **Draft-first with stakeholder approval gates:** Queue draft separately; send for approval; then queue publishing.
- **Operator reports → investigate before escalating:** Verify against credential store, memory, and live state before responding. A reported "missing token" may be a parse error. (Validated: #7187)
- **Thread-scoped email dedup:** Key dedup on (thread, topic), not sender alone. Sender-level 24h windows suppress follow-up replies in the same thread. (Validated: #7339)
- **Stakeholder request decomposition:** Decompose detailed requests into triage (fast, same cycle) + execution tasks (queued at appropriate model tier). (Validated: #7446)
- **Stakeholder-directed architecture overrides defaults:** When a stakeholder provides explicit architectural guidance, implement it directly. Document guidance + rationale in result_summary and SKILL.md. (Validated: #7436)
- **Terminology validation: separate identity from implementation detail:** When naming system components or versions, distinguish what the agent IS (identity, operational continuity) from how it WORKS (implementation, architecture). E.g., 'aibtc-agent' (identity) over 'aibtc-dispatch-agent' (implementation detail). Prevents accidental identity erasure when infrastructure changes. (Validated: #7729)
- **Infrastructure reset gate: formal proposal process before major rewrites:** Major version rewrites (v7 engine reset) require formal RFC-style proposal (BIP/SIP precedent) approved by stakeholders before implementation. Separate "clean-slate infrastructure" (approved) from "distill operations" (preserve continuity). Prevents unilateral architecture decisions. (Validated: #7729)
- **Asset-first review gate:** Commit audit/proposal to version control first; send stakeholder a pointer to the file. Avoids email size limits and creates durable record. (Validated: #7479)
- **Data source verification for stakeholder coordination:** When responding to questions about Arc's data sources or API choices, verify current availability status and provide primary + fallback sources with migration context (e.g., "Hiro shut down March 9, now using Unisat"). Prevents stale information and explains why Arc made source changes. (Validated: #7727)
- **Email research requests: immediate reply + P5 async queue + blocked-source handling:** When receiving a research request via email, reply immediately to acknowledge, then queue a P5/Sonnet task with arc-link-research + arc-email-sync skills. If source is inaccessible (X blocked, paywall, etc.), use author/topic/date to search authoritative indexes (arXiv, Google Scholar) directly for exact identification. Avoids speculation. (Validated: #7752, #7753)
- **Framework-driven architectural follow-ups:** When receiving open-ended architectural questions from stakeholders, acknowledge + queue P3 Opus task with explicit framework (SpaceX 5 principles, systems-thinking, decision trees) to structure the research. Frameworks shape open-ended research and ensure proposals align with stakeholder framing preference. (Validated: #7759)
- **Email closure gate: verify follow-up queueing before closing.** When closing an email task with a committed reply (e.g., "I'll research X" or "I'll create a task for Y"), do NOT mark the email task complete until the follow-up task is queued. Prevents "reply + forget" pattern where prior sessions commit but never queue the work. (Validated: #7800)
- **Time-sensitive verification code forwarding:** When an internal inbox receives a third-party verification code (email, SMS) with a tight expiry window (≤5min), forward immediately with explicit timeout flag rather than waiting for confirmation. First-attempt + instant notification is correct; don't retry within the same window. (Validated: #7869)
- **Stakeholder feedback + revision delegation:** When receiving comprehensive revision feedback from stakeholder, reply immediately with confirmation of revision plan. Queue a single high-tier delegation task (P3+) scoped as: (1) information gathering from subagents to fill accuracy gaps, (2) revision incorporating all feedback in one pass (not incremental), (3) clean output for stakeholder final review before downstream execution. Prevents feedback ping-pong and ensures revisions address all points systematically. (Validated: #7865)
- **Claim-verification research for accuracy-critical drafts:** When stakeholder feedback disputes specific factual claims (tool counts, endpoint availability, category assignments), decompose into targeted claims, spawn 3-4 parallel research subagents per claim domain, verify findings via live API/endpoint checks synchronously, then merge into revised draft. Parallel research + live verification = high-confidence accuracy for policy/architecture documents. (Validated: #7866)
- **Feedback changelog mapping for transparency:** When revising a draft with comprehensive stakeholder feedback (10+ items), include a changelog table mapping each feedback number → revision description. Proves all feedback was addressed, enables stakeholder verification, and creates an auditable record. (Validated: #7866)

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors. >20 pending → redistribute. Periodic task triage clears 10-20%. (Validated: #7175)

## Operational Rules

- **Retrospective queue gatekeeping:** High-level reviews must shape the task queue. Result_summary must include queue actions: killed X stale tasks, queued Y next-phase tasks. Distinguish structural issues (same bug every cycle → escalate + explicit close-out task) from operational issues (incident-driven, naturally resolved with incident fix). (Validated: #7348, #7651)
- **Event-driven infrastructure readiness + autonomy handoff:** For time-bound events (competitions, launches, deadlines), structure the review as: validate infrastructure (skills, sensors, fixes) + external dependencies (API keys, credential provisioning, live endpoint health), close stale/superseded work, queue immediate quality audit, then explicitly hand off to autonomous sensor operation with a specific horizon date. This pattern reduces manual orchestration burden and creates confidence checkpoints. (Validated: #7717, #7835)
- **Critical-path blocking dependencies escalate as P2 separate tasks:** When a pre-event review finds that a critical external dependency (API key, credential, live endpoint) is missing and <48h remains to deadline, escalate as a P2 human-action task SEPARATE from technical fixes. Do not bury blocking dependencies under P8 technical work — human decision/action on blocking path must be visible and prioritized. (Validated: #7861)
- **Unreliable data sources trigger replacement tasks, not retries:** When a sensor's data source fails 2+ times consecutively (e.g., magiceden.io unreachable), create a P3 source-replacement task to migrate to an alternate (cross-validated) source. Do not queue same-source retry tasks — the source is known-bad. Replacement task should specify alternate source + validation approach. (Validated: #7861)
- **Cross-sensor parity check for shared gates:** When multiple sensors generate the same resource type with shared rate-limits or daily caps, audit them for identical pre-check logic before time-bound events. Run the audit 1 cycle before the event, verify consistency in actual sensor code (not just documentation), and surface deviations as P8 follow-ups. Inconsistency (e.g., one sensor checking `isDailySignalCapHit`, another not) causes unpredictable queue failures during high-stakes periods. (Validated: #7835, #7839)
- **Linter rules for systemic code-style patterns:** Abbreviated variable names across multiple skills indicate a fleet-wide gap. Configure ESLint/TSC rules; separate code-quality from metadata compliance audits. (Validated: #7312)
- **Failure rule:** Root cause first, no retry loops. Persistent external blocker (≥2 identical errors) → mark failed, write memory entry, create ONE follow-up P8 task. (Validated: #6456, #6437)
- **Fleet hardware: CPU-only.** All 5 VMs are VMware instances. No GPU, no audio. Fail immediately for GPU-required tasks. (Validated: #6509, #6642)
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Infrastructure prerequisites gate production deployment:** Validate code compiles, commit changes, create follow-up listing missing infrastructure. Prevents silent failures from missing bindings. (Validated: #7190)
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
