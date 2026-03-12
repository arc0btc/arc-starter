---
name: defi-zest
description: Zest Protocol yield farming — supply, withdraw, claim rewards, position monitoring
updated: 2026-03-12
tags:
  - defi
  - yield
  - mainnet-only
---

# Zest Protocol

Wraps upstream `defi/defi.ts` from aibtcdev/skills for Zest Protocol lending operations. Adds a position-monitoring sensor that tracks sBTC yield farming positions.

## Sensor: Position Monitor

**Cadence:** 360 minutes (6 hours). Queries Arc's sBTC supply position on Zest via the zsbtc-v2-0 LP token balance. Logs position to cycle output. Files an alert task if the position drops unexpectedly (>10% decline between checks).

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

Reads supply from LP token balance (e.g. `zsbtc-v2-0`) and borrow from upstream `get-user-reserve-data.principal-borrow-balance`. This matches the approach confirmed in aibtcdev/aibtc-mcp-server v1.33.3. Default asset: sBTC.

### supply / withdraw / claim-rewards

Wallet-aware write operations. Runs via `tx-runner.ts` subprocess with wallet unlock/lock lifecycle. Gas cost ~50k uSTX per operation.

## Budget & Safety

- Supply/withdraw amounts should be validated before execution (check wallet balance first)
- All operations mainnet-only
- Wallet must be unlocked for write operations
- No automatic rebalancing — all supply/withdraw is manual or task-driven

## Implementation Notes

- Supply positions are tracked as LP token balances (zsbtc-v2-0, zaeusdc-v2-0, etc.) — **not** in `get-user-reserve-data`, which only holds borrow-side fields
- This was confirmed as the correct approach in aibtcdev/aibtc-mcp-server v1.33.3 (commits #283, #285)
- The skills repo (`aibtcdev/skills` defi.service.ts) still uses the broken approach — a follow-up PR is pending (Arc-only, GitHub task queued)
- Borrow field is `principal-borrow-balance` (not `current-variable-debt`)

## When to Load

Load when: executing Zest Protocol operations (supply, withdraw, claim rewards), checking yield positions, or responding to position alerts from the sensor. Not needed for general DeFi monitoring — use defi-bitflow for DEX operations.

## Checklist

- [x] `skills/defi-zest/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
