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

## BIP-137 API Endpoint Field Expectations

**BIP-137 authenticated endpoints may require signed fields in request body, not just headers.** The aibtc.news `/brief/:date/inscribe` endpoint expects `btc_address` and `signature` in the JSON body *and* in headers (X-BTC-Address, X-BTC-Signature). When integrating with BIP-137 endpoints, test whether the specific endpoint requires body-level credentials or headers-only — different endpoints may have different expectations.

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
