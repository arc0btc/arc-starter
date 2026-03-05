---
name: defi-stacks-market
description: Prediction market trading and intelligence on stacksmarket.app — budget-enforced trading, position tracking, and signal filing. Mainnet-only.
updated: 2026-03-05
tags:
  - l2
  - defi
  - prediction-markets
  - mainnet-only
  - trading
---

# Stacks Market Skill

Trade prediction markets on stacksmarket.app with a **50 STX budget**, position tracking, and automated signal filing. Uses LMSR (Logarithmic Market Scoring Rule) on-chain pricing via the `market-factory-v18-bias` contract.

## Trading

All trades are budget-enforced. The CLI quotes before executing, applies slippage protection, and records every position in SQLite.

**Budget:** 50 STX total | 10 STX max per trade | 5% slippage tolerance

```bash
# Check remaining budget
arc skills run --name stacks-market -- budget

# Buy YES shares (auto-quotes, checks budget, executes, records)
arc skills run --name stacks-market -- buy --market-id 1771853629839 --side yes --amount 5 --market-title "BTC above 100k"

# Sell shares back before resolution
arc skills run --name stacks-market -- sell --market-id 1771853629839 --side yes --amount 5

# Redeem winning shares after resolution (1 winning share = 1 STX)
arc skills run --name stacks-market -- redeem --market-id 1771853629839

# View all positions
arc skills run --name stacks-market -- positions

# Portfolio summary with P&L
arc skills run --name stacks-market -- portfolio
```

**Trade flow:** quote → budget check → size check → execute (wallet auto-unlock) → record position → output result with updated budget.

**Market ID types:**
- **Epoch millisecond** (e.g., `1771853629839`) — used for trading, quoting, positions. This is the on-chain ID.
- **MongoDB _id** (e.g., `699c573ea7bb5ad25fee68a0`) — used for `get-market` API lookups only.

## Strategy

1. **Edge-based only.** Trade markets where Arc has informational advantage from ecosystem monitoring (sensor signals, PR reviews, protocol analysis).
2. **Small positions.** 1-5 STX per market. Diversify across 5-10 markets rather than concentrating.
3. **Binary clarity.** Prefer markets with objective, verifiable resolution criteria. Avoid subjective markets.
4. **Time horizon.** Favor markets resolving within 30 days for faster capital return.
5. **Odds check.** Buy when market odds diverge >20% from your estimated probability. If unsure, don't trade.

## Read-Only Commands

```bash
arc skills run --name stacks-market -- list-markets --limit 20
arc skills run --name stacks-market -- search-markets --query "Bitcoin" --limit 10
arc skills run --name stacks-market -- get-market --market-id 699c573ea7bb5ad25fee68a0
arc skills run --name stacks-market -- quote-buy --market-id 1771853629839 --side yes --amount 5
arc skills run --name stacks-market -- quote-sell --market-id 1771853629839 --side yes --amount 5
arc skills run --name stacks-market -- get-position --market-id 1771853629839
```

## Sensor Behavior

- **Cadence:** Every 6 hours
- **Signal filing:** Detects markets >100 STX volume, files Ordinals Business signals to aibtc-news
- **Deduplication:** Tracks filed signals by market ID, respects 4-hour rate limit

## Key Constraints

- **Mainnet-only.** All operations error on testnet.
- **Budget-enforced.** Cannot exceed 50 STX total exposure (configurable via `STACKS_MARKET_BUDGET_USTX`).
- **Wallet required for trades.** Read-only commands work without wallet.
- **LMSR pricing shifts.** Each trade moves the price curve — always quote immediately before executing.
- **Gas:** ~0.05-0.1 STX per transaction, not included in quotes.

## Components

| File | Purpose |
|------|---------|
| `cli.ts` | Trading CLI with budget enforcement and position tracking |
| `trade-runner.ts` | Wallet-aware trade execution (unlock → trade → lock) |
| `sensor.ts` | 6-hour cadence market intelligence and signal filing |
| Upstream | `github/aibtcdev/skills/defi-stacks-market/stacks-market.ts` — raw trading CLI |

## When to Load

Load when: buying/selling prediction market shares on stacksmarket.app, reviewing portfolio P&L, or researching a market before trading. Only load when active trading is required — the sensor files signals automatically without this skill loaded.

## Checklist

- [x] Budget enforcement (50 STX cap, 10 STX per trade)
- [x] Position tracking in SQLite (`market_positions` table)
- [x] Auto-quoting with 5% slippage protection
- [x] Wallet auto-unlock/lock via trade-runner.ts
- [x] Portfolio and P&L reporting
- [x] Signal filing sensor (6-hour cadence)
- [x] Read-only commands pass through to upstream
