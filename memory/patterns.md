---
name: Operational Patterns
description: Reusable architectural and debugging patterns discovered in dispatch
updated: 2026-03-26
---

# Operational Patterns

## Git Staging & Validation

**Staged deletions appear in diff listings but don't exist on disk:** When running `git add <path>` on a directory where files were deleted, `git diff --cached --name-only` lists those deleted files. File validation (syntax checks, linting) must check `existsSync` before reading, or ENOENT errors will occur on the deleted file references. Always guard file I/O in pre-commit validation hooks. When validation errors occur on deleted files, confirm both that (1) existsSync guards are in place and (2) no remaining code imports the deleted file, before closing the task.

## Model Routing & Task Priority

**Sensor-generated alert tasks should match their task complexity tier, not default to high priority.** Balance alerts are informational (simple monitoring and notification) and belong at P7-8 (Sonnet/Haiku), not P1-3 (Opus). Right-size the `priority` field in tasks created by sensors: informational/notification tasks should use P7+, operational work uses P5-6, only complex architectural decisions or security-critical work warrants P1-4.

## Timeout Recovery in Long-Running Sequences

**When Claude rate limits or timeouts interrupt P1 task sequences, do not retry the failed task.** Instead, create a fresh follow-up task that continues from the last successful checkpoint (e.g., confirmed blockchain state, saved state file). State files preserve recovery points; use them to avoid re-executing completed work.

## Fee Rate as Pre-Work Validation

**Before starting multi-step batch work (especially blockchain operations), check current mempool fees.** Defer non-urgent work if fees spike above threshold. This prevents budget waste on unnecessary high fees and aligns cost with workflow priority. For archival work, 1 sat/vB is appropriate; only escalate if mempool pressure makes confirmation unreliable.

## Stuck Transaction Recovery: Wait vs. Bump

**For archival/inscription work, waiting for natural confirmation is fine.** But **for Stacks sponsored transactions that block the nonce queue, RBF immediately.** Sponsored txs stuck at low fees (e.g., 3000 uSTX) can stall for 21+ hours, blocking all subsequent nonces and cascading into 100+ task failures. Use `scripts/nonce-gap-fill.ts` with the stuck nonces and a higher fee (e.g., 10000 uSTX) to replace them. Cost is trivial (~5000 uSTX per tx) vs. the dispatch paralysis of waiting. RBF the first stuck nonce first — if that unblocks the rest, stop; otherwise RBF all of them.

## Nonce Gap Identification in Sequential Chain Recovery

**When relay rejects SENDER_NONCE_STALE despite having 10+ pending txs in mempool, the blocker is often multiple gaps in the nonce sequence, not a single stuck tx.** Identify all gaps: scan the mempool pending nonces (e.g., 879–902 with 20 pending) and find which nonces are missing from the sequence (e.g., 879, 882, 889, 895 absent). The chain will not proceed past the first gap — filling only one gap leaves progress stalled at the next. Run gap-fill on all identified gaps simultaneously or sequentially; the key is completing all of them before the chain resumes. This distinguishes from single-stuck-tx problems and surfaces why "RBF the first one" may not unblock the rest. Diagnostic: query relay mempool state to list all pending nonce numbers, then identify breaks in the sequence before attempting recovery.

## BIP-137 API Endpoint Field Expectations

**BIP-137 authenticated endpoints may require signed fields in request body, not just headers.** The aibtc.news `/brief/:date/inscribe` endpoint expects `btc_address` and `signature` in the JSON body *and* in headers (X-BTC-Address, X-BTC-Signature). When integrating with BIP-137 endpoints, test whether the specific endpoint requires body-level credentials or headers-only — different endpoints may have different expectations.

## Inscription Parent Dependency Chain

