---
name: defi-zest
description: Zest Protocol yield farming — supply, withdraw, claim rewards, position monitoring
updated: 2026-03-08
tags:
  - defi
  - yield
  - mainnet-only
---

# Zest Protocol

Wraps upstream `defi/defi.ts` from aibtcdev/skills for Zest Protocol lending operations. Adds a position-monitoring sensor that tracks sBTC yield farming positions.

## Sensor: Position Monitor

**Cadence:** 360 minutes (6 hours). Queries Arc's sBTC supply position on Zest via the zsbtc-v2-0 LP token balance (workaround for upstream `get-user-reserve-data` returning 0 — see aibtcdev/aibtc-mcp-server#278). Logs position to cycle output. Files an alert task if the position drops unexpectedly (>10% decline between checks).

## CLI Commands

All commands output single JSON objects. Read-only commands pass through to upstream.

```
arc skills run --name defi-zest -- list-assets
arc skills run --name defi-zest -- position [--asset <symbol>] [--address <addr>]
arc skills run --name defi-zest -- supply --asset <symbol> --amount <units>
arc skills run --name defi-zest -- withdraw --asset <symbol> --amount <units>
arc skills run --name defi-zest -- claim-rewards [--asset <symbol>]
```

### position

Queries position using both upstream `get-user-reserve-data` and the LP token balance workaround. Returns whichever is non-zero. Default asset: sBTC.

### supply / withdraw / claim-rewards

Wallet-aware write operations. Runs via `tx-runner.ts` subprocess with wallet unlock/lock lifecycle. Gas cost ~50k uSTX per operation.

## Budget & Safety

- Supply/withdraw amounts should be validated before execution (check wallet balance first)
- All operations mainnet-only
- Wallet must be unlocked for write operations
- No automatic rebalancing — all supply/withdraw is manual or task-driven

## Known Issues

- `get-user-reserve-data` may return 0 for supplied amounts (aibtcdev/aibtc-mcp-server#278)
- Workaround: query `zsbtc-v2-0.get-balance` directly via Hiro API `call_read_only_function`
- Proof tx: `188ec972a62f407ca92bb670235bfb23652bd94a91e4c445f09a5a4b125ced39`

## When to Load

Load when: executing Zest Protocol operations (supply, withdraw, claim rewards), checking yield positions, or responding to position alerts from the sensor. Not needed for general DeFi monitoring — use defi-bitflow for DEX operations.

## Checklist

- [x] `skills/defi-zest/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
