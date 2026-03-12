# Zest V2 — Subagent Briefing

You are executing a Zest Protocol V2 lending/borrowing task on Stacks mainnet.

## Protocol Overview

Zest Protocol is a lending/borrowing protocol on Stacks (Bitcoin L2). V2 uses a unified market contract with per-asset vaults, Pyth price feeds, and share-based position tracking. Users deposit collateral and can borrow against it. Positions have a health factor — when it drops below 1.0, the position can be liquidated.

## Contract Architecture (V2)

**Deployer:** `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`

| Contract | Purpose |
|----------|---------|
| `v0-4-market` | Main market: supply, withdraw, borrow, repay |
| `v0-1-data` | Position data: `get-user-position(principal, assetId)` |
| `v0-vault-sbtc` | sBTC vault |
| `v0-vault-stx` | wSTX vault |
| `v0-vault-ststx` | stSTX vault |
| `v0-vault-usdc` | USDC vault |
| `v0-vault-usdh` | USDH vault |
| `v0-vault-ststxbtc` | stSTXbtc vault |

### Supported Assets (6 total)

| Asset | Token Contract | Asset ID | Decimals |
|-------|---------------|----------|----------|
| wSTX | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx` | 0 | 6 |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | 2 | 8 |
| stSTX | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` | 4 | 6 |
| USDC | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` | 6 | 6 |
| USDH | `SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1` | 8 | 8 |
| stSTXbtc | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2` | 10 | 6 |

### Position Reading

Call `get-user-position(principal, uint)` on `v0-1-data`. Returns:
- `suppliedShares` — share-based supply position (zToken index = assetId + 1)
- `borrowed` — debt amount in underlying units

**No LP token balance approach.** V2 tracks shares internally. Do not query old z-prefixed LP token contracts.

### V2 Market Function Signatures (v0-4-market)

- `supply-collateral-add(ft, amount, min-shares, price-feeds)` — deposit collateral
- `collateral-remove-redeem(ft, amount, min-underlying, receiver, price-feeds)` — withdraw
- `borrow(ft, amount, receiver, price-feeds)` — borrow against collateral
- `repay(ft, amount, on-behalf-of)` — repay debt

**Price feeds:** Supply, withdraw, and borrow require Pyth VAA price feed data. The `repay` function does not require price feeds.

### Removed in V2

- `claimRewards` — no rewards mechanism in v2
- `rewards-status` CLI command — obsolete
- Old LP token contracts (`zsbtc-v2-0`, `zststx-v2-0`, etc.) — not used for position tracking

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

## CLI Reference

```bash
# Read-only
arc skills run --name zest-v2 -- health
arc skills run --name zest-v2 -- health --address SP123...

# Write (wallet required)
arc skills run --name zest-v2 -- deposit --asset sBTC --amount 100000  # 0.001 sBTC
arc skills run --name zest-v2 -- borrow --asset wSTX --amount 500000000  # 500 STX
arc skills run --name zest-v2 -- repay --asset wSTX --amount 250000000  # 250 STX
```

## Gotchas

1. **No LP balance workaround needed.** V2 uses `get-user-position` on `v0-1-data` — this is the canonical way to read positions.
2. **Pyth price feeds required.** Supply, withdraw, and borrow will fail with "price-stale" errors if valid Pyth VAA data is not provided.
3. **Gas costs.** Each write operation costs ~50k uSTX. Factor this into STX balance checks.
4. **Upstream not yet migrated.** The `aibtcdev/skills` defi.service.ts still uses v1 contracts. Write operations via tx-runner may fail until upstream is updated.
5. **No automatic rebalancing.** All position changes require explicit task approval.
6. **Mainnet only.** No testnet deployment. All operations are real and irreversible.

## Error Handling

- 401/403 from Stacks API → fail immediately, do not retry
- Network timeout → retry once, then fail with clear message
- Insufficient balance → fail with current balance in error output
- Health factor would drop below 1.5 after borrow → refuse the operation
- "price-stale" error → Pyth VAA data is missing or expired, retry with fresh feed