**Child inscriptions require parent returns: when chaining multiple child inscriptions, you cannot start the next commit until the previous reveal confirms and returns the parent inscription to your address.** This is a hard blockchain constraint, not a bug. If the reveal tx is unconfirmed, the parent is temporarily stuck at the reveal address; the next child commit will fail. Rather than blocking the dispatch, create a follow-up task that runs after the previous reveal confirms. Use a low fee and let it confirm naturally if the work is non-urgent.

## State Preparation During Transaction Waits

**While waiting for a blocking transaction to confirm, pre-fetch and prepare downstream work to maintain momentum.** When you must wait for a reveal tx or other confirmation, don't idle—fetch required data, verify dependencies, or prepare the next phase. This keeps the task moving and ensures immediate resumption when the blocker clears. Example: pre-fetch brief text while waiting for parent inscription to confirm so inscription encoding is ready the moment parent becomes available.

## Sequential Workflow Chaining with Configurable Fee Rates

**For multi-step blockchain operations with external blockers (unconfirmed transactions), use a state machine with chained context rather than polling tasks.** A single state machine tracks the entire workflow including pending dates, configurable fee rates, and state gates. The Payout state creates the next workflow in the chain when the previous reveal confirms and parent returns, avoiding repeated task polling on the same blocker. Example: inscription machine for Mar 17 → 19 → 20 → 21 → 22 → 23 briefs uses `remainingDates[]` and `feeRate` config in context, not separate dispatch cycles per date.

## Multi-Statement Database Operations Need Transaction Wrapping

**Cascade deletes and other multi-statement DB operations must be wrapped in explicit transactions (BEGIN/COMMIT).** Without transaction boundaries, a failure mid-cascade (e.g., network timeout after 3 of 5 deletes) leaves the database in an inconsistent state. The cost of a rollback is negligible compared to the risk of orphaned records. Always wrap related statements in a single transaction, especially for cascading or dependent operations.

## HTTP Authentication: Headers Over Request Bodies

**Use HTTP headers for authentication (Authorization, X-BTC-Signature, etc.), never request bodies.** Proxies, CDNs, and some client libraries may strip or modify request bodies; headers are guaranteed to pass through. Additionally, HTTP spec reserves the request body for entity data, not metadata. When designing authenticated endpoints, pull credentials from headers and document this clearly; if legacy code passes auth in body, migrate it.

## API Validation at Boundary Only; Avoid Duplication in Handlers

**Validate all inputs once at the API route boundary; do not re-validate the same inputs in downstream handlers (middleware, services, ORMs).** Duplicate validation creates divergence bugs: if route validation uses one ruleset and a handler uses another (even slightly different), requests can pass one check but fail another, leading to confusing errors and hard-to-test edge cases. Single source of truth for validation: the route layer.

## Editorial Standards: Structured 6-Gate Flowchart Pattern

**Use a structured flowchart for editorial review to prevent ad-hoc judgment and ensure reproducible decisions.** Gate sequence: (1) instant rejection categories (insufficient content, changelogs, bug reports, raw data, duplicates, self-promo), (2) beat volume caps (Bitcoin Macro: 2, others: 3, Security: uncapped), (3) yellow flags requesting revision (one-sided, single-source extraordinary claims, wrong beat, truncation), (4) structure check (claim + evidence + implication required), (5) favored content categories (market shifts, security, new capabilities, economic data, protocol upgrades), (6) position diversity targets (40% bullish / 30% neutral / 20% bearish / 10% contrarian to prevent skew). Stop at the first gate that triggers. This pattern applies to any editorial system with multiple gatekeepers and content types.

## Correspondent Tracking Thresholds

**After a content contributor reaches a threshold of ~10 approved items, begin tracking their metadata: rejection rate (flag if >50%), thesis originality (unique angles vs. restatement), source diversity (same source repeated = lower trust), and beat concentration.** This creates accountability without micromanaging individual submissions and surfaces patterns that individual reviews might miss. Useful for any system aggregating content from multiple external sources.

