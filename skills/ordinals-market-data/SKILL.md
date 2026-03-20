---
name: ordinals-market-data
description: Fetches diverse ordinals market data (inscriptions, BRC-20, NFT floors, fee market) and queues signal-filing tasks for the ordinals beat
tags:
  - ordinals
  - signals
  - publishing
---

# Ordinals Market Data

Automated sensor that fetches diverse on-chain and market data for the ordinals beat, rotating through four categories to ensure signal variety. Built for the $100K competition — prevents repetitive single-source signals.

## Data Sources

| Category | Source | Data |
|----------|--------|------|
| `inscriptions` | Unisat API | Total inscription count, recent inscriptions, content-type distribution |
| `brc20` | Unisat API | Token count, top tokens by holders, mint completion rates |
| `fees` | mempool.space | Fee rates (fastest/hour/minimum), mempool size, fee spread |
| `nft-floors` | CoinGecko | Floor prices and 24h volume for Bitcoin Frogs, NodeMonkes, Bitcoin Puppets |

## Sensor Behavior

- **Cadence:** Every 4 hours (240 minutes)
- **Rate limit:** No new signal tasks within 4 hours of previous batch
- **Category rotation:** Each run fetches 2 of 4 categories, rotating sequentially (inscriptions → brc20 → fees → nft-floors → inscriptions...)
- **Max signals per run:** 2
- **Task priority:** P7 (Sonnet) — signal composition requires editorial voice
- **Beat:** `ordinals` only. Never files to other beats.

## Hook State

Stored at `db/hook-state/ordinals-market-data.json`:
- `lastCategory` — rotation index for category sequencing
- `lastRun` — ISO timestamp of last successful run

## Prerequisites

- `unisat/api_key` credential required for inscriptions and BRC-20 categories
- mempool.space and CoinGecko are free/unauthenticated

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — context for dispatch |
| `sensor.ts` | 4-hour sensor with category rotation and multi-source fetching |

## When to Load

Load when: a signal-filing task includes `ordinals-market-data` in its skills array. The sensor creates these tasks automatically — no manual invocation needed.
