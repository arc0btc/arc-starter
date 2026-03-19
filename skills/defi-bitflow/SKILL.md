---
name: defi-bitflow
description: Bitflow DEX — DCA automation, swap quotes, and high-spread signal detection
updated: 2026-03-18
tags:
  - defi
  - trading
  - mainnet-only
---

# defi-bitflow

Market intelligence layer for Bitflow DEX. Wraps upstream `bitflow/bitflow.ts` from aibtcdev/skills and adds: (1) a high-spread detection sensor that files Ordinals Business signals, (2) spread analysis CLI, and (3) DCA automation via Bitflow Keeper contracts.

**Distinction from `bitflow` skill:** The `bitflow` skill manages Arc's own LP positions (monitor, add/remove liquidity, execute swaps by symbol). This skill is for market intelligence and DCA — it reads public Bitflow market data, files signals to the news beat, and automates recurring purchases. Load `bitflow` when managing Arc's portfolio. Load `defi-bitflow` when analyzing markets or filing signals.

## Sensor: High-Range Detection

**Cadence:** 60 minutes. Fetches ticker data from Bitflow SDK API (`/ticker` endpoint). Detects pairs where daily high-low range exceeds threshold (default 5%). Files signal tasks to aibtc-news Ordinals Business beat for notable volatility events.

**Note (2026-03-18):** Bitflow API no longer returns bid/ask fields. Sensor uses `(high - low) / last_price` as a spread/volatility proxy. Token IDs use Bitflow SDK format (e.g., `token-stx`, `token-sbtc`), not full contract addresses.

Range signals indicate potential volatility, liquidity imbalance, or arbitrage opportunities — useful intelligence for the AIBTC DeFi beat.

## CLI Commands

All commands output single JSON objects. Read-only commands pass through to upstream.

```
arc skills run --name defi-bitflow -- quote --token-x <id> --token-y <id> --amount-in <decimal>
arc skills run --name defi-bitflow -- swap --token-x <id> --token-y <id> --amount-in <decimal> [--slippage <decimal>]
arc skills run --name defi-bitflow -- ticker [--base-currency <id>] [--target-currency <id>]
arc skills run --name defi-bitflow -- tokens
arc skills run --name defi-bitflow -- routes --token-x <id> --token-y <id>
arc skills run --name defi-bitflow -- spreads [--threshold <pct>]
```

### DCA (planned)

DCA uses Bitflow Keeper contracts for scheduled recurring swaps. Future commands:

```
arc skills run --name defi-bitflow -- dca-create --token-x <id> --token-y <id> --amount <decimal> --interval <hours>
arc skills run --name defi-bitflow -- dca-status
arc skills run --name defi-bitflow -- dca-cancel --order-id <id>
```

## Budget & Safety

- Swaps with >5% price impact require `--confirm-high-impact` (upstream gate)
- Swap amounts capped at 10 STX per trade (configurable via `BITFLOW_MAX_TRADE_STX`)
- All operations mainnet-only
- Wallet must be unlocked for write operations

## When to Load

Load when: analyzing Bitflow market spreads, filing Ordinals Business DeFi signals, setting up DCA orders, or reviewing high-spread alerts. Do NOT load for managing Arc's own LP positions — use `bitflow` skill instead. Sensor creates spread signal tasks automatically.

## Checklist

- [x] `skills/defi-bitflow/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
