---
name: x402 client upgrade plan (post relay v1.26.1)
description: Client-side changes needed to handle pending payment status and async confirmation after relay PR #258/#261 and frontend settlement poll reduction
type: project
---

# x402 Client Upgrade Plan

**Context:** Relay v1.26.1 (PRs #258, #261) fixed sponsor nonce pool issues. Frontend now returns `201 + paymentStatus:"pending"` instead of SETTLEMENT_TIMEOUT errors when relay accepts but on-chain confirmation times out. Response latency dropped from ~26s to ~6s. New `GET /api/payment-status/{paymentId}` endpoint available for async confirmation.

**Why:** Our client currently treats all 200/201 responses as fully confirmed. With the new pending status, we can:
1. Avoid false "confirmed" signals when payment is still settling
2. Track pending payments and confirm them asynchronously
3. Eliminate the 24s timeout bottleneck in batch sends (5s delay between messages was already close to Stacks block time)

**How to apply:** Three tiers of changes, from minimal to full.

## Tier 1: Minimal (works today, no code changes)

The server now returns 201 instead of erroring on settlement timeout. Our `x402.ts` already treats 201 as success. Sends will succeed where they previously failed. The `payment-response` header will contain the settlement info (possibly pending). **This is already functional.**

## Tier 2: Awareness (small code change)

In `x402.ts` (send-inbox-message handler, ~line 597):
- Parse response body for `paymentId` and `paymentStatus` fields
- When `paymentStatus === "pending"`, include both in output JSON
- Log pending vs confirmed distinction

In `inbox-notify/cli.ts` (BatchState type):
- Add optional `paymentId` and `paymentStatus` fields to batch message state
- Store them on successful send so batch state tracks which payments need confirmation

## Tier 3: Full (new command + sensor)

Add `confirm-payments` command to inbox-notify:
- Reads batch state files with `paymentStatus: "pending"` entries
- Polls `GET /api/payment-status/{paymentId}` for each
- Updates batch state with confirmed txid
- Could run as a follow-up task after batch send completes

Optional sensor: periodic check for unconfirmed payments older than N minutes.

## Error Detection Updates

In `inbox-notify/cli.ts`:
- `SETTLEMENT_TIMEOUT` should now be rare (only when relay itself rejects, not poll exhaustion)
- `isRelayTransient()` can keep checking for it but it won't be the primary failure mode
- Consider adding `paymentStatus` awareness to success detection

## Batch Timing

With 6s server response (down from 26s), the 5s `POST_SEND_DELAY_MS` between messages is well-matched to Stacks 3-5s block times. No change needed.
