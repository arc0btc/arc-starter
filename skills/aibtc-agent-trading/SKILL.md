---
name: aibtc-agent-trading
description: Detects AIBTC-network agent trading activity from JingSwap cycles and P2P ordinals desk for agent-trading beat signals
tags:
  - signals
  - publishing
  - defi
---

# AIBTC Agent Trading Sensor

Automated sensor that monitors AIBTC-network-native trading activity and queues signal-filing tasks for the `agent-trading` beat. Uses network-internal data sources only — no external market data (CoinGecko, Unisat, mempool.space).

## Data Sources

| Source | API | Data |
|--------|-----|------|
| JingSwap (sBTC/STX) | faktory-dao-backend.vercel.app | Cycle state, phase transitions, deposit totals, Pyth oracle + DEX prices |
| JingSwap (sBTC/USDCx) | faktory-dao-backend.vercel.app | Same as above for the USDCx market |
| P2P Ordinals Desk | ledger.drx4.xyz | Trade count, completed trades, volume (sats), PSBT swaps, open offers, active listings |
| Agent Registry | aibtc.news/api/agents | Total registered agent count (delta detection for growth) |

## Sensor Behavior

- **Cadence:** Every 2 hours (120 minutes)
- **All sources fetched every run** — lightweight APIs, no rotation needed
- **Max signals per run:** 1 (strongest or most diverse change)
- **Task priority:** P5 for high-strength signals (>=70), P7 for regular
- **Model:** Sonnet (editorial composition)
- **Beat:** `agent-trading`

## Change Detection

| Signal Type | Trigger | Strength |
|-------------|---------|----------|
| `jingswap-cycle` | Phase transition (deposit→buffer→settle) | 70+ |
| `jingswap-cycle` | Deposit imbalance >30% skew | 60-90 |
| `jingswap-price` | Oracle-DEX spread >5% | 55-85 |
| `p2p-activity` | New completed trades | 50-90 |
| `p2p-activity` | Volume spike >2x prior reading | 65-90 |
| `p2p-activity` | New PSBT swaps (atomic on-chain) | 75-95 |
| `agent-growth` | >5 new agents since last check | 50-90 |
| flat-market | No changes detected | 30 (fallback) |

Signal type diversity is enforced: the sensor prefers a different signal type than the last one filed.

## Hook State

Stored at `db/hook-state/aibtc-agent-trading.json`:

- `history` — Rolling window (max 8 readings) with JingSwap market snapshots, P2P stats, and agent count
- `lastSignalType` — Last signal type queued (for diversity rotation)

## Relationship to ordinals-market-data

The `ordinals-market-data` sensor continues running separately for cross-category context (external data from CoinGecko/Unisat/mempool.space) with signal filing suspended. This sensor replaces it for `agent-trading` beat signal filing using AIBTC-network-native data only.

## When to Load

Load when: a signal-filing task includes `aibtc-agent-trading` in its skills array. The sensor creates these tasks automatically.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — context for dispatch |
| `sensor.ts` | 2-hour sensor with multi-source data collection and change detection |

## Checklist

- [x] `skills/aibtc-agent-trading/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` implements change detection from AIBTC-native data sources
- [x] Signal tasks use `File agent-trading signal:` subject format (matches daily cap counter)
- [x] Daily signal cap (6/day) and beat allocation (3/day) respected
- [x] ordinals-market-data sensor left intact for cross-category context
