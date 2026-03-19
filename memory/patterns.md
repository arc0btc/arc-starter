# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*
*Last updated: 2026-03-18T23:52Z*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns. Export gate state to sensors for async recovery patterns.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup timing: verify completion, not creation:** Mark state "done" only after verifying task completion in DB (`completedTaskCountForSource()`), not on task creation. Creation-time marking blocks retries permanently.
- **Dedup key scope: entity-based, not reason-based:** Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.
- **Multi-item dedup: check against newest item:** When checking if an action was taken on a batch (e.g., replies to sender), compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Meta-sensor rate-limiting:** Sensors creating meta-tasks (retrospectives, consolidations, status reports) need per-cycle creation caps or timestamp-based dedup windows. Without them, fleet-memory or similar meta-sensors generate 6+ duplicate tasks per cycle. Gate on `last_created_at + cooldown > now` before queuing. (Validated: #7175 fleet-memory spam)
- **Sensor health visibility:** Dark periods (sensor not executing 5+ days) indicate infrastructure failure, crash, or gate stuck open. Add weekly sensor health roll-call task that reports execution count per sensor per week. Catches broken sensors before they affect operations. (Validated: #7175 reporting-sensor dark 5 days)
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

- **Reference production app pattern cloning:** When building new indexers, workers, or APIs in a domain, clone architectural patterns from existing production reference apps (agent-news, agent-hub). Copy schema structure, middleware organization, service layer patterns, and cron trigger approach. Ensures consistency with fleet standards and accelerates development. (Validated: #7153 ERC-8004 indexer)
- **Stacks contract state integration:** Direct Stacks API queries for contract reads require hex Clarity value parsing. Document the specific contract, endpoint, Clarity types queried (get-last-token-id, get-owner, etc.), and parsing logic as a reusable module. Future Stacks indexer tasks can copy this pattern. (Validated: #7153 identity-registry-v2)
- **Pre-existing remote repository coordination:** When a task involves a GitHub repository with existing content (scaffold, IMPLEMENTATION_PLAN.md), verify remote state early. Plan merge/rebase strategy to coordinate local implementation with existing commits. Don't assume empty repo. (Validated: #7153 erc-8004-indexer remote scaffold)
- **Feature branch implementation discovery:** When a task targets a feature branch (`feat/*`, `fix/*`), check the remote branch for existing implementations before starting local work. If a complete working implementation exists, reset to remote (`git reset --hard origin/branch`) rather than reimplementing locally — this uses tested code and avoids duplication. (Validated: #7221 feat/nostr-tools had complete Nostr MCP tools; reset to remote avoided reimplementation)
- **Skill consolidation for overlapping domains:** When multiple skills provide overlapping functionality (e.g., maximumsats + maximumsats-wot), consolidate into a single unified skill with cleaner interface; document prior skills and provide migration guidance. (Validated: #7226 nostr-wot consolidated two prior skills)
- **Tiered API fallback with caching:** For APIs with free (rate-limited) and paid (L402/sats) tiers, try free first, fall back to paid only on rate-limit error, and cache results to minimize paid calls. (Validated: #7226 nostr-wot uses wot.klabo.world free 50 req/day, falls back to L402 endpoint)
- **Multi-format identifier support:** Accept multiple encodings for cryptographic identifiers (hex/bech32 for pubkeys, different address formats) with auto-conversion to reduce friction. (Validated: #7226 nostr-wot supports both npub and hex pubkeys)
- **Credentials on CLI flags leak to process history:** Never pass secrets via command-line flags. Use env vars, stdin, or credential store APIs.
- **Credential naming consistency across integration layers:** Sensor, CLI, and creds store must use identical service/key names. Mismatches cause silent lookup failures. Verify naming alignment before marking integration complete.
- **Credential validation at health check; async retrieval must be awaited:** Catch missing credentials at health-check time, not on first API call. `getCredential()` returns Promises; always `await`.
- **Dual-endpoint auth models:** Some APIs use different auth headers per endpoint class. Document both schemes in SKILL.md and verify each independently.
- **API version/auth migration requires coordinated client updates:** When an API changes auth scheme, request format, or field naming, update all client callers (CLI commands, signing logic, field mapping) simultaneously and validate against live endpoint. Partial updates cause cascading auth failures. (Validated: #7140 aibtc.news v2 migration — auth moved to headers, signing format changed to `METHOD /path:unix_seconds`, fields renamed to snake_case)
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly (context, folder, timeframe, grouping). Off-scope aggregation inflates counts (e.g., per-sender count vs. per-thread).
- **Fleet provisioning caveats:** `fleet-exec run` passes `--command` verbatim — always prefix with `cd /home/dev/arc-starter &&`. Identity provisioning (SOUL.md, identity.ts) requires explicit commits or fleet-sync overwrites. Provision wallets sequentially to avoid race conditions.
- **Skill name resolution validation before dispatch:** Typos in `arc skills run --name X` fail silently. Validate skill names against `arc skills` or directory before use.
- **Silent CLI flag failures from stale memory:** When CLI parameters are optional and don't error on mismatch (e.g., flag present but field is wrong), stale memory entries cause silent failures — task runs successfully but produces wrong output. Pattern: validate all documented CLI parameters against actual code when loading memory; consider a "signature check" in SKILL.md that health-check can validate. (Validated: #6725 `--html` vs `--body-html` in arc-email-sync, recurring in #6587)
- **Public-internal system split with directional sync:** Public layer (lightweight, read-only) syncs one-way from authoritative internal system. Prevents external state corruption and reduces complexity.
- **Platform-UI-only feature detection before skill development:** Before building a skill integration for a platform feature, verify it is accessible via public API — not just the UI. Check API docs for an endpoint. X Articles (UI-only), Moltbook email (verified-only), aibtc.news /api/brief (404) are confirmed non-API. Document in SKILL.md as "not buildable via API" to prevent repeat attempts. (Validated: #6216 X Articles, #6068 Moltbook, #6437 aibtc.news)
- **X daily post budget: pre-check before queuing, schedule on exhaustion:** X API v2 enforces a 25-post/day cap. Check remaining quota before queuing new syndication tasks. If exhausted, schedule the task for next UTC midnight + 5 minutes via `--scheduled-for`. Do NOT requeue immediately — dispatch will hit the same wall. (Validated: #6488, #6503 — both failed identically after depleting budget)
- **Multi-agent signal ownership: verify beat assignment before filing:** aibtc.news and similar multi-agent content systems assign beats per agent. Arc owns: ordinals. Filing signals for other agents' beats (DAO Watch, BTC Macro) is a policy violation. Check beat ownership in skill SKILL.md or `db/` config before queuing signal-filing tasks. **Beat slugs must be verified live** — documented names may differ from API (example: ordinals-business in docs vs. ordinals in live API). (Validated: #6681, #7140)
- **Relay-mediated transaction validation:** When accepting payments/transactions through a relay service, validate the sender from either the direct transaction source (`tx.sender_address`) OR the relay's function argument (`sender`). Both represent legitimate transaction sources; accept both paths to enable sponsored/relay-mediated flows. (Validated: #7259 x402 relay sBTC payments)
- **Achievement auto-check pattern consistency:** When adding auto-check achievements to periodic endpoints (heartbeat, verification), replicate the established pattern: external API query + rate-limiting/timeout handling + skip gracefully on failure. Standardizes achievement discovery and prevents API exhaustion across feature additions. (Validated: #7259 connector achievement auto-check)
- **Eliminate pre-check queries in favor of atomic operations:** Use atomic SQL operations (INSERT ... ON CONFLICT, UPDATE with CASE) instead of separate SELECTs for existence checks. Reduces query count and prevents race conditions. (Validated: #7184 agent-news payment types)
- **Extract repeated business logic into shared methods:** When the same calculation or transformation appears in multiple code paths, consolidate into a single shared method during review. Ensures consistency, simplifies audits, and prevents divergent implementations. (Validated: #7184 agent-news scoring SQL)
- **Validate aggregation inputs at ingestion, not query time:** Fields used in scoring or aggregation should be validated when created or loaded, not inside query logic. Prevents invalid data from silently affecting calculations. (Validated: #7184 brief_date validation)
- **Worktree-developed skills must be integrated to main tree before multi-step operations:** When a skill is developed in a worktree and performs multi-step operations requiring other skills (e.g., registration using signing from another skill), copy both the primary and dependency skills to the main tree before executing. Worktree isolation masks skill-to-skill import failures and reports as dependency errors rather than availability issues. (Validated: #7189 ALB skill registration — failed in worktree, succeeded after copying skill to main tree)

## Claims, Git & State

- **Live deployment divergence:** Audits must check live site AND source HEAD. `exit 0` from deploy tools doesn't guarantee CDN served the update — fetch live URL to verify.
- **Proof over assertion; content claims before publication:** Verify all claims (infrastructure, features, financial metrics) against authoritative sources (on-chain queries, direct API calls, DB validation) before publishing. Calculated estimates and provisional reports are unreliable; require DB-validated data for cost/budget reports. (Validated: #7175 CEO cost calc error)
- **Content identity verification:** Cross-check all identity claims (agent names, wallet addresses) against authoritative registries before publishing.
- **State discovery before action:** `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions.
- **Executable tests validate audits; code inspection is second pass:** When auditing a system pathway, create a live test task (short-lived, high priority) and immediately execute it to verify end-to-end behavior. Close the test task after confirmation. This ensures the audit proves actual behavior, not just code structure. (Validated: #7154 POST /api/messages → task creation)
- **Atomic batch migrations with state preservation:** Consolidate multiple destructive statements (DELETE old, INSERT new) into single atomic `INSERT ... ON CONFLICT DO UPDATE` batch. Before deletion, copy derived state (created_at, created_by, version timestamps) to new entities for non-system claims only. Single exec() call prevents partial states. (Validated: #7164 17-beat taxonomy migration)

## Email & Coordination Patterns

- **External confirmation gates:** Upon receiving: (1) reply with summary, (2) mark processed, (3) unblock downstream, (4) queue next phase.
- **Draft-first with stakeholder approval gates:** Queue draft generation separately; send for approval; then queue publishing/execution. Separates quality review from irreversible actions.
- **Tight-deadline deliverables → immediate P1 queuing on confirmation:** Queue execution task at P1 immediately once prerequisites are completed. Don't defer pending further decisions.
- **Pre-build delivery assets for predicted requests:** Build and commit to memory/ in advance for known-upcoming deliverables. Reduces confirmation-to-delivery latency.
- **Operator reports → investigate before escalating:** When whoabuddy or a contact reports an infrastructure issue (missing token, wrong config, failed deployment), immediately verify against credential store, memory, and live state before responding. A reported "missing token" may be a parse error; a "wrong domain" may reflect stale documentation. Investigation clarifies the actual problem and often resolves it without round-trip escalation. (Validated: #7187 Cloudflare token parse error vs. missing, domain in prior 4-phase plan)
- **Batch blocked task escalations:** Group tasks needing the same human decision into a single communication.
- **Email keywords as operational commands:** Embed actionable instructions in notification emails ("reply with RESTART") + have a sensor watch for keywords in replies from known contacts.
- **Legitimate external engagement leads with concrete value:** Identify what genuine value you can offer, then propose participation from that foundation. Transforms cold outreach into collaboration.
- **Clarifying questions block dependent task creation:** When reply depends on unknown external state, ask first and defer task creation until you have clarity.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain. Stale/completed tasks not marked complete also inflate backlog; periodic task triage (kill duplicates, mark completed retroactively) clears 10-20% and restores visibility. (Validated: #7175 killed 12 stale tasks)
- **Operational cadence:** Three-tier check-in: heartbeat (15min) → ops review (4h) → daily brief (24h). When cadence changes, all time-based thresholds scale proportionally.

## Operational Rules

- **Named constant alignment audit:** Verify code constants match runtime values and all threshold references use the constant. Misaligned constants cause sensors to operate on stale thresholds.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **Persistent external blocker: fail fast after 2 identical errors:** When an external constraint fails ≥2 times with the same error message (VALIDATION_ERROR, 404, NONCE_CONFLICT), stop retrying: (1) mark task failed, (2) write a memory entry naming the constraint, (3) create ONE follow-up task at P8 that tracks resolution. Do not queue more retries — they consume budget and pollute cycle logs. (Validated: #6456 ALB registration 2×, #6437 aibtc.news brief 2×, 28 NONCE_CONFLICT retries, #6642 dual-GPU 2×)
- **Fleet hardware capabilities are fixed and CPU-only:** All 5 VMs (Arc, Spark, Iris, Loom, Forge) are VMware CPU-only instances. No GPU, no audio hardware, no specialized compute. Tasks requiring GPU (Whisper, Kokoro TTS, ML inference) have no valid target — fail immediately and note hardware gap. Do not retry on different VMs. (Validated: #6509, #6642)
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free.
- **Cost alerts are informational:** Budget limits do not trigger throttling. Estimate remaining spend via rolling average cost/cycle (~$0.49) × pending task count; exclude offline workers from calculations.
- **Research-first for infrastructure:** Email-triggered platform concepts → P1 research tasks producing market validation + competitive analysis + feasibility + risk assessment + scope/timeline recommendation. Separates scope-setting from implementation.
- **Infrastructure prerequisites gate production deployment:** Don't deploy to production if required infrastructure (KV namespaces, secrets, DNS bindings, service configs) isn't fully configured. Pattern: (1) validate code compiles via build dry-run, (2) commit code changes to git, (3) create follow-up task listing missing infrastructure explicitly. Prevents silent failures from missing bindings and separates code readiness from infrastructure readiness. (Validated: #7190 ALB monitoring deployment deferred pending KV namespace setup)
- **Gitignored directories require alternate deployment paths:** When code lives in a gitignored directory (e.g., `github/` local clones), changes can't flow through normal git commit workflow. Check .gitignore early. Validate build, then use direct deployment tools (wrangler, docker, etc.) or commit code to non-ignored location. (Validated: #7190 ALB Worker code in github/gitignored, required wrangler vs. git-based deployment)
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
