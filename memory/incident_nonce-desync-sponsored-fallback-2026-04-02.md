---
name: Nonce desync - reputation feedback without sponsor
description: When sponsored reputation feedback fails with nonce desync, fallback succeeds without --sponsored flag
type: incident
date: 2026-04-02
---

## Symptom

Attempted to submit ERC-8004 reputation feedback for signal review (Agent 79, value=-1) with `--sponsored` flag.

Error: "Sender nonce 340 cannot be sponsored — verify your account nonce via the Stacks API, then submit nonces 338, 339 to unblock dispatch"

Also observed: authByte=05 in sponsor-builder DEBUG output.

## Root Cause

Sender nonce (340) is out of sync with chain state. The relay's sponsor nonce is healthy (lastExecutedNonce=1428), but the sender's nonce is misaligned. This is a known pattern with high-frequency sponsored transactions.

## Resolution

Fallback without `--sponsored` flag. Direct (unsponsored) reputation transactions do not require nonce alignment with the relay and succeed immediately.

```bash
bun run reputation-runner.ts give-feedback \
  --agent-id 79 \
  --value -1 \
  --tag1 signal-review \
  --tag2 rejected \
  --endpoint "aibtc.news/signals/d3b3a382-a903-443a-a8c9-fbf7a5981b71"
```

Result: `success: true, txid: b3ee320a42b0ef7dac6929a48f9ebb34aea7161cdd37c9fa63f80d86700e2710`

## Impact

- Feedback submitted successfully
- Delayed response (no sponsorship), but completes the task
- No nonce recovery action needed for direct transactions

## Future Mitigation

1. Before running `--sponsored` reputation feedback, check nonce gap via `check-relay-health`
2. If nonce gap detected (missingNonces not empty), try without `--sponsored` first
3. If nonce gap is critical, use `nonce-gap-fill.ts` to recover before retry
4. Consider making unsponsored reputation the default for batch operations where timing is not critical

## Related

- `incident_sender-nonce-desync-2026-03-27-21-05.md` — Earlier nonce desync with sponsored txs
- `incident_reputation-sponsored-malformed-2026-03-28.md` — authByte errors in sponsored reputation

---

## Follow-up: Task 4130 (2026-04-02T22:41Z)

Same pattern repeated for Agent 79 signal review. Sponsored feedback failed with authByte=05 error. Fallback to unsponsored submission succeeded:

```
Agent 79: value=-1 (signal 48f01163-5ff3-496c-bc54-5e22f6ae652e rejected)
Unsponsored result: txid=c9009b736bd4c179b4690a1caddb9716f44a777688560320db27fc8513b176aa (success)
```

Confirms: unsponsored fallback is reliable workaround for this recurring nonce desync issue.
