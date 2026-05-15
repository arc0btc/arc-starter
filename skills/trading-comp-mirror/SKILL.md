---
name: trading-comp-mirror
description: Competitor trade watcher for the AIBTC Trading Competition — polls each tracked competitor's trade history, detects new trades, and caches them locally for pair-frequency analysis
updated: 2026-05-15
tags:
  - defi
  - trading
  - competition
  - sensor
  - aibtc-network
  - mainnet-only
---

# trading-comp-mirror

Sensor + CLI for mirroring competitor activity in the AIBTC Trading Competition. Part of the `trading-comp` build order (build #2).

**Role in build order:**
- `trading-comp` (#1) — submit primitive + metrics (Arc's own trades)
- `trading-comp-mirror` (#2) — this skill; competitor trade watcher **← here**
- `trading-comp-pairs` (#3) — token pair allowlist watcher (consumes mirror data)
- `trading-comp-ecosystem` (#4) — Stacks X/website listener
- `leaderboard-delta` (#5) — rank tracker
- Post-settlement eval (#6) — campaign close ~2026-05-20T19:30Z

## Storage

| File | Purpose |
|------|---------|
| `skills/trading-comp-mirror/competitors.json` | Config: `[{address, label}]`. Edit directly or use CLI. |
| `skills/trading-comp-mirror/trades.json` | Trade cache: last 500 trades detected, newest first. Written by sensor, read by CLI. |
| `db/hook-state/trading-comp-mirror.json` | Sensor state: `seen_txids` per competitor address (bounded to last 200/addr), timing. |

## Sensor Behavior

Cadence: **10 minutes**.

Each run:
1. Loads `competitors.json` — skips with `"skip"` if the file is empty or missing.
2. Polls `GET /api/competition/trades?address=<addr>&limit=50` for each competitor.
3. Compares returned txids against `seen_txids` in hook state.
4. Appends genuinely new trades to `trades.json`, keeps newest 500.
5. Updates hook state (`seen_txids` capped at 200/addr to bound memory).

Rate limit: 300 reads/min per IP — polling N competitors at 10-min cadence is well inside this.

## CLI Commands

```
arc skills run --name trading-comp-mirror -- list [--limit N] [--competitor <addr|label>] [--since YYYY-MM-DD]
arc skills run --name trading-comp-mirror -- stats [--days N]
arc skills run --name trading-comp-mirror -- competitors
arc skills run --name trading-comp-mirror -- add-competitor --address <STX_addr> --label <name>
arc skills run --name trading-comp-mirror -- remove-competitor --address <STX_addr>
```

### `list`

Prints recent cached trades. Default limit: 20. Filter by competitor address or label (`--competitor`). Filter by detection date (`--since YYYY-MM-DD`).

### `stats`

Pair-frequency table across all competitors for the last N days (default 7). Groups trades by `token_in → token_out`, shows count and competitor breakdown.

### `competitors`

Prints `competitors.json` in a readable table.

### `add-competitor` / `remove-competitor`

Mutates `competitors.json`. New competitors are polled on the next sensor run.

## Trade Record Schema

```typescript
interface TradeRecord {
  txid: string;               // 0x + 64 hex chars, lowercase
  competitor_address: string;
  competitor_label: string;
  token_in: string;           // contract_id or token symbol from API
  token_out: string;
  amount_in: string;
  amount_out: string;
  burn_block_time: number;    // Unix timestamp from Stacks chain
  tx_status: string;          // "success" | "abort_by_response" | etc.
  detected_at: string;        // ISO-8601, when Arc's sensor first saw this trade
}
```

## When to Load

Load when: analyzing competitor behavior, updating the competitor watch list, or triaging sensor output. Do NOT load for Arc's own trade submission (`trading-comp`) or one-off txid submissions (`competition`).

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] `competitors.json` seeded with known competitors
- [x] `trades.json` placeholder present
- [x] `sensor.ts` exports async default returning `Promise<string>`
- [x] `cli.ts` runs without error
- [ ] `AGENT.md` covers prerequisites and gotchas
