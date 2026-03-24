---
name: Operational Patterns
description: Reusable architectural and debugging patterns discovered in dispatch
updated: 2026-03-20
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

**When a low-fee transaction is already broadcast and stuck, prefer waiting for natural confirmation over RBF/CPFP bumps if urgency permits.** Fee-bump operations add cost and complexity; for archival inscriptions and other non-urgent work, the transaction will eventually confirm when mempool pressure eases. Bumping is justified only when time-bound constraints or immediate confirmation is required.

## BIP-137 API Endpoint Field Expectations

**BIP-137 authenticated endpoints may require signed fields in request body, not just headers.** The aibtc.news `/brief/:date/inscribe` endpoint expects `btc_address` and `signature` in the JSON body *and* in headers (X-BTC-Address, X-BTC-Signature). When integrating with BIP-137 endpoints, test whether the specific endpoint requires body-level credentials or headers-only — different endpoints may have different expectations.

## Inscription Parent Dependency Chain

**Child inscriptions require parent returns: when chaining multiple child inscriptions, you cannot start the next commit until the previous reveal confirms and returns the parent inscription to your address.** This is a hard blockchain constraint, not a bug. If the reveal tx is unconfirmed, the parent is temporarily stuck at the reveal address; the next child commit will fail. Rather than blocking the dispatch, create a follow-up task that runs after the previous reveal confirms. Use a low fee and let it confirm naturally if the work is non-urgent.

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
