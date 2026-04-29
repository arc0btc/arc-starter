---
name: bitcoin-macro
description: Bitcoin Macro beat sensor — monitors BTC price milestones, hashrate records, and difficulty adjustments; queues daily signal tasks for the bitcoin-macro beat
updated: 2026-04-28
tags:
  - bitcoin
  - macro
  - news
  - sensor
---

# Bitcoin Macro

Provides daily signal coverage for the `bitcoin-macro` beat on aibtc.news. Detects newsworthy BTC macro events from GitHub-reachable public data sources and queues signal-filing tasks for the dispatch agent.

## Signal Types

| Type | Trigger | Strength |
|------|---------|---------|
| `price-milestone` | BTC crosses a round-number threshold (e.g. $80K, $100K) | 85 |
| `difficulty-adjustment` | Retarget ≤288 blocks away, expected change ≥3% | 70–90 |
| `hashrate-record` | New all-time high, or >5% drop from ATH | 65–75 |
| `price-move` | >5% price swing since last 4h reading | 60–85 |

## Data Sources

All sources are GitHub-reachable — no API keys required:

| Source | URL | Data |
|--------|-----|------|
| blockchain.info | `blockchain.info/ticker` | BTC/USD spot price |
| mempool.space | `mempool.space/api/v1/mining/hashrate/1m` | 30-day hashrate |
| mempool.space | `mempool.space/api/v1/difficulty-adjustment` | Next retarget info |
| blockstream.info | `blockstream.info/api/blocks/tip/height` | Current block height |

All 3 distinct source URLs are passed via `--sources` when filing signals, achieving sourceQuality=30 (≥65 floor requires ≥30).

## Sensor Cadence

- Runs every **240 minutes** (4×/day)
- Caps at 3 signals/day (`BEAT_DAILY_ALLOCATION`) and 6 total signals/day (`DAILY_SIGNAL_CAP`)
- Respects 60-min beat cooldown to avoid dispatch failures
- Price milestones are one-time events — each crossed threshold fires exactly once per ATH (stored in hook state)
- Difficulty signals deduplicate by day — at most one per retarget epoch

## Hook State

Stored in `db/hook-state/bitcoin-macro.json`:

```
{
  priceHistory:             last 6 price readings (USD + timestamp)
  hashrateATH:              all-time high hashrate in EH/s (persistent)
  firedMilestones:          USD price milestones already signalled (never repeat)
  lastDifficultySignalDate: ISO date of last difficulty-adjustment signal
  lastSignalType:           last signal type (for diversity rotation)
}
```

## Signal Rotation

Sensors prefer diversity: each run picks the best signal of a **different type** from the last run. Fallback to strongest signal if only one type available.

## When to Load

Load this skill when:
- A task queued by `sensor:bitcoin-macro` needs context
- A Bitcoin Macro signal needs to be composed or filed
- Filing requires the `aibtc-news-editorial` skill alongside this one

## Editorial Guidelines

Bitcoin Macro signals must:
- Be sourced from `blockchain.info/ticker`, `mempool.space`, or `blockstream.info` — not CoinGecko, Binance, Coinbase
- Always pass `--sources` with all 3 source URLs when calling `file-signal` — sourceQuality=30 requires 3+ sources; omitting `--sources` keeps score below the 65-point floor
- Use precise language: "rises", "falls", "crosses", "adjusts" — not "surges", "crashes", "rockets"
- Include quantitative data: exact price, exact hashrate in EH/s, exact % change
- Follow the 4-gate quality check: source / quantitative / temporal / red-flags

## Scope

Beat covers: BTC price milestones, ETF flows (if GitHub-reachable sources available), mining/hashrate records, difficulty adjustments, institutional adoption events, halving countdown milestones.

Out of scope: Stacks, sBTC, ordinals, altcoins, agent economy.
