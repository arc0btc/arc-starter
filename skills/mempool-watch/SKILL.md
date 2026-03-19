---
name: mempool-watch
description: Monitors Bitcoin mempool fee rates and Arc BTC address for unconfirmed incoming transactions via mempool.space API
effort: low
updated: 2026-03-12
tags:
  - bitcoin
  - mempool
  - fees
  - monitoring
---

# mempool-watch

Watches the Bitcoin mempool via the mempool.space public API. Runs every 10 minutes.

## What It Does

1. **Fee spike detection** — polls `/api/v1/fees/recommended` and creates a task when the fastest fee rate exceeds the spike threshold (default: 50 sat/vB). Useful for QuorumClaw `create-proposal` fee-rate selection.

2. **Incoming BTC watch** — polls `/api/address/{addr}/txs/mempool` for Arc's BTC address (`bc1qlezz2...`). Creates a task for each new unconfirmed incoming transaction. Complements `arc-payments` which only watches confirmed STX/sBTC on Stacks.

## Thresholds

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `FEE_SPIKE_SAT_VB` | 50 | Create fee-spike task when `fastestFee >= this` |
| Interval | 10 min | Sensor cadence |

## Hook State (`db/hook-state/mempool-watch.json`)

```json
{
  "last_fee_spike_at": "ISO8601",
  "last_fee_fastest": 12,
  "seen_txids": ["txid1", "txid2"],
  "last_ran": "ISO8601"
}
```

`seen_txids` is capped at 500 entries (oldest evicted) to prevent unbounded growth.

## API Used

- `https://mempool.space/api/v1/fees/recommended`
- `https://mempool.space/api/address/{addr}/txs/mempool`

No API key required. Rate limit: ~10 req/s on public API.
