---
name: zest-v2
description: Zest Protocol V2 lending, borrowing, and liquidation monitoring on Stacks
updated: 2026-03-12
tags:
  - defi
  - lending
  - mainnet-only
---

# Zest V2

Manages lending and borrowing positions on Zest Protocol V2 (Stacks). Extends the existing `defi-zest` yield farming skill with full V2 lending/borrowing lifecycle: deposit collateral, borrow against it, repay loans, and monitor liquidation risk.

## ⚠️ CONTRACT MIGRATION REQUIRED (2026-03-12)

**Arc's current implementation is pointed at outdated v1 contracts.** The upstream aibtcdev/aibtc-mcp-server completed a full v1→v2 migration (commit `dc21dfe`, 2026-03-12). The sensor.ts and cli.ts need rewriting. Do NOT execute borrow/deposit/repay until task #5386 (implementation rewrite) is complete.

### Old contracts (WRONG — do not use)
- Deployer: `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N`
- Pool: `.pool-v2-0`, `.pool-borrow-v2-4`
- LP tokens: `zsbtc-v2-0`, `zststx-v2-0`, etc.

### New v2 contracts (correct)
- Deployer: `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`
- Market: `.v0-4-market`
- Data: `.v0-1-data`
- Per-asset vaults: `.v0-vault-sbtc`, `.v0-vault-stx`, `.v0-vault-ststx`, `.v0-vault-usdc`, `.v0-vault-usdh`, `.v0-vault-ststxbtc`

### New v2 supported assets (6 total)
| Asset | Token Contract | Asset ID |
|-------|---------------|----------|
| wSTX | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx` | 0 |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | 2 |
| stSTX | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` | 4 |
| USDC | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` | 6 |
| USDH | `SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1` | 8 |
| stSTXbtc | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2` | 10 |

### New position reading approach
Positions via `get-user-position` on `v0-1-data` — returns `suppliedShares` (zToken index = assetId + 1) and `borrowed` (debt amount). No separate LP token contracts — shares tracked internally.

### New function signatures (v0-4-market)
- Supply: `supply-collateral-add(ft, amount, min-shares, price-feeds)`
- Withdraw: `collateral-remove-redeem(ft, amount, min-underlying, receiver, price-feeds)`
- Borrow: `borrow(ft, amount, receiver, price-feeds)`
- Repay: `repay(ft, amount, on-behalf-of)`
- Requires Pyth price feeds (VAA) for stale-price errors

### Removed in v2
- `claimRewards` tool removed — no rewards mechanism in v2
- `rewards-status` CLI command is obsolete

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
