# Bitflow — Subagent Briefing

You are executing a Bitflow DEX task on Stacks mainnet.

## Protocol Overview

Bitflow is the primary DEX aggregator on Stacks (Bitcoin L2). It routes swaps through multiple liquidity sources — its own AMM pools plus partner DEXs (ALEX, Velar) — for best execution. Supports standard AMM liquidity provision with dual-token deposits.

## Contract Architecture

**Router contract:** `SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2` (example — router address varies by pair)
**Pool registry:** `SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M`

Key operations:
- `swap(token-in, token-out, amount-in, min-amount-out)` — execute swap with slippage protection
- `add-liquidity(pool-id, amount-a, amount-b, min-lp)` — provide liquidity
- `remove-liquidity(pool-id, lp-amount, min-a, min-b)` — withdraw liquidity
- `get-quote(token-in, token-out, amount-in)` — read-only price quote

## Bitflow API

Bitflow exposes a REST API for pool data and routing:

**Base URL:** `https://app.bitflow.finance/api`

Useful endpoints:
- `GET /pools` — list all pools with TVL, APY, volume
- `GET /quote?tokenIn=<addr>&tokenOut=<addr>&amount=<units>` — get swap quote with routing
- `GET /tokens` — list supported tokens with contract addresses

**Note:** API structure may change. Verify endpoints before relying on them. Fall back to on-chain queries via Hiro API if the Bitflow API is unavailable.

## Hiro API Fallback

For on-chain data when Bitflow API is down:
- Token balances: `GET /extended/v1/address/{addr}/balances`
- Contract calls: `POST /v2/contracts/call-read/{contract}/{function}`
- LP token detection: look for tokens from `SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M` in balances

## Token Addresses (Stacks Mainnet)

| Symbol | Contract |
|--------|----------|
| STX | Native (no contract) |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| USDA | `SP2C2YFP12AJZB1MAATCG1GKMD07J9DYVHQS1RRG3.usda-token` |
| xBTC | `SP3DX3H4FEYZJZ586MFBS25ZW3HZDMEW92260R2PR.Wrapped-Bitcoin` |
| WELSH | `SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token` |
| ALEX | `SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex` |

## Asset Decimals

| Asset | Decimals | Notes |
|-------|----------|-------|
| STX | 6 | Native Stacks token |
| sBTC | 8 | Bitcoin-denominated |
| USDA | 6 | Stacks USD stablecoin |
| xBTC | 8 | Wrapped Bitcoin |
| WELSH | 6 | Meme token |
| ALEX | 8 | ALEX Lab token |

## CLI Reference

```bash
# Read-only
arc skills run --name bitflow -- pools
arc skills run --name bitflow -- pools --token STX
arc skills run --name bitflow -- quote --from STX --to sBTC --amount 1000000000  # 1000 STX

# Write (wallet required)
arc skills run --name bitflow -- swap --from STX --to sBTC --amount 500000000 --slippage 150  # 500 STX, 1.5% slippage
arc skills run --name bitflow -- add-liquidity --pool stx-sbtc --token-a-amount 500000000 --token-b-amount 500000
arc skills run --name bitflow -- remove-liquidity --pool stx-sbtc --lp-amount 1000000
```

## Gotchas

1. **Always quote before swap.** Price impact on low-liquidity pairs can be significant. Run `quote` first and check `priceImpact` field.
2. **Slippage is in basis points.** 100 = 1%. Default 100. For volatile pairs, consider 200-300.
3. **Router selects best path.** Bitflow may route through multiple pools. The quote response shows the full route.
4. **LP token naming varies.** Each pool has its own LP token. Check `pools` output for the exact LP token contract.
5. **Gas costs.** Swaps cost ~50-100k uSTX depending on route complexity. Multi-hop routes cost more.
6. **No automatic trading.** All swaps require explicit task approval. The sensor monitors but never executes trades.
7. **Mainnet only.** All operations are real and irreversible. Double-check amounts and decimals.
8. **25% balance cap.** Self-imposed: never swap more than 25% of a token balance without explicit approval in the task description.

## Error Handling

- 401/403 from any API → fail immediately, do not retry
- Network timeout → retry once, then fail with clear message
- Insufficient balance → fail with current balance in error output
- Price impact > 5% → warn in output, do not auto-execute
- Slippage exceeded → transaction reverts on-chain, report the revert reason
