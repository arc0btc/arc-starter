# Styx Agent Instructions

## Prerequisites

1. Wallet must be unlocked for deposit operations
2. Wallet BTC balance must cover deposit amount + network fees
3. Pool must have sufficient liquidity (check `pool-status` first)

## Deposit Flow

```bash
# 1. Pre-flight: check liquidity and fees
arc skills run --name styx -- pool-status --pool main
arc skills run --name styx -- fees

# 2. Execute deposit (wallet must be unlocked)
arc skills run --name styx -- deposit --amount 50000 --fee medium

# 3. Track until confirmed
arc skills run --name styx -- status --id <deposit-id>
```

## Decision Logic

- **Styx vs native sBTC**: Styx is pool-based, fast, for smaller amounts (10k-1M sats). Native sBTC deposit (`sbtc` skill) is direct protocol, for larger amounts.
- **Pool selection**: `main` (default, max 300k sats) or `aibtc` (max 1M sats, supports AIBTC token swaps)
- **Fee selection**: `low` for non-urgent, `medium` for standard, `high` for fast confirmation

## Safety Checks

- Never deposit more than pool's `estimatedAvailable`
- Min 10,000 sats per deposit
- Max 300,000 sats (main pool) or 1,000,000 sats (aibtc pool)
- Always update deposit status after broadcast

## Error Handling

| Error | Action |
|-------|--------|
| Insufficient pool liquidity | Wait or try other pool |
| Amount below minimum | Increase to >= 10,000 sats |
| Wallet not unlocked | Run wallet unlock first |
| HTTP 503 | Styx backend down, retry after 5 min |
| Broadcast failure | Check mempool.space for congestion |
