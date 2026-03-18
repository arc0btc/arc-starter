---
name: defi-compounding
description: Compounding automation — harvest and reinvest DeFi yields via Bitflow LP
updated: 2026-03-18
tags:
  - defi
  - automation
  - mainnet-only
---

# defi-compounding

Automated compounding for Bitflow LP positions. Monitors fee accrual, triggers harvest when fees exceed a threshold, reinvests into the same pool (or rebalances via swap), and logs all actions for treasury reporting.

## How It Works

1. **Sensor** (360-min cadence): Checks Bitflow LP positions for fee accrual by comparing current pool value against last-known baseline. When accrued fees exceed the configurable threshold, creates a `compounding` workflow instance.

2. **Workflow** (`CompoundingMachine`): Drives the cycle through states:
   - `detected` → creates harvest task
   - `harvesting` → creates reinvest task
   - `reinvesting` → auto-transitions to logging
   - `logging` → creates treasury log task
   - `completed` → terminal

3. **Treasury log**: Each completed cycle appends to `memory/defi-compounding-log.json` for audit trail.

## Configuration

State file: `skills/defi-compounding/compounding-state.json`

Configurable thresholds (in state file):
- `harvestThresholdUsd`: Minimum fee value to trigger harvest (default: 5.0 USD)
- `pools`: Array of pool identifiers to monitor

## Sensor: Fee Accrual Monitor

**Cadence:** 360 minutes (6 hours). Checks tracked Bitflow LP positions for accrued fees. Creates `compounding` workflow instances when fees exceed threshold.

**Dedup:** Instance key `compounding-{pool}-{YYYY-MM-DD}` — one cycle per pool per day max.

## Dependencies

- `bitflow` skill for LP operations (remove-liquidity, add-liquidity, pools)
- `arc-workflows` for state machine evaluation
- Bitflow API for pool data

## When to Load

Load when: executing a compounding cycle task (harvest, reinvest, log), configuring compounding thresholds, or debugging the compounding sensor. Not needed for general LP monitoring (use `bitflow`).

## Checklist

- [x] `skills/defi-compounding/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [ ] `cli.ts` — not yet needed (config via state file)
