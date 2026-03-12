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

Manages lending and borrowing positions on Zest Protocol V2 (Stacks). Full V2 lending/borrowing lifecycle: deposit collateral, borrow against it, repay loans, and monitor liquidation risk.

## V2 Contracts

**Deployer:** `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`
- Market: `.v0-4-market` (supply, withdraw, borrow, repay)
- Data: `.v0-1-data` (position queries via `get-user-position`)
- Per-asset vaults: `.v0-vault-sbtc`, `.v0-vault-stx`, `.v0-vault-ststx`, `.v0-vault-usdc`, `.v0-vault-usdh`, `.v0-vault-ststxbtc`

### Supported assets (6 total)
| Asset | Token Contract | Asset ID |
|-------|---------------|----------|
| wSTX | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx` | 0 |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | 2 |
| stSTX | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` | 4 |
| USDC | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` | 6 |
| USDH | `SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1` | 8 |
| stSTXbtc | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2` | 10 |

### Position reading
`get-user-position(principal, assetId)` on `v0-1-data` returns `suppliedShares` + `borrowed`. No LP token balance approach — shares tracked internally.

### Write function signatures (v0-4-market)
- Supply: `supply-collateral-add(ft, amount, min-shares, price-feeds)`
- Withdraw: `collateral-remove-redeem(ft, amount, min-underlying, receiver, price-feeds)`
- Borrow: `borrow(ft, amount, receiver, price-feeds)`
- Repay: `repay(ft, amount, on-behalf-of)`
- Supply/withdraw/borrow require Pyth VAA price feeds

### Write path status
Sensor and CLI read operations use v2 contracts directly. Write operations delegate to upstream `aibtcdev/skills` tx-runner which still uses v1 contracts — write commands may fail until upstream is updated.

## Sensor: Liquidation Monitor

**Cadence:** 120 minutes (2 hours). Queries all 6 asset positions via `v0-1-data get-user-position`. Computes per-asset health factor. Files priority alerts:
- Health factor < 1.5 → P5 warning task
- Health factor < 1.2 → P2 critical task

## CLI Commands

```
arc skills run --name zest-v2 -- deposit --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- borrow --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- repay --asset <symbol> --amount <units>
arc skills run --name zest-v2 -- health [--address <addr>]
```

### health
Query per-asset health factor via v0-1-data. Returns positions, worst health factor, status. Default address: Arc's.

### deposit / borrow / repay
Wallet-required write operations via tx-runner. Gas ~50k uSTX per op.

## Budget & Safety

- All operations mainnet-only
- Never borrow more than 50% of collateral value
- Wallet must be unlocked for write operations
- No automatic borrowing — explicit task approval required
- Liquidation alerts are high priority and should not be deferred

## When to Load

Load when: managing Zest V2 borrow positions, checking health factor, responding to liquidation alerts, or executing deposit/borrow/repay. Use `defi-zest` for supply-side yield farming.

## Checklist

- [x] `skills/zest-v2/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
- [x] `AGENT.md` describes inputs, outputs, and gotchas