## Feedback → Skill Documentation Loop Ensures Agent Execution

**User feedback only affects agent behavior during dispatch if it is codified into operational skill documentation (SKILL.md or the relevant operational guide), not merely stored in memory.** Feedback that reaches only memory notes is often ignored because agents executing a task load the task's skill context, not the full memory archive. Pattern: Extract user feedback → translate into concrete operational rules/gates/templates → document in SKILL.md → agents executing that skill load the documentation and apply it. Without this loop, feedback produces no behavioral change.

## Bulk Task Blocking for Systemic Infrastructure Failures

**When a systemic infrastructure issue (relay circuit breaker, mempool saturation, service outage) affects multiple pending tasks, proactively block all related tasks upfront instead of letting each fail individually.** Bulk blocking prevents retry storms, preserves dispatch queue clarity, and makes the impact visible immediately. Example: when x402 relay circuit breaker opens, block all on-chain messaging tasks (#427–#437) at once rather than waiting for 30+ serial failures. Pair with an escalation to the human operator. **When bulk-blocking affects 20+ tasks, also consider a secondary escalation** if the primary escalation remains unresolved beyond the initial SLA window — this ensures human visibility of the cascading impact and signals that single-remediation attempts may be insufficient.

## Circuit Breaker Escalation Threshold: 60 Minutes

**When a circuit breaker or critical infrastructure health indicator remains in a failed state for >60 minutes despite repeated operational attempts (retries, nonce re-syncs), escalate to the human operator.** This signals saturation or resource exhaustion beyond what automated retry logic can resolve. Do not retry beyond the 60-minute threshold; escalation is required for manual intervention (restart, resource reallocation, external service recovery). Example: x402 relay circuit breaker open 88+ minutes requires operator escalation, not continued task queueing.

## Multi-Tier Escalation Protocol: Secondary and Tertiary When Operator SLA Exceeded

**When a P1 infrastructure escalation reaches 60 minutes unresolved, create a secondary escalation immediately** (do not wait for the 90-minute window). This ensures adequate time for the secondary→tertiary cascade if the issue persists. If secondary remains unresolved for 60 min, create tertiary. This ladder ensures visibility escalates with each tier: primary (internal ops queue, 15–30 min SLA) → secondary (higher visibility, 60 min SLA) → tertiary (emergency/manual intervention, 120 min cumulative). Include: original escalation ID(s), cumulative duration, affected task count, last-known failure timestamp. Example: #2583 (17:22Z, nonce stuck) unresolved 58 min → #2627 (18:20Z, secondary created); #2627 unresolved 65 min → #2628 (19:25Z, tertiary scheduled). If tertiary remains unresolved beyond 60 min, escalate to manual infrastructure team with full incident timeline. **If 3+ escalations in sequence all remain unresolved without documented operator acknowledgment, suspect escalation notification delivery failure (not slow response).** Verify escalation task was created, notification endpoint is reachable, and consider out-of-band notification verification before continuing the escalation chain. **Escalation timing precision matters:** secondary must be created at exactly 60 min to allow tertiary window before the 120-min mark. Avoid the "60–90 min window" vagueness; trigger secondary at 60 min when primary escalation remains active and unresolved.

## Circuit Breaker Cooldown State vs. Underlying Issue Resolution

**Circuit breakers can remain open on automatic cooldown even after the underlying infrastructure issue resolves.** When investigating CB failures, check both independently: (1) underlying infrastructure health (mempool depth, pool availability, conflict rate), (2) CB state (circuitBreakerOpen flag, lastConflictAt timestamp). If mempool is cleared (0 pending, no gaps) but CB still open, check whether `lastConflictAt` is stale (>15 min old) vs. being continuously updated by fresh conflicts. If stale, await natural CB reset. If the timestamp is fresh and being continuously refreshed by new conflicts despite clean mempool, the relay is stuck in a conflict loop — escalate immediately for ops intervention (restart/CB state reset). **For multi-wallet relays: per-wallet CBs can heal while the aggregate CB remains open if other users' conflicts persist.** Per-wallet health (circuitBreakerOpen=false) does not mean your sends will succeed if the aggregate CB is open due to external conflicts. Verify both independently before resuming operations.

## Task Taxonomy: Selective Blocking by Infrastructure Dependency

**When infrastructure fails, classify tasks by their dependency: infrastructure-dependent tasks (on-chain sends, relay operations) vs. independent tasks (editorial review, local processing).** Block only the dependent tasks and create a single follow-up after recovery. Leave independent work unfrozen to maintain editorial productivity and non-blockchain throughput. Example: during relay outage, block all notify/ERC-8004 tasks but allow signal review (#433) to continue.

## Sponsor Nonce vs. Sender Wallet Nonce: Independent State Verification

**Relay-based transaction systems track nonce state at two independent layers: the relay sponsor's nonce (pool-wide) and each sender wallet's nonce (account-specific).** These can diverge. When diagnosing nonce-related failures, check both: (1) sponsor nonce state (`lastExecutedNonce`, `nextNonce`, mempool pending), (2) sender wallet nonce state via the relay's `/nonce` v2 endpoint and local nonce-manager. A "healthy" sponsor (capacity 200/200, no pending, no gaps) does not mean individual sender nonces are correct. If a sender is rejected with SENDER_NONCE_STALE despite matching your local tracking, query the relay's authoritative nonce endpoint to identify divergence. **Wave 2 pattern:** After recovering from CB failure via sponsor-side RBF, monitor for a second wave within 15–30 minutes driven by sender-side nonce conflicts. The prerequisite recovery sequence must verify sender wallet nonce state against the chain (via authoritative relay endpoint) before resuming sends, not just sponsor-side state.

## Relay Internal Sender Cache Staleness: Three-Way Verification & Early Escalation

**When a relay rejects a sender nonce with SENDER_NONCE_STALE despite both the chain (Hiro) and local nonce-manager confirming the nonce is correct, the relay has a stale internal sender cache—not an account state problem.** Run a three-way verification: (1) on-chain authority (query Hiro for the sender's last-executed nonce and on-chain state), (2) local tracking (nonce-manager state), (3) relay acceptance (attempt to send). If Hiro and local-state match but relay rejects, the relay's internal cache is diverged. **Do not retry or attempt autonomous fixes** — relay internal caches cannot be cleared by local operations. Escalate immediately with the blocked task count ("50 tasks blocked, relay cache stale for SP1K"). This is a service-level issue requiring operator intervention (cache flush or service restart). Cache issues will exhaust the full escalation chain (primary → secondary → tertiary) because no dispatch operation can resolve them. Escalation timing correctly exposes the issue within 2 hours, but resolution requires operator manual intervention.

## RBF Operations as Circuit Breaker Conflict Generators

**Using automated nonce-reset or RBF endpoints (e.g., `/nonce/reset`) to fix stuck transactions generates new conflicts on the relay's conflict counter, potentially keeping the aggregate circuit breaker open even after the underlying nonce state heals.** Each RBF is counted as a conflict, especially if multiple wallets are RBF'd simultaneously. Plan for a waiting period after bulk RBF operations before resuming normal sends; do not expect the CB to immediately reset despite clean infrastructure state. If CB remains open after RBF cleanup, the wait for natural CB decay is part of recovery, not a sign of failure.

## Stale Incident Memory Blocking Tasks Unnecessarily

**When tasks are repeatedly failing with the same symptom and an incident memory entry recommends a workaround (e.g., "omit --sponsored flag"), verify whether the root cause has been fixed upstream before propagating the workaround further.** Check: (1) incident creation date (if >24h old, verify the fix status), (2) whether code changes mentioned in related task history have been deployed, (3) test the originally-failing command with current code. If the fix exists and the workaround is stale, update the incident memory to mark it RESOLVED with the fix reference. This prevents new tasks from being unnecessarily blocked by solved issues. Example: task #3385 was blocked by stale incident memory recommending non-sponsored reputation feedback; task #3386 verified the sponsor-builder.ts 0x prefix fix had resolved the issue, updated the incident, and unblocked follow-up #3389.

## Rate Limiting During Cascading Infrastructure Crises

**When 429 rate limiting appears during an infrastructure crisis (e.g., nonce stuck, relay cache stale, circuit breaker open), it is a secondary symptom of accumulated retry attempts from multiple blocked tasks.** Do not treat 429 as the primary issue; focus remediation on the root cause (stuck nonce, relay cache, circuit breaker). Rate limiting will naturally clear as blocked task retry volume decreases after the root cause is addressed. Attempting to work around 429 with backoff delays prolongs the crisis by preventing timely escalation of the underlying issue.

## Relay Failure Cascade: Individual Errors to Service Unavailability

**When a relay receives repeated failures from a single sender (e.g., SENDER_NONCE_STALE errors), it accumulates conflicts in its circuit breaker counter. If the conflict rate stays high, the CB opens, which is initially survivable (rejectsFast, CB auto-cooldown). But if underlying sender state remains diverged and conflicts keep regenerating, the CB can stay open → escalate to stuck reachability (relay becomes "The operation was aborted" unreachable) → full service outage.** Remediation differs at each stage: (1) SENDER_NONCE_STALE errors → verify sender nonce vs. chain authoritative state; (2) CB open but reachable → wait for CB cooldown + verify conflicts are not being regenerated; (3) relay unreachable → escalate to operator immediately, do not retry. If you're in stage 2 and attempted remediation (nonce sync, waiting) does not stabilize the conflict rate within 15 min, escalate rather than waiting the full 60-min threshold — the cascade suggests a deeper issue (relay bugs, service degradation) requiring human intervention.

## Infrastructure Recovery Stabilization Period

**After recovering from a systemic infrastructure failure, do not immediately resume dependent operations.** Recovery duration depends on outage severity: transient failures (CB opens <30 min) stabilize within 5-30 min; extended outages (4+ hour CB waves) require 80+ min minimum stabilization for settlement handler recovery (relay itself recovers in 30-40 min but settlement service takes much longer). Example: x402 relay CB closed at 01:00Z but settlement handler SETTLEMENT_TIMEOUT errors continued until 04:58Z+ (240+ min total), indicating settlement service recovery has an extended tail beyond relay connectivity. After recovery, hold related tasks in a ready state and monitor for 30 min minimum (transient) or 80+ min (extended), watching for wave 2 recurrence within 15-30 min of apparent recovery.

## Pre-Escalation Diagnostic Checklist

**Before escalating a systemic infrastructure issue, run a quick diagnostic sequence to distinguish transient failures from stuck states:** (1) health check (`relay-diagnostic check-health` for relay issues, equivalent for other services), (2) state verification (sync nonce-manager, confirm sponsor state, check mempool), (3) optional cleanup if safe (RBF any stuck txs). These checks take seconds and reveal whether the issue is self-healing or truly stuck. Only escalate if diagnostics confirm unavailability, a stuck conflict loop, or persistent failures despite cleanup. This gate prevents premature escalations and surfaces issues that can be autonomously resolved.

## Reachability Recovery ≠ Operational Recovery During Multi-Wave Events

**When a relay becomes reachable after an unreachable episode (especially during circuit breaker waves), do NOT assume the internal cache or operational state has recovered.** Reachability (health check succeeds) is a prerequisite for recovery, not evidence of completion. Immediately run a three-way verification: (1) query on-chain nonce via Hiro, (2) compare to nonce-manager state, (3) check relay health including `lastConflictAt` timestamp freshness. If the relay still rejects your nonce despite matching state, the internal cache is stale — do not retry blindly. Monitor for natural cache clearance (typically 5–15 minutes) by watching whether `lastConflictAt` timestamps age naturally or are continuously refreshed by new conflicts. If timestamps are fresh and continuously updating despite clean underlying state, escalate for operator cache flush or restart.

## Service-Level Health Status ≠ Throughput SLA Readiness

**Infrastructure health checks (relay-diagnostic report "healthy=true", circuitBreakerOpen=false) indicate connectivity and basic responsiveness, NOT throughput or latency SLA compliance.** A service can report healthy while operating at marginal capacity (effectiveCapacity=1) or with settlement handlers timing out (SETTLEMENT_TIMEOUT errors despite clean nonce state). After infrastructure recovery from extended outages (especially 4+ hour CB waves), validate operational readiness with actual test sends: (1) execute 3+ test transactions through the affected service path, (2) verify response times meet SLA (<2s for settlement confirmation), (3) confirm zero timeout/rejection errors. Health status is a prerequisite gate; test sends are the true readiness verification. Example: relay-diagnostic reports "healthy=true" and "circuitBreakerOpen=false" but settlement handler times out on test x402 send = still not ready for production traffic despite passing health gate.

## Relay Mempool Visibility Contradiction: Stuck Txs Without Health Visibility

**A relay can report healthy status with clean mempool visibility (no pending nonces, no gaps reported) yet still contain stuck transactions that cause SENDER_NONCE_DUPLICATE rejections.** This indicates a divergence between the relay's health check query and its actual mempool state (possibly due to internal cache staleness on the visibility query separate from the health check itself). When a relay reports no pending nonces but consistently rejects a specific nonce as duplicate: (1) verify the relay lacks automated RBF support (if unavailable, escalate immediately), (2) do not attempt local nonce resyncs — the issue is relay-internal, not account state, (3) escalate for manual operator intervention via relay console mempool inspection or force-clear. Distinguish from sender cache staleness (SENDER_NONCE_STALE despite correct state) — this pattern involves health/visibility outputs being contradictory, not just sender state divergence. Example: relay reports sponsor mempool=[], lastExecuted=82, nextNonce=83, CB closed, healthy=true, but rejects nonce 83 as SENDER_NONCE_DUPLICATE → stuck transaction invisible in health output, requires operator mempool inspection.

## Nonce-Manager Phantom Acquires: Direct State Correction During Recovery

**During nonce desync recovery, do not use nonce-manager's release() API to clear phantom acquires (failed sends that consumed a nonce but never executed on-chain).** The release() function is designed to mark a nonce as successfully executed and automatically bumps nextNonce forward; it cannot distinguish between executed and phantom nonces. When recovering from phantom acquires (e.g., SENDER_NONCE_STALE errors that consumed nonces 84–85 but left them unexecuted), directly edit the state file (nonce-state.json) to reset nextNonce to match on-chain nonce (query Hiro for authoritative state), then verify with a fresh acquire/release cycle on a known-safe nonce. Attempting release() on phantom nonces will cause nextNonce to increment again, breaking the recovery resync. Example: on-chain nonce=84, nonce-manager shows nextNonce=85 with 2 phantom acquires → directly set nextNonce=84 in state file, verify sync, then acquire/release a safe nonce to confirm the API works post-recovery.

## ERC-8004 Reputation Feedback Submission

**ERC-8004 reputation feedback operates independently of x402 relay infrastructure and can proceed even during relay circuit breaker outages.** Use the `send-reputation-feedback.ts` wrapper script in ~/github/aibtcdev/skills with WALLET_PASSWORD environment variable for automatic wallet unlock/lock handling. The wrapper resolves the issue where reputation.ts CLI requires a persistent unlocked wallet state across process boundaries. Direct reputation submissions do not require sponsorship; use non-sponsored transactions (omit `--sponsored` flag) as the sponsored transaction implementation may have issues (malformed transaction payload). ERC-8004 operations are on-chain Stacks contract calls and do not depend on x402 relay health.

## Submodule vs. External Clones: CWD Divergence in Child Processes

**When spawning child processes that change `process.chdir()` (e.g., reputation-runner.ts, CLI wrappers), verify the CWD points to the current, authoritative repo copy, not a stale external clone.** If the same repo is cloned to multiple locations (`~/github/aibtcdev/skills/` vs. `arc-starter/github/aibtcdev/skills/`), child processes may silently load stale code and ignore recent fixes. Symptoms: a fix works in direct CLI calls but fails in child process invocations; no error messages, just divergent behavior. Before debugging, check: (1) what `process.chdir()` path the child process hardcodes, (2) whether that location contains the expected fix, (3) whether a newer copy exists in the submodule/current repo. Update CWD to point to the submodule or current repo's copy, never an external clone. This prevents silent code version divergence that blocks fixes from taking effect.

## Relay Hex Serialization: Prefix Conventions in Binary Data APIs

**External services that handle hex-encoded binary data may have specific prefix expectations.** When integrating with relay or sponsor APIs, verify whether the service expects `0x`-prefixed hex or raw hex. If a relay strips the first 2 characters of hex submissions assuming a `0x` prefix, sending raw hex (without prefix) causes the prefix stripping to consume the version byte instead, resulting in a 1-byte shift in the payload. Symptom: serialized transactions pass local validation but fail at the relay with "Invalid auth type byte 0x00" or similar format errors on sponsored endpoints. **Fix:** ensure the serializer (e.g., `sponsor-builder.ts`) adds the `0x` prefix before submission to the relay's POST `/sponsor` endpoint. This prevents the relay's strip operation from consuming the auth type byte. Task #3386 (2026-03-30) verified this fix resolves reputation --sponsored failures.

## Deprecated Workflow Closure and Migration

**When a workflow is superseded by a new implementation (e.g., old inscription-brief pattern replaced by scripts/inscribe-brief.ts), identify and close all pending tasks using the old workflow rather than reviving them.** The old workflow should not be reused. New tasks reference the new script automatically. This prevents mixing old and new approaches in the queue and ensures consistency. Example: task #6323 (2026-04-14) used deprecated inscription logic; #6324 closed it instead of updating it, establishing scripts/inscribe-brief.ts as the canonical new pattern.

## Inscription UTXO Detection and Protection Before Spending

**Before spending any UTXO in a fund or consolidation script, validate against the inscription index to ensure you are not accidentally burning or moving inscriptions.** Scripts that select UTXOs without inscription awareness (e.g., fund-segwit-from-taproot.ts) can incorrectly classify inscriptions as "non-inscription" and spend them, locking parent inscriptions in unintended states and blocking child inscription workflows. Always query the inscription index during UTXO selection to tag which UTXOs carry inscriptions, then explicitly exclude those from spend candidates. This prevention step costs seconds but avoids recovery incidents. Example: task #3774 (2026-04-01) accidentally spent parent inscription to SegWit, requiring a manual recovery transaction.

## Recovery State Machine for Inscription Parent State Mismatches

**When a parent inscription gets into an unintended state (e.g., sent to SegWit instead of Taproot), the recovery workflow follows a defined sequence: (1) create a low-fee recovery transaction (2–5 sat/vB acceptable; no time pressure), (2) do not wait for confirmation in the current task, (3) create a follow-up task to verify confirmation and restart blocked child workflows.** This deferred-restart pattern keeps the current task lean and ensures child workflows resume only after parent state is fixed on-chain. The follow-up task explicitly depends on confirmation (`scheduled_for` or parent check gate) rather than polling. Example: task #3774 broadcast recovery tx to return parent from P2WPKH to P2TR, then created follow-up #3775 to verify confirmation and restart the 2026-03-31 brief inscription.

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
