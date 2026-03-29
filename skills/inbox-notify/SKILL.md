---
name: inbox-notify
description: Batch x402 inbox messaging with local nonce management — reliable delivery for payout confirmations and other notifications
tags:
  - comms
  - x402
  - payments
---

# inbox-notify

Sends batches of x402 inbox messages with **local nonce tracking** to avoid relay nonce conflicts. Designed to run as its own task in the queue rather than inline with other flows.

## Why This Exists

The low-level `send-inbox-message` command fetches its nonce from Hiro on every call. When sending multiple messages in sequence, each call sees the same stale nonce and collides on the relay. This skill seeds the nonce once, increments locally, and waits for confirmation between sends.

## CLI Commands

```
arc skills run --name inbox-notify -- send-batch --file <path>
```

Send all messages defined in a JSON batch file. Tracks progress — safe to re-run on partial failure.

```
arc skills run --name inbox-notify -- send-one --btc-address <addr> --stx-address <addr> --content <text>
```

Send a single message with retry. Useful for one-off notifications.

```
arc skills run --name inbox-notify -- payout-confirmations --date YYYY-MM-DD
```

Read the payout record for a date and send confirmation messages to all correspondents who received payments. Reads from `db/payouts/{date}.json`.

## Batch File Format

```json
{
  "messages": [
    {
      "btc_address": "bc1q...",
      "stx_address": "SP...",
      "content": "Your message here (max 500 chars)",
      "label": "Ionic Nova"
    }
  ]
}
```

```
arc skills run --name inbox-notify -- confirm-payments [--batch-id <id>]
```

Check pending x402 payment confirmations. Polls `GET /api/payment-status/{paymentId}` for messages with `paymentStatus: "pending"`. Without `--batch-id`, scans all batch state files. Updates batch state with confirmed txids.

## Nonce Strategy

1. Fetch sender's nonce once from Hiro API before the batch
2. For each message: build sponsored tx with explicit nonce → send → increment
3. On nonce conflict: wait 5s, re-seed nonce from Hiro, retry (up to 3 attempts)
4. Progress saved to `db/inbox-notify/{batch-id}.json` — re-run resumes from last success

## Integration

Other skills should **not** send x402 messages inline. Instead:
- Create a batch file or queue a task with `--skills inbox-notify`
- The `brief-payout` execute flow queues an inbox-notify task after transfers complete
- Editorial review sends 1 message per dispatch cycle (acceptable inline — no batch risk)

## Dependencies

- **bitcoin-wallet** — wallet unlock, sBTC signing, x402 protocol
