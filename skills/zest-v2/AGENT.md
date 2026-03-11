# Zest V2 — Subagent Briefing

You are executing a Zest Protocol V2 lending/borrowing task on Stacks mainnet.

## Protocol Overview

Zest Protocol is a lending/borrowing protocol on Stacks (Bitcoin L2). V2 introduces improved pool mechanics, variable rate borrowing, and liquidation protection. Users deposit collateral (sBTC, STX, USDA) and can borrow against it. Positions have a health factor — when it drops below 1.0, the position can be liquidated.

## Contract Architecture

**Pool contract:** `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-v2-0`
**LP tokens:** z-prefixed (e.g., `zsbtc-v2-0` for sBTC collateral)
**Debt tokens:** d-prefixed (e.g., `dsbtc` for sBTC debt)

Key contract functions:
- `supply(asset, amount, on-behalf-of)` — deposit collateral
- `borrow(asset, amount)` — borrow against collateral
- `repay(asset, amount)` — repay debt
- `get-user-reserve-data(asset, user)` — query position (may return 0, use LP balance workaround)
- `get-reserve-data(asset)` — pool state (utilization, rates)

**Known bug:** `get-user-reserve-data` may return 0 for supplied amounts. Workaround: query LP token balance via Hiro API `extended/v1/address/{addr}/balances` and look for z-prefixed tokens. See aibtcdev/aibtc-mcp-server#278.

## Upstream Tools (aibtc-mcp-server v1.33.2)

The `defi/defi.ts` script in `github/aibtcdev/skills` provides these Zest commands:
- `zest-list-assets` — list supported assets
- `zest-supply --asset <sym> --amount <units>` — supply to pool
- `zest-borrow --asset <sym> --amount <units>` — borrow from pool
- `zest-repay --asset <sym> --amount <units>` — repay borrow
- `zest-claim-rewards --asset <sym>` — claim wSTX rewards
- `zest-get-position --asset <sym> --address <addr>` — query position

All write operations go through `tx-runner.ts` in `skills/defi-zest/` which handles wallet unlock/lock lifecycle.

## Health Factor Calculation

```
health_factor = total_collateral_value / total_debt_value
```

- `>= 2.0` — healthy, safe to borrow more
- `1.5 - 2.0` — moderate, monitor closely
- `1.2 - 1.5` — warning zone, consider repaying
- `< 1.2` — critical, liquidation imminent
- `<= 1.0` — liquidatable

**Self-imposed safety rule:** Never borrow more than 50% of collateral value (target health factor >= 2.0 after borrow).

## Asset Decimals

| Asset | Decimals | Notes |
|-------|----------|-------|
| sBTC | 8 | Bitcoin-denominated |
| STX | 6 | Native Stacks token |
| USDA | 6 | Stacks USD stablecoin |

## CLI Reference

```bash
# Read-only
arc skills run --name zest-v2 -- health
arc skills run --name zest-v2 -- health --address SP123...
arc skills run --name zest-v2 -- rewards-status

# Write (wallet required)
arc skills run --name zest-v2 -- deposit --asset sBTC --amount 100000  # 0.001 sBTC
arc skills run --name zest-v2 -- borrow --asset STX --amount 500000000  # 500 STX
arc skills run --name zest-v2 -- repay --asset STX --amount 250000000  # 250 STX
```

## Gotchas

1. **LP balance workaround is required.** Do not rely solely on `get-user-reserve-data` — it may return 0. Always cross-check with LP token balances.
2. **Gas costs.** Each write operation costs ~50k uSTX. Factor this into STX balance checks before borrowing.
3. **Rewards pre-check.** As of aibtc-mcp-server v1.33.2, reward claims include a pre-check to prevent failed broadcasts. Still verify reward balance > 0 before claiming.
4. **No automatic rebalancing.** All position changes require explicit task approval. The sensor monitors but never acts autonomously.
5. **Mainnet only.** There is no testnet deployment for Zest V2. All operations are real and irreversible.

## Error Handling

- 401/403 from Hiro API → fail immediately, do not retry (auth issue)
- Network timeout → retry once, then fail with clear message
- Insufficient balance → fail with current balance in error output
- Health factor would drop below 1.5 after borrow → refuse the operation
