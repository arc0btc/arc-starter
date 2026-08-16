---
name: ordinals-market-data
description: Fetches diverse ordinals market data (inscriptions, BRC-20, NFT floors, fee market) — SENSOR DISABLED (no consumer since 2026-03-26)
tags:
  - ordinals
  - signals
  - publishing
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
---

# Ordinals Market Data

Automated sensor that fetches diverse on-chain and market data, rotating through five categories. Stores rolling history (last 6 readings per category) for delta computation and cross-category context.

**STATUS: SENSOR DISABLED (2026-07-17, control-plane-remediation P4, defect-register row 15).** Signal filing was already suspended (beat scope mismatch — see below), no signal queued since 2026-03-26, but the sensor kept fetching all 5 categories every 2h with no consumer. The `$100K competition` this sensor was built for ended 2026-04-22, removing that consumer too. `SENSOR_DISABLED = true` in `sensor.ts` short-circuits the whole tick. Reversal: delete the early return (and flip `SIGNAL_FILING_SUSPENDED = false`) once Arc claims a suitable beat or the sensor is repurposed for AIBTC-network agent-trading data.

**Original suspension reason (still true):** the `ordinals` beat was renamed to `agent-trading` (PR #314) with a scope change — it now requires AIBTC-network-specific data (PSBTs, x402 flows, on-chain agent positions), not external market data from CoinGecko/Unisat/mempool.space.

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
- **Category coverage:** All 5 categories fetched every run — no rotation gap
- **Angle rotation:** Each run assigns 1 of 4 analytical angles, rotating (trend → comparison → anomaly → structure → trend…)
- **Max signals per run:** 1 per category (up to 5 regular) + unlimited milestone signals; bounded by daily allocation cap
- **Task priority:** P7 (Sonnet) for regular signals; **P5** for milestone signals
- **Beat:** `agent-trading` (SUSPENDED — beat scope mismatch, see note above). Data collection only.

## Collection Event Detection (Phase 3)

When `nft-floors` is fetched, the sensor also checks collection-level events — high-signal, low-frequency, queued at **P5**, bypassing the 4h cooldown. Per-collection history accumulates in hook state regardless of whether the aggregate floor signal fires.

- `floor-break`: >25% floor drop vs prior reading. `floor-surge`: >25% floor rise. `volume-spike`: >3x rolling 24h avg volume.
- Source key: `sensor:ordinals-market-data:collection-event-<collectionId>-<eventType>`. Cooldown: 24h per collection+event pair (`state.lastCollectionEvents`).
- History: `collectionHistory`, max 8 readings/collection. Tracked: bitcoin-frogs, nodemonkes, bitcoin-puppets.

## Milestone Detection (Phase 2)

When `inscriptions` is fetched, the sensor also checks milestones. Queued at **P5**, bypassing normal cooldown, firing immediately on detection.

- Round-number crossing: every 5M inscriptions — unique per value, fires at most once (`sensor:ordinals-market-data:milestone-inscriptions-<value>`).
- High/low rate: >100k/day or <10k/day sustained for 3 consecutive readings — 24h cooldown per type (`milestone-rate-high`/`milestone-rate-low`). Rate = inscriptions-per-day between consecutive readings.
- Both respect the daily signal cap (6/day).

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
- `lastInscriptionCount` — inscription count from the most recent successful inscriptions fetch (used for milestone crossing detection)
- `lastRuneTopIds` — top-10 rune IDs for rune change-detection
- `lastRuneHolders` — runeId → holderCount for rune change-detection
- `lastRateMilestoneHigh` — ISO timestamp when last high-rate milestone task was created (24h cooldown)
- `lastRateMilestoneLow` — ISO timestamp when last low-rate milestone task was created (24h cooldown)
- `history` — `CategoryHistory` object with rolling arrays per category (max 6 entries each)
- `collectionHistory` — per-collection reading history: `Record<collectionId, CollectionReading[]>` (max 8 readings each)
- `lastCollectionEvents` — cooldown map: `"<collectionId>-<eventType>" → ISO timestamp` for 24h collection event gates

## Prerequisites

- `unisat/api_key` credential required for inscriptions, BRC-20, and runes categories
- mempool.space and CoinGecko are free/unauthenticated

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — context for dispatch |
| `sensor.ts` | 4-hour sensor with category rotation and multi-source fetching |

## Filing Failures

When the aibtc.news API returns 429 (beat cooldown active, 60-min per-beat rate limit):
- Close the task as **failed** — it cannot file now.
- **Do NOT create a retry task.** The sensor runs every 4 hours and will re-queue a fresh signal after the cooldown expires. Manual retries create duplicate tasks that also fail.
- Include the cooldown remaining time in the failure summary so the next dispatch can skip it if another task appeared.

These cooldown-hit failures inflate the skill's completion rate metric but are expected behavior — they represent valid data that arrived inside the 60-min window.

## When to Load

Load when: a signal-filing task includes `ordinals-market-data` in its skills array. The sensor creates these tasks automatically — no manual invocation needed.
