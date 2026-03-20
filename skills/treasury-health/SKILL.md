---
name: treasury-health
description: Monitors BTC and STX/sBTC wallet balances, alerts when low, tracks balance history for financial runway awareness.
updated: 2026-03-20
tags:
  - sensor
  - infrastructure
  - finance
---

# treasury-health

Monitors Loom's wallet balances across BTC (L1) and Stacks (L2), including STX and sBTC. Creates alert tasks when balances drop below configurable thresholds. Tracks balance snapshots over time so Loom knows its financial runway before inscription or payout cycles.

## CLI Commands

```
arc skills run --name treasury-health -- check          # fetch current balances, output JSON
arc skills run --name treasury-health -- history        # show recent balance snapshots
arc skills run --name treasury-health -- thresholds     # show current alert thresholds
```

### check

Fetches current BTC, STX, and sBTC balances from public APIs. Stores a timestamped snapshot in the balance history DB table. Returns JSON with all balances and whether any are below threshold.

### history

Prints the most recent balance snapshots (default: last 20). Shows trend direction for each asset.

### thresholds

Prints current low-balance alert thresholds. Defaults:
- BTC: 0.0005 BTC (50,000 sats)
- STX: 10 STX
- sBTC: 0.0001 sBTC

## Sensor Behavior

- **Cadence**: every 60 minutes
- **Action**: Fetches balances, stores snapshot, creates P3 alert task if any balance is below threshold
- **Dedup**: Skips alert if a `sensor:treasury-health` task is already pending/active
- **Source**: `sensor:treasury-health`

## Addresses

Reads from SOUL.md / wallet skill:
- **BTC (SegWit)**: `bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku`
- **Stacks**: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`

## Data Storage

Balance snapshots stored in `balance_snapshots` table in the arc SQLite DB.

## Checklist

- [ ] `skills/treasury-health/SKILL.md` exists with valid frontmatter
- [ ] `skills/treasury-health/cli.ts` handles `check`, `history`, `thresholds` subcommands
- [ ] `skills/treasury-health/types.ts` defines balance and snapshot types
- [ ] Balance snapshot table created on first use
- [ ] Sensor creates alert tasks when balances are low
- [ ] No duplicate alerts (dedup gate)
