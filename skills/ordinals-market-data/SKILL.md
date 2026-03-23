---
name: ordinals-market-data
description: Fetches diverse ordinals market data (inscriptions, BRC-20, NFT floors, fee market) and queues signal-filing tasks for the ordinals beat
tags:
  - ordinals
  - signals
  - publishing
---

# Ordinals Market Data

Automated sensor that fetches diverse on-chain and market data for the ordinals beat, rotating through five categories to ensure signal variety. Built for the $100K competition — prevents repetitive single-source signals. Stores rolling history (last 6 readings per category) for delta computation and trend analysis.

## Data Sources

| Category | Source | Data |
|----------|--------|------|
| `inscriptions` | Unisat API | Total inscription count, recent inscriptions, content-type distribution |
| `brc20` | Unisat API | Token count, top tokens by holders, mint completion rates |
| `fees` | mempool.space | Fee rates (fastest/hour/minimum), mempool size, fee spread |
| `nft-floors` | CoinGecko | Floor prices and 24h volume for Bitcoin Frogs, NodeMonkes, Bitcoin Puppets |
| `runes` | Unisat API | Rune count, top-10 by holders, etching activity. Change-detection: new top-10 entrant or >10% holder shift |

## Sensor Behavior

- **Cadence:** Every 4 hours (240 minutes)
- **Rate limit:** No new signal tasks within 4 hours of previous batch
- **Category rotation:** Each run fetches 2 of 5 categories, rotating sequentially (inscriptions → brc20 → fees → nft-floors → runes → inscriptions...)
- **Angle rotation:** Each run assigns 1 of 4 analytical angles, rotating independently of category (trend → comparison → anomaly → structure → trend...)
- **Max signals per run:** 1
- **Task priority:** P7 (Sonnet) — signal composition requires editorial voice
- **Beat:** `ordinals` only. Never files to other beats.

## Analytical Angles

Each signal task includes an angle directive that tells the composing LLM which analytical lens to apply. Angles rotate independently of categories, producing 16 unique category×angle combinations.

| Angle | Focus | Key Language |
|-------|-------|-------------|
| `trend` | Multi-reading direction and momentum | accelerating, decelerating, reversing, sustaining |
| `comparison` | Cross-category relative performance | ratios, spreads, divergences, outperforming |
| `anomaly` | Deviation from typical ranges | outlier, deviation, unprecedented, atypical |
| `structure` | Concentration, distribution, microstructure | consolidating, fragmenting, deepening, thinning |

## Historical Data Layer

Each category stores a rolling window of the last 6 readings in hook state (`history` field). Each reading captures:
- **Timestamp** — ISO 8601, for trend duration calculation
- **Metrics** — flat `Record<string, number>` of key values for the category

**Tracked metrics per category:**

| Category | Metrics Stored |
|----------|---------------|
| `inscriptions` | `totalInscriptions`, `tokenCount` |
| `brc20` | `totalTokens`, `holders_<ticker>` for top 5 tokens |
| `fees` | `fastestFee`, `hourFee`, `minimumFee`, `mempoolSize`, `feeSpread` |
| `nft-floors` | `totalVolume`, `floor_<collection>`, `volume_<collection>` |
| `runes` | `totalRunes`, `etchingCount`, `holders_<runeName>` for top 5 |

**Delta computation:** Before storing each new reading, deltas are computed against the most recent stored reading. Deltas include absolute change, percentage change, and trend duration (ms since prior reading). Delta summaries are appended to signal evidence text.

## Hook State

Stored at `db/hook-state/ordinals-market-data.json`:
- `lastCategory` — rotation index for category sequencing
- `lastAngle` — rotation index for angle sequencing
- `lastRun` — ISO timestamp of last successful run
- `lastRuneTopIds` — top-10 rune IDs for rune change-detection
- `lastRuneHolders` — runeId → holderCount for rune change-detection
- `history` — `CategoryHistory` object with rolling arrays per category (max 6 entries each)

## Prerequisites

- `unisat/api_key` credential required for inscriptions, BRC-20, and runes categories
- mempool.space and CoinGecko are free/unauthenticated

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — context for dispatch |
| `sensor.ts` | 4-hour sensor with category rotation and multi-source fetching |

## When to Load

Load when: a signal-filing task includes `ordinals-market-data` in its skills array. The sensor creates these tasks automatically — no manual invocation needed.
