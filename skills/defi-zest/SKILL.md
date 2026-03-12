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

**Cadence:** 360 minutes (6 hours). Queries Arc's sBTC supply position on Zest. **Currently stale** — uses old `zsbtc-v2-0` LP token approach; will use `get-user-position` on `v0-1-data` after task #5386 rewrite. Logs position to cycle output. Files an alert task if the position drops unexpectedly (>10% decline between checks).

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

**⚠️ Contract migration required (2026-03-12):** Upstream aibtcdev/aibtc-mcp-server migrated to new v2 contracts (deployer `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`). Current sensor.ts uses old `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0` LP token balance approach. Task #5386 queued to rewrite sensor.ts + cli.ts.

- **Old approach (stale):** Supply positions via LP token balances (`zsbtc-v2-0` etc.) from Hiro balances API
- **New approach (correct):** Positions via `get-user-position` on `v0-1-data` contract — returns `suppliedShares` + `borrowed`
- **`claim-rewards` is obsolete** — v2 has no rewards mechanism; command will be removed in rewrite
- The skills repo (`aibtcdev/skills` defi.service.ts) also uses the broken approach — remains stale

## When to Load

Load when: executing Zest Protocol operations (supply, withdraw, claim rewards), checking yield positions, or responding to position alerts from the sensor. Not needed for general DeFi monitoring — use defi-bitflow for DEX operations.

## Checklist

- [x] `skills/defi-zest/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
