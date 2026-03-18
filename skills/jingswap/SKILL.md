---
name: jingswap
description: Jingswap order-book DEX on Stacks — STX/sBTC deposits, TVL checks, quotes
updated: 2026-03-18
tags:
  - defi
  - dex
  - mainnet-only
---

# Jingswap

Order-book DEX on Stacks for STX/sBTC trading. Unlike AMM DEXes (Bitflow, Stackswap), Jingswap uses bid/ask orders. Deposits add liquidity by placing limit orders on the book.

## Deposit Flow

1. **Pre-check:** `check-tvl` — verify liquidity exists on both sides of the book (STX and sBTC). Gate: do NOT deposit into an empty or one-sided book.
2. **Quote:** `quote` — get current best bid/ask spread and expected fill price for a given size.
3. **Deposit:** `deposit` — place a limit order (bid or ask) on the book. Budget: max 50 STX or 10,000 sats per cycle.

Target wallet for first deposits: `SP12Q1FS2DX4N8C2QYBM0Z2N2DY1EH9EEPMPH9N9X` (Spark).

## Configuration

Contract addresses and pair config live in `skills/jingswap/config.json`. This file must be populated before write operations work. Read-only commands (check-tvl, quote) also require valid contract addresses.

## CLI Commands

All commands output single JSON objects. Named flags only.

```
arc skills run --name jingswap -- check-tvl [--pair STX-sBTC]
arc skills run --name jingswap -- quote --side bid --amount 50000000 [--pair STX-sBTC]
arc skills run --name jingswap -- deposit --side bid --amount 50000000 --price <ustx-per-sat> [--pair STX-sBTC]
```

### check-tvl

Read-only. Queries on-chain order book depth for both sides. Returns bid/ask counts, total volume on each side, and a `healthy` boolean (true if both sides have liquidity). Gate all deposits on `healthy === true`.

### quote

Read-only. Returns best bid, best ask, spread, and estimated fill for a given amount and side. Use before deposit to verify pricing.

### deposit

Write operation. Places a limit order on the Jingswap book. Requires wallet unlock. Budget-gated: rejects amounts exceeding 50 STX (50,000,000 uSTX) or 10,000 sats.

## Budget & Safety

- **Max per cycle:** 50 STX / 10,000 sats
- **TVL gate:** Both sides must have liquidity before depositing
- **Mainnet only** — no testnet contracts configured
- **No market orders** — limit orders only for price protection
- **Quote before deposit:** Always run `quote` first to verify spread

## When to Load

Load when: depositing to Jingswap, checking order book health, getting STX/sBTC quotes on Jingswap. Not needed for AMM swaps (use `bitflow`). Not needed for lending (use `zest-v2`).

## Checklist

- [x] `skills/jingswap/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` runs without error
- [ ] `config.json` populated with live contract addresses
- [ ] End-to-end deposit tested on mainnet
