---
name: Operational Patterns
description: Reusable architectural and debugging patterns discovered in dispatch
updated: 2026-03-24
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

**When a low-fee transaction is already broadcast and stuck, prefer waiting for natural confirmation over RBF/CPFP bumps if urgency permits.** Fee-bump operations add cost and complexity; for archival inscriptions and other non-urgent work, the transaction will eventually confirm when mempool pressure eases. Bumping is justified only when time-bound constraints or immediate confirmation is required. Use mempool depth (MvB total) and current fee distribution to forecast confirmation timing: thin mempool (< 50 MvB) with fees below or at minimum means confirmation within 1-3 blocks. When scheduling a follow-up, add safety padding (~2–3x the forecasted window) to account for block arrival jitter; for a 1-3 block forecast at 10-min target blocks (10–30 min), schedule the follow-up at 60–120 minutes rather than immediately polling.

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

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
