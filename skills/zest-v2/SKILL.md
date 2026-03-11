---
name: zest-v2
description: Zest Protocol V2 lending, borrowing, and rewards on Stacks
updated: 2026-03-11
tags:
  - defi
  - lending
  - mainnet-only
---

# Zest V2

Manages lending and borrowing positions on Zest Protocol V2 (Stacks). Extends the existing `defi-zest` yield farming skill with full V2 lending/borrowing lifecycle: deposit collateral, borrow against it, repay loans, and monitor liquidation risk.

## Sensor: Liquidation Monitor

**Cadence:** 120 minutes (2 hours). Queries Arc's borrow positions on Zest V2. Calculates health factor from collateral value vs. outstanding debt. Files a priority alert if health factor drops below 1.5 (warning) or 1.2 (critical — liquidation imminent).

**Alert thresholds:**
- Health factor < 1.5 → P5 warning task (review position)
- Health factor < 1.2 → P2 critical task (repay or add collateral immediately)

## CLI Commands

All commands output single JSON objects. Named flags only.

```
arc skills run --name zest-v2 -- deposit --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- borrow --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- repay --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- rewards-status [--address <addr>]
arc skills run --name zest-v2 -- health [--address <addr>]
```

### deposit

Supply collateral to Zest V2 lending pool. Requires wallet unlock. Gas ~50k uSTX.

### borrow

Borrow against deposited collateral. Must maintain health factor > 1.5 post-borrow. Requires wallet unlock.

### repay

Repay outstanding borrow. Partial or full repayment. Requires wallet unlock.

### rewards-status

Check accumulated Zest rewards (wSTX, ZEST tokens). Read-only, no wallet needed.

### health

Query current health factor for a position. Returns collateral value, debt value, health factor, and liquidation price. Default address: Arc's.

## Relationship to defi-zest

`defi-zest` handles sBTC supply-side yield farming (deposit/withdraw/claim). `zest-v2` handles the full lending/borrowing lifecycle including borrow positions and liquidation monitoring. They share the same upstream contracts but serve different use cases.

## Budget & Safety

- All operations mainnet-only
- Never borrow more than 50% of collateral value (self-imposed safety margin)
- Wallet must be unlocked for write operations (deposit, borrow, repay)
- No automatic borrowing — all borrows require explicit task approval
- Liquidation alerts are high priority and should not be deferred

## When to Load

Load when: managing Zest V2 borrow positions, checking health factor, responding to liquidation alerts, or executing deposit/borrow/repay operations. Use `defi-zest` for simple supply-side yield farming instead.

## Checklist

- [x] `skills/zest-v2/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
- [x] `AGENT.md` describes inputs, outputs, and gotchas
