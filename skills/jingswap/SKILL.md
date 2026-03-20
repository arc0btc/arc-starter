---
name: jingswap
description: Jingswap blind batch auction on Stacks — sBTC/STX and sBTC/USDCx markets, cycle state, deposits, settlements
updated: 2026-03-20
tags:
  - defi
  - dex
  - mainnet-only
---

# Jingswap

Blind batch auction DEX on Stacks for swapping sBTC against a quote token. Unlike AMM DEXes (Bitflow), Jingswap batches deposits from both sides of a market and settles at oracle price (Pyth). Two markets available:

| Market | Contract | Quote Token |
|--------|----------|-------------|
| `sbtc-stx` (default) | `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-stx-jing` | STX |
| `sbtc-usdcx` | `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-usdcx-jing` | USDCx |

## Auction Cycle

Each cycle has three phases:

1. **Deposit** (min 150 blocks ~5 min) — anyone deposits quote token or sBTC
2. **Buffer** (30 blocks ~1 min) — no new deposits, waiting for settlement
3. **Settle** — anyone triggers settlement using Pyth oracle prices; unswapped remainder rolls to next cycle

Cancel threshold: 530 blocks (~17.5 min) from close — if settle fails, cancel rolls deposits forward.

## CLI Commands

All commands output JSON. Named flags only. All accept `--market sbtc-stx` (default) or `--market sbtc-usdcx`.

```
arc skills run --name jingswap -- cycle-state [--market sbtc-stx]
arc skills run --name jingswap -- depositors --cycle <N> [--market sbtc-stx]
arc skills run --name jingswap -- settlement --cycle <N> [--market sbtc-stx]
arc skills run --name jingswap -- prices [--market sbtc-stx]
arc skills run --name jingswap -- deposit-quote --amount <units> [--market sbtc-stx]
arc skills run --name jingswap -- deposit-sbtc --amount <sats> [--market sbtc-stx]
```

### cycle-state
Read-only. Returns current cycle number, phase (0=deposit, 1=buffer, 2=settle), blocks elapsed, totals, and minimums. Gate all deposits on `phase === 0`.

### depositors
Read-only. Returns quote-token and sBTC depositors for a given cycle.

### settlement
Read-only. Returns settlement details (oracle price, fill amounts) for a completed cycle.

### prices
Read-only. Returns Pyth oracle and DEX prices for the market.

### deposit-quote
Write. Deposits quote token (STX or USDCx depending on market) into current cycle. Deposit phase only. Budget-gated: max 50 STX (50,000,000 uSTX) per cycle.

### deposit-sbtc
Write. Deposits sBTC (satoshis) into current cycle. Deposit phase only. Budget-gated: max 10,000 sats per cycle.

## Budget & Safety

- **Max per cycle:** 50 STX / 10,000 sats
- **Phase gate:** Deposits only during deposit phase (phase 0)
- **Mainnet only** — no testnet contracts configured
- **Oracle settlement** — Pyth price, not maker-set limit price
- **Unswapped rolls forward** — remainder goes to next cycle, not refunded

## Configuration

Contract addresses and market config live in `skills/jingswap/config.json`. Jingswap API at `https://faktory-dao-backend.vercel.app` provides read endpoints.

## When to Load

Load when: depositing to Jingswap, checking auction state, querying settlement history. Not needed for AMM swaps (use `defi-bitflow`). Not needed for lending (use `zest-v2`).

## Checklist

- [x] `skills/jingswap/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` runs without error
- [x] `config.json` populated with v1.42.0 contract names (sbtc-stx-jing, sbtc-usdcx-jing)
- [ ] End-to-end deposit tested on mainnet
