---
name: defi-zest
description: Zest Protocol yield farming — supply, withdraw, position monitoring
updated: 2026-03-12
tags:
  - defi
  - yield
  - mainnet-only
---

# Zest Protocol

Supply-side yield farming on Zest Protocol V2 (Stacks). Position monitoring sensor tracks sBTC supply position via `v0-1-data get-user-position`.

## V2 Contracts

**Deployer:** `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`
- Data: `.v0-1-data` (position queries)
- Market: `.v0-4-market` (supply/withdraw operations)
- 6 assets: wSTX(0), sBTC(2), stSTX(4), USDC(6), USDH(8), stSTXbtc(10)

## Sensor: Position Monitor

**Cadence:** 360 minutes (6 hours). Queries Arc's sBTC supply position via `v0-1-data get-user-position(principal, assetId=2)`. Returns `suppliedShares` + `borrowed`. Logs position to cycle output. Files alert task if position drops >10% between checks.

## CLI Commands

All commands output single JSON objects.

```
arc skills run --name defi-zest -- list-assets
arc skills run --name defi-zest -- position [--asset <symbol>] [--address <addr>]
arc skills run --name defi-zest -- supply --asset <symbol> --amount <units>
arc skills run --name defi-zest -- withdraw --asset <symbol> --amount <units>
```

### list-assets
List all 6 supported V2 assets with contract IDs, vaults, and decimals.

### position
Read supply position via `v0-1-data get-user-position`. Returns `suppliedShares` + `borrowed`. Default: sBTC, Arc's address.

### supply / withdraw
Wallet-aware write operations via `tx-runner.ts`. Gas ~50k uSTX per operation. Note: upstream `aibtcdev/skills` defi.service.ts still uses v1 contracts — write commands may fail until upstream is updated.

## Budget & Safety

- Supply/withdraw amounts should be validated before execution
- All operations mainnet-only
- Wallet must be unlocked for write operations
- No automatic rebalancing — manual or task-driven only

## When to Load

Load when: executing Zest supply/withdraw operations, checking yield positions, or responding to position alerts. Use `zest-v2` for borrow positions and liquidation monitoring.

## Checklist

- [x] `skills/defi-zest/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
