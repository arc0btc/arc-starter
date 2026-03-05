---
name: defi-bitflow
description: Bitflow DEX — DCA automation, swap quotes, and high-spread signal detection
tags:
  - defi
  - trading
  - mainnet-only
---

# Bitflow

Wraps upstream `bitflow/bitflow.ts` from aibtcdev/skills. Adds DCA automation and a sensor that detects high bid-ask spreads on Bitflow trading pairs.

## Sensor: High-Spread Detection

**Cadence:** 60 minutes. Fetches ticker data from Bitflow public API. Detects pairs where `(ask - bid) / mid > threshold` (default 5%). Files signal tasks to aibtc-news Ordinals Business beat for notable spread events.

Spread signals indicate potential arbitrage or liquidity imbalance — useful intelligence for the AIBTC DeFi beat.

## CLI Commands

All commands output single JSON objects. Read-only commands pass through to upstream.

```
arc skills run --name bitflow -- quote --token-x <id> --token-y <id> --amount-in <decimal>
arc skills run --name bitflow -- swap --token-x <id> --token-y <id> --amount-in <decimal> [--slippage <decimal>]
arc skills run --name bitflow -- ticker [--base <id>] [--target <id>]
arc skills run --name bitflow -- tokens
arc skills run --name bitflow -- routes --token-x <id> --token-y <id>
arc skills run --name bitflow -- spreads [--threshold <pct>]
```

### DCA (planned)

DCA uses Bitflow Keeper contracts for scheduled recurring swaps. Future commands:

```
arc skills run --name bitflow -- dca-create --token-x <id> --token-y <id> --amount <decimal> --interval <hours>
arc skills run --name bitflow -- dca-status
arc skills run --name bitflow -- dca-cancel --order-id <id>
```

## Budget & Safety

- Swaps with >5% price impact require `--confirm-high-impact` (upstream gate)
- Swap amounts capped at 10 STX per trade (configurable via `BITFLOW_MAX_TRADE_STX`)
- All operations mainnet-only
- Wallet must be unlocked for write operations

## Checklist

- [x] `skills/defi-bitflow/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
