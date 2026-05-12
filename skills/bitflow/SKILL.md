---
name: bitflow
description: Bitflow DEX — manage Arc's LP positions, execute swaps, and monitor HODLMM liquidity on Stacks
updated: 2026-05-12
tags:
  - defi
  - trading
  - liquidity
  - mainnet-only
---

# bitflow

LP position management and swap execution for Bitflow DEX. Wraps `github/aibtcdev/skills/bitflow/bitflow.ts` with safety guards and Arc-specific conventions.

**Distinction from `defi-bitflow`:** This skill manages Arc's own LP positions (add/remove liquidity, portfolio swaps, position monitoring). Use `defi-bitflow` for market intelligence and DCA automation. Use this skill when Arc's own capital is being deployed or withdrawn.

## Upstream Entry Point

```
github/aibtcdev/skills/bitflow/bitflow.ts
```

All subcommands delegate to upstream via `bun run`. Wallet credentials sourced from Arc credential store.

## When to Load

Load when: adding or removing Arc's HODLMM liquidity, executing portfolio swaps (not DCA), checking Arc's LP position status. Do NOT load for market analysis — use `defi-bitflow` instead.

## CLI Commands

```
arc skills run --name bitflow -- quote --token-x <id> --token-y <id> --amount-in <decimal>
arc skills run --name bitflow -- swap --token-x <id> --token-y <id> --amount-in <decimal> [--slippage <decimal>] [--confirm-high-impact]
arc skills run --name bitflow -- lp-status [--pool-id <id>]
arc skills run --name bitflow -- add-liquidity --pool-id <id> --bins <json> [--slippage <pct>]
arc skills run --name bitflow -- withdraw-liquidity --pool-id <id> --positions <json>
arc skills run --name bitflow -- pools [--suggested] [--sbtc-incentives]
arc skills run --name bitflow -- tokens
arc skills run --name bitflow -- routes --token-x <id> --token-y <id> [--amount-in <decimal>]
```

## Token IDs (Common)

| Symbol | Token ID |
|--------|----------|
| STX | `token-stx` |
| sBTC | `token-sbtc` |
| USDC | `token-USDCx-auto` |
| aeUSDC | `token-aeusdc` (only when explicitly requested) |
| stSTX | `token-ststx` |

## Units Reference

- STX: 6 decimals — `1 STX = 1,000,000` micro-STX
- sBTC: 8 decimals — `1 sBTC = 100,000,000` sats
- USDCx / aeUSDC: 6 decimals
- `--amount-in` always takes human-readable decimal (e.g. `1.0` for 1 STX, `0.00015` for 15k sats sBTC)

## Safety Rules

- Swaps with >5% price impact require `--confirm-high-impact`
- Swap amounts cap at 10 STX equivalent per trade (configurable via `BITFLOW_MAX_TRADE_STX`)
- All operations are mainnet-only
- Always run `quote` before `swap` to verify expected output
- Always run `lp-status` + `pools` before `add-liquidity` to verify current position and active bin
- Withdraw offset is relative to **current** active bin — recalculate if time has passed since last `lp-status`

## Checklist

- [x] `skills/bitflow/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` runs without error
- [x] AGENT.md covers prerequisites, safety checks, and error handling
