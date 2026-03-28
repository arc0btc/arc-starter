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

**When a systemic infrastructure issue (relay circuit breaker, mempool saturation, service outage) affects multiple pending tasks, proactively block all related tasks upfront instead of letting each fail individually.** Bulk blocking prevents retry storms, preserves dispatch queue clarity, and makes the impact visible immediately. Example: when x402 relay circuit breaker opens, block all on-chain messaging tasks (#427–#437) at once rather than waiting for 30+ serial failures. Pair with an escalation to the human operator.

## Circuit Breaker Escalation Threshold: 60 Minutes

**When a circuit breaker or critical infrastructure health indicator remains in a failed state for >60 minutes despite repeated operational attempts (retries, nonce re-syncs), escalate to the human operator.** This signals saturation or resource exhaustion beyond what automated retry logic can resolve. Do not retry beyond the 60-minute threshold; escalation is required for manual intervention (restart, resource reallocation, external service recovery). Example: x402 relay circuit breaker open 88+ minutes requires operator escalation, not continued task queueing.

## Circuit Breaker Cooldown State vs. Underlying Issue Resolution

**Circuit breakers can remain open on automatic cooldown even after the underlying infrastructure issue resolves.** When investigating CB failures, check both independently: (1) underlying infrastructure health (mempool depth, pool availability, conflict rate), (2) CB state (circuitBreakerOpen flag, lastConflictAt timestamp). If mempool is cleared (0 pending, no gaps) but CB still open, check whether `lastConflictAt` is stale (>15 min old) vs. being continuously updated by fresh conflicts. If stale, await natural CB reset. If the timestamp is fresh and being continuously refreshed by new conflicts despite clean mempool, the relay is stuck in a conflict loop — escalate immediately for ops intervention (restart/CB state reset). **For multi-wallet relays: per-wallet CBs can heal while the aggregate CB remains open if other users' conflicts persist.** Per-wallet health (circuitBreakerOpen=false) does not mean your sends will succeed if the aggregate CB is open due to external conflicts. Verify both independently before resuming operations.

## Task Taxonomy: Selective Blocking by Infrastructure Dependency

**When infrastructure fails, classify tasks by their dependency: infrastructure-dependent tasks (on-chain sends, relay operations) vs. independent tasks (editorial review, local processing).** Block only the dependent tasks and create a single follow-up after recovery. Leave independent work unfrozen to maintain editorial productivity and non-blockchain throughput. Example: during relay outage, block all notify/ERC-8004 tasks but allow signal review (#433) to continue.

## Sponsor Nonce vs. Sender Wallet Nonce: Independent State Verification

**Relay-based transaction systems track nonce state at two independent layers: the relay sponsor's nonce (pool-wide) and each sender wallet's nonce (account-specific).** These can diverge. When diagnosing nonce-related failures, check both: (1) sponsor nonce state (`lastExecutedNonce`, `nextNonce`, mempool pending), (2) sender wallet nonce state via the relay's `/nonce` v2 endpoint and local nonce-manager. A "healthy" sponsor (capacity 200/200, no pending, no gaps) does not mean individual sender nonces are correct. If a sender is rejected with SENDER_NONCE_STALE despite matching your local tracking, query the relay's authoritative nonce endpoint to identify divergence. **Wave 2 pattern:** After recovering from CB failure via sponsor-side RBF, monitor for a second wave within 15–30 minutes driven by sender-side nonce conflicts. The prerequisite recovery sequence must verify sender wallet nonce state against the chain (via authoritative relay endpoint) before resuming sends, not just sponsor-side state.

## Relay Internal Sender Cache Staleness: Three-Way Verification & Early Escalation

**When a relay rejects a sender nonce with SENDER_NONCE_STALE despite both the chain (Hiro) and local nonce-manager confirming the nonce is correct, the relay has a stale internal sender cache—not an account state problem.** Run a three-way verification: (1) on-chain authority (query Hiro for the sender's last-executed nonce and on-chain state), (2) local tracking (nonce-manager state), (3) relay acceptance (attempt to send). If Hiro and local-state match but relay rejects, the relay's internal cache is diverged. **Do not retry or attempt autonomous fixes** — relay internal caches cannot be cleared by local operations. Escalate immediately with the blocked task count ("50 tasks blocked, relay cache stale for SP1K"). This is a service-level issue requiring operator intervention (cache flush or service restart). Unlike true nonce desync (which can be recovered via RBF or gap-fill), relay cache issues are binary: either the cache gets cleared or all sends remain blocked.

## RBF Operations as Circuit Breaker Conflict Generators

**Using automated nonce-reset or RBF endpoints (e.g., `/nonce/reset`) to fix stuck transactions generates new conflicts on the relay's conflict counter, potentially keeping the aggregate circuit breaker open even after the underlying nonce state heals.** Each RBF is counted as a conflict, especially if multiple wallets are RBF'd simultaneously. Plan for a waiting period after bulk RBF operations before resuming normal sends; do not expect the CB to immediately reset despite clean infrastructure state. If CB remains open after RBF cleanup, the wait for natural CB decay is part of recovery, not a sign of failure.

## Relay Failure Cascade: Individual Errors to Service Unavailability

**When a relay receives repeated failures from a single sender (e.g., SENDER_NONCE_STALE errors), it accumulates conflicts in its circuit breaker counter. If the conflict rate stays high, the CB opens, which is initially survivable (rejectsFast, CB auto-cooldown). But if underlying sender state remains diverged and conflicts keep regenerating, the CB can stay open → escalate to stuck reachability (relay becomes "The operation was aborted" unreachable) → full service outage.** Remediation differs at each stage: (1) SENDER_NONCE_STALE errors → verify sender nonce vs. chain authoritative state; (2) CB open but reachable → wait for CB cooldown + verify conflicts are not being regenerated; (3) relay unreachable → escalate to operator immediately, do not retry. If you're in stage 2 and attempted remediation (nonce sync, waiting) does not stabilize the conflict rate within 15 min, escalate rather than waiting the full 60-min threshold — the cascade suggests a deeper issue (relay bugs, service degradation) requiring human intervention.

## Infrastructure Recovery Stabilization Period

**After recovering from a systemic infrastructure failure (relay circuit breaker reset, mempool clearance, nonce recovery), do not immediately resume dependent operations.** Infrastructure problems often recur within 5-30 minutes if the underlying cause wasn't fully resolved. Example: x402 relay wave 1 recovery appeared successful (4 stuck nonces RBF'd, all confirmed, mempool cleared to 0), but wave 2 opened the CB again within 15 minutes, indicating the underlying conflict state was still unstable. After recovery, hold related tasks in a ready state and monitor actively for 15-30 min before resuming sends.

## Pre-Escalation Diagnostic Checklist

**Before escalating a systemic infrastructure issue, run a quick diagnostic sequence to distinguish transient failures from stuck states:** (1) health check (`relay-diagnostic check-health` for relay issues, equivalent for other services), (2) state verification (sync nonce-manager, confirm sponsor state, check mempool), (3) optional cleanup if safe (RBF any stuck txs). These checks take seconds and reveal whether the issue is self-healing or truly stuck. Only escalate if diagnostics confirm unavailability, a stuck conflict loop, or persistent failures despite cleanup. This gate prevents premature escalations and surfaces issues that can be autonomously resolved.

## Reachability Recovery ≠ Operational Recovery During Multi-Wave Events

**When a relay becomes reachable after an unreachable episode (especially during circuit breaker waves), do NOT assume the internal cache or operational state has recovered.** Reachability (health check succeeds) is a prerequisite for recovery, not evidence of completion. Immediately run a three-way verification: (1) query on-chain nonce via Hiro, (2) compare to nonce-manager state, (3) check relay health including `lastConflictAt` timestamp freshness. If the relay still rejects your nonce despite matching state, the internal cache is stale — do not retry blindly. Monitor for natural cache clearance (typically 5–15 minutes) by watching whether `lastConflictAt` timestamps age naturally or are continuously refreshed by new conflicts. If timestamps are fresh and continuously updating despite clean underlying state, escalate for operator cache flush or restart.

## ERC-8004 Reputation Feedback Submission

**ERC-8004 reputation feedback operates independently of x402 relay infrastructure and can proceed even during relay circuit breaker outages.** Use the `send-reputation-feedback.ts` wrapper script in ~/github/aibtcdev/skills with WALLET_PASSWORD environment variable for automatic wallet unlock/lock handling. The wrapper resolves the issue where reputation.ts CLI requires a persistent unlocked wallet state across process boundaries. Direct reputation submissions do not require sponsorship; use non-sponsored transactions (omit `--sponsored` flag) as the sponsored transaction implementation may have issues (malformed transaction payload). ERC-8004 operations are on-chain Stacks contract calls and do not depend on x402 relay health.

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
