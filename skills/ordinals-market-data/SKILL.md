---
name: ordinals-market-data
description: Fetches diverse ordinals market data (inscriptions, BRC-20, NFT floors, fee market) — signal filing SUSPENDED (beat scope mismatch)
tags:
  - ordinals
  - signals
  - publishing
---

# Ordinals Market Data

Automated sensor that fetches diverse on-chain and market data, rotating through five categories. Stores rolling history (last 6 readings per category) for delta computation and cross-category context.

**STATUS: Signal filing SUSPENDED.** The original `ordinals` beat was renamed to `agent-trading` (PR #314) with a scope change — agent-trading now requires AIBTC-network-specific data (PSBTs, x402 flows, on-chain agent positions), not external market data from CoinGecko/Unisat/mempool.space. Data collection continues for cross-category context. Set `SIGNAL_FILING_SUSPENDED = false` in sensor.ts to re-enable after Arc claims a suitable beat or the sensor is repurposed for AIBTC-network data.

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

When the `nft-floors` category is fetched, the sensor also checks for collection-level events. These are high-signal, low-frequency events queued at **P5**, bypassing the regular 4-hour cooldown. Collection history is stored per-collection in hook state and accumulates regardless of whether the aggregate floor signal fires.

| Event Type | Threshold | Tags |
|------------|-----------|------|
| Floor break | >25% floor drop vs prior reading | `floor-break` |
| Floor surge | >25% floor rise vs prior reading | `floor-surge` |
| Volume spike | >3x rolling average 24h volume | `volume-spike` |

- **Source keys:** `sensor:ordinals-market-data:collection-event-<collectionId>-<eventType>` (e.g. `collection-event-bitcoin-frogs-floor-break`)
- **Cooldown:** 24 hours per collection+event pair, enforced via `state.lastCollectionEvents`
- **History:** Per-collection reading arrays (`collectionHistory`) — max 8 readings, used for rolling average volume and prior-floor comparison
- **Tracked collections:** bitcoin-frogs, nodemonkes, bitcoin-puppets (same as aggregate NFT floors)

## Milestone Detection (Phase 2)

When the `inscriptions` category is fetched, the sensor also checks for milestone events. Milestone signals are queued at **P5** and bypass the normal cooldown — they fire immediately on detection.

| Milestone Type | Threshold | Source Key |
|----------------|-----------|------------|
| Round-number crossing | Every 5M inscriptions (5M, 10M, 15M…) | `sensor:ordinals-market-data:milestone-inscriptions-<value>` |
| High inscription rate | >100k/day sustained for 3 consecutive readings | `sensor:ordinals-market-data:milestone-rate-high` |
| Low inscription rate | <10k/day sustained for 3 consecutive readings | `sensor:ordinals-market-data:milestone-rate-low` |

- **Round-number milestones** are inherently unique — each crossing fires at most once (source key includes the milestone value).
- **Rate milestones** have a 24-hour cooldown per type to prevent repeated same-condition signals.
- Rate is computed as inscriptions-per-day between consecutive `inscriptions` history readings.
- Both types respect the daily signal cap (6/day).

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
