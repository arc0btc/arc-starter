---
name: bitflow-positions
description: Bitflow DEX swaps, liquidity provision, and pool analytics on Stacks
updated: 2026-03-11
tags:
  - defi
  - dex
  - mainnet-only
---

# Bitflow

Portfolio management for Bitflow DEX on Stacks. Supports token swaps, liquidity provision, pool stats, and price quotes for Arc's own positions. Bitflow is the primary DEX on Stacks — routes through multiple liquidity sources for best execution.

**Distinction from `defi-bitflow` skill:** This skill manages Arc's own LP positions and executes trades from Arc's wallet. Use `defi-bitflow` for market intelligence (spread analysis, Ordinals Business signal filing, DCA automation via Keeper contracts).

## Sensor: Pool Monitor

**Cadence:** 60 minutes. Checks tracked pools for significant APY shifts (>20% change) and large price deviations that may signal arbitrage opportunities. Files tasks when thresholds are breached.

**Alert thresholds:**
- APY shift > 20% from last reading → P7 informational task (review pool)
- Price deviation > 5% from external oracle → P5 alert (potential arbitrage or risk)

## CLI Commands

All commands output single JSON objects. Named flags only.

```
arc skills run --name bitflow-positions --swap --from <symbol> --to <symbol> --amount <units>
arc skills run --name bitflow-positions --add-liquidity --pool <id> --token-a-amount <units> --token-b-amount <units>
arc skills run --name bitflow-positions --remove-liquidity --pool <id> --lp-amount <units>
arc skills run --name bitflow-positions --pools [--token <symbol>]
arc skills run --name bitflow-positions --quote --from <symbol> --to <symbol> --amount <units>
```

### swap

Execute a token swap via Bitflow router. Requires wallet unlock. Slippage default: 1%. Override with `--slippage <bps>`.

### add-liquidity

Add liquidity to a Bitflow pool. Requires wallet unlock. Both token amounts required. Gas ~50k uSTX.

### remove-liquidity

Remove liquidity from a pool by burning LP tokens. Requires wallet unlock. Partial or full withdrawal.

### pools

List available Bitflow pools with current TVL, APY, and volume. Optional `--token` filter shows only pools containing that token.

### quote

Get a swap quote without executing. Read-only — shows expected output, price impact, and route. No wallet needed.

## Supported Tokens

Primary pairs: STX, sBTC, USDA, xBTC, WELSH, ALEX. Bitflow aggregates liquidity across its own pools and partner DEXs.

## Budget & Safety

- All operations mainnet-only
- Default slippage tolerance: 1% (100 bps)
- Never swap more than 25% of a token balance in a single operation without explicit approval
- Wallet must be unlocked for write operations (swap, add/remove liquidity)
- No automatic swaps — all trades require explicit task approval
- Quote before swap: always run `quote` first to check price impact

## When to Load

Load when: executing DEX swaps from Arc's wallet, managing Arc's liquidity positions, checking Arc's pool stats, getting price quotes, or responding to pool monitor alerts. Not needed for lending/borrowing (use `zest-v2`). Not needed for market spread analysis or signal filing (use `defi-bitflow`).

## Checklist

- [x] `skills/bitflow-positions/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `cli.ts` runs without error
- [x] `AGENT.md` describes inputs, outputs, and gotchas
