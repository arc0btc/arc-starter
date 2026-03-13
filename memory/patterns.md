# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions. Bulk DELETE operations may appear incomplete until WAL is checkpointed; force explicit checkpoint or service restart to finalize cleanup.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns. Export gate state to sensors for async recovery patterns.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup timing: verify completion, not creation:** Mark state "done" only after verifying task completion in DB (`completedTaskCountForSource()`), not on task creation. Creation-time marking blocks retries permanently.
- **Dedup key scope: entity-based, not reason-based:** Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.
- **Multi-item dedup: check against newest item:** When checking if an action was taken on a batch (e.g., replies to sender), compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Capability outage → sentinel + gate all downstream sensors:** On plan suspension, API exhaustion, or account ban, write a sentinel file (e.g., `db/x-credits-depleted.json`) and check it in every affected sensor. System-wide propagation prevents cascading failures and child-task explosion.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Presentation/audience-facing work routes to Opus minimum.** Tone, framing, and audience judgment require senior modeling.
- **Retrospective tasks need Sonnet tier (P7) minimum.** Haiku timeout insufficient for reading records + extracting patterns.
- **Model tier unavailability forces re-routing:** Document impact; work must defer, degrade quality, or decompose for available tiers.
- **Optional feature graceful degradation:** Design tasks so missing optional capability (API key, external service) skips the feature without blocking core work. Document skip in result_summary.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. No monitoring chains waiting for external state.
- **Secret provisioning is operator-only:** Agents can load from creds store but cannot provision. Provide exact `arc creds set` CLI command + close without escalation. Always verify existing code first.
- **Verify event premise before spawning derivative tasks:** Check current state (wallet, config, balance) before queuing follow-ups. Stale premises generate 30+ chain tasks (example: task #3393 "wrong wallet" that was already correct).
- **402 CreditsDepleted: communicate, block, gate sensor:** Reply with specific error, write sentinel, create one pending task. Without a gate, sensors cascade new failures continuously.
- **Opaque system state → escalate once, stop querying:** External services may report healthy while internal state (nonce, mempool) is stuck. Gate sensors, escalate to human with system access.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.

## Integration Patterns

- **Credentials on CLI flags leak to process history:** Never pass secrets via command-line flags. Use env vars, stdin, or credential store APIs.
- **Credential naming consistency across integration layers:** Sensor, CLI, and creds store must use identical service/key names. Mismatches cause silent lookup failures. Verify naming alignment before marking integration complete.
- **Credential validation at health check; async retrieval must be awaited:** Catch missing credentials at health-check time, not on first API call. `getCredential()` returns Promises; always `await`.
- **Dual-endpoint auth models:** Some APIs use different auth headers per endpoint class. Document both schemes in SKILL.md and verify each independently.
- **Cascading auth fallback across endpoints:** When service API keys are missing, use admin key as fallback—if the primary endpoint rejects it, route to alternative endpoints (e.g., /stats vs /logs) that accept it. Document endpoint-auth matrix in SKILL.md to guide integration setup.
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly (context, folder, timeframe, grouping). Off-scope aggregation inflates counts (e.g., per-sender count vs. per-thread).
- **Breaking change research + batch fix task creation:** When investigating API migrations or breaking changes, document the full change surface (table of before/after), identify ALL dependent integrations via codebase search, then create batched follow-up tasks covering all surfaces. Prevents partial implementations and redundant research.
- **Verification-then-confirm for API migrations:** Before replying to stakeholders about v2 API status, verify all dependent integrations are already updated (check feature branches, recent commits). This collapses investigation + confirmation into one clear stakeholder communication.
- **SSH/fleet-exec context:** Both `ssh` and `fleet-exec run --command` execute from home dir — always prefix commands with `cd /home/dev/arc-starter &&`. Identity provisioning requires explicit commits. Provision wallets sequentially to avoid race conditions.
- **Skill name resolution validation before dispatch:** Typos in `arc skills run --name X` fail silently. Validate skill names against `arc skills` or directory before use.
- **Public-internal system split with directional sync:** Public layer (lightweight, read-only) syncs one-way from authoritative internal system. Prevents external state corruption and reduces complexity.
- **Framework dependencies in bulk cleanup:** Audit `src/` and `templates/` for imports from `skills/`. Core dependencies (e.g., `src/credentials.ts` → `skills/arc-credentials/`) must be explicitly preserved in a keep-list before archiving or deleting skills. Missing dependencies cause silent build failures.

## Claims, Git & State

- **Live deployment divergence:** Audits must check live site AND source HEAD. `exit 0` from deploy tools doesn't guarantee CDN served the update — fetch live URL to verify.
- **Proof over assertion; content claims before publication:** Verify infrastructure claims against authoritative sources (on-chain queries, direct API calls) before publishing. Distinguish "acknowledged gaps" from "false claims of deployed features."
- **Content identity verification:** Cross-check all identity claims (agent names, wallet addresses) against authoritative registries before publishing.
- **State discovery before action:** `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions.

## Email & Coordination Patterns

- **External confirmation gates:** Upon receiving: (1) reply with summary, (2) mark processed, (3) unblock downstream, (4) queue next phase. For multi-phase plans, respect phase dependencies when queuing: analysis/reports before cleanup/action — use priority gaps (reports at P2-3, cleanup at P6-7) to enforce sequence within dispatch cycles.
- **Draft-first with stakeholder approval gates:** Queue draft generation separately; send for approval; then queue publishing/execution. Separates quality review from irreversible actions.
- **Tight-deadline deliverables → immediate P1 queuing on confirmation:** Queue execution task at P1 immediately once prerequisites are completed. Don't defer pending further decisions.
- **Pre-build delivery assets for predicted requests:** Build and commit to memory/ in advance for known-upcoming deliverables. Reduces confirmation-to-delivery latency.
- **Batch blocked task escalations:** Group tasks needing the same human decision into a single communication.
- **Email keywords as operational commands:** Embed actionable instructions in notification emails ("reply with RESTART") + have a sensor watch for keywords in replies from known contacts.
- **Legitimate external engagement leads with concrete value:** Identify what genuine value you can offer, then propose participation from that foundation. Transforms cold outreach into collaboration.
- **Clarifying questions block dependent task creation:** When reply depends on unknown external state, ask first and defer task creation until you have clarity.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Operational cadence:** Three-tier check-in: heartbeat (15min) → ops review (4h) → daily brief (24h). When cadence changes, all time-based thresholds scale proportionally.
- **State preservation validation before fleet maintenance:** When planning cleanup/restart operations, explicitly clarify with stakeholders which persistence layers (SOUL.md, wallets, credentials, configs) stay vs. get wiped. Omissions silently break downstream services. Document the keep-list before executing irreversible cleanup.
- **Worker cleanup sequence before restart:** (1) Clear task database (tasks + cycle_log tables), (2) Reset memory/MEMORY.md to template, (3) Remove hook-state sensor files, (4) Verify SOUL.md, credentials, code intact. Sequential order prevents partial states where cleanup appears incomplete due to WAL buffering or service interruption.

## Operational Rules

- **Named constant alignment audit:** Verify code constants match runtime values and all threshold references use the constant. Misaligned constants cause sensors to operate on stale thresholds.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free.
- **Cost alerts are informational:** Budget limits do not trigger throttling. Estimate remaining spend via rolling average cost/cycle (~$0.49) × pending task count; exclude offline workers from calculations.
- **Research-first for infrastructure:** Email-triggered platform concepts → P1 research tasks producing market validation + competitive analysis + feasibility + risk assessment + scope/timeline recommendation. Separates scope-setting from implementation.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Bulk cleanup operations distort failure metrics:** Distinguish between genuine failures and bulk-close operations (mark-as-completed, housekeeping). When 70%+ of "failures" in a retrospective are actually cleanup tasks, metric is noise. Filter these out before alerting on failure rate changes.
- **Reactive task volume can starve strategic priorities:** With sensor-driven load at 240+/day (97% autonomous), schedule strategic tasks (D1/D2 directives) at elevated priority (P1-3) to prevent them queuing indefinitely behind sensor tasks. Without explicit priority, reactive work dominates the dispatch queue.
- **Three-source priority lookup prevents config/identity drift:** When syncing configs across fleet nodes (git, backups, canonical sources), use priority order: (1) working copy, (2) persistent backup, (3) canonical remote. Verify identities via explicit claim detection (e.g., wallet addresses, BNS names) to detect contamination. Naive file-replace causes identity overwrites.

