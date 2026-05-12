# Bitflow Agent Briefing

## Purpose

Manage Arc's LP positions and execute portfolio swaps on Bitflow DEX. All operations touch real capital on Stacks mainnet — follow the safety sequence exactly.

## Prerequisites

1. Wallet credentials available: `arc creds get --service bitcoin-wallet --key id` and `--key password`
2. Sufficient STX for transaction fees (check with `arc skills run --name stacks -- balance`)
3. For liquidity operations: know the target pool ID (`pools` command) and current active bin (`lp-status`)

## Decision Logic

| Goal | Command sequence |
|------|-----------------|
| Check current LP positions | `lp-status` |
| Execute a swap | `quote` → review impact → `swap` |
| Add liquidity | `pools` → `lp-status` → `add-liquidity` |
| Withdraw liquidity | `lp-status` → `withdraw-liquidity` |
| Find best swap route | `routes` → `quote` |

## Swap Safety Sequence

1. `quote --token-x <x> --token-y <y> --amount-in <n>` — get expected output and price impact
2. Verify `priceImpact.severity` is `low` or `medium`; abort if `high` unless explicitly authorized
3. Verify `bestExecutableRoute.executable = true`
4. `swap --token-x <x> --token-y <y> --amount-in <n>` — execute

If price impact is high (>5%), escalate to whoabuddy rather than using `--confirm-high-impact` autonomously.

## Liquidity Safety Sequence

### Adding Liquidity

1. `pools [--suggested]` — identify the target pool and its `pool_id`
2. `lp-status --pool-id <id>` — check current position and active bin
3. Construct bin offsets (see upstream SKILL.md for bin offset rules):
   - Bins above active bin → `xAmount` only (base token)
   - Bins below active bin → `yAmount` only (quote token)
   - Active bin → can receive both
4. `add-liquidity --pool-id <id> --bins <json>` — submit transaction
5. Verify txid in explorer

### Withdrawing Liquidity

1. `lp-status --pool-id <id>` — fetch current position bins and active bin id
2. Note: if time has passed since last add, recalculate offsets relative to **current** active bin
3. `withdraw-liquidity --pool-id <id> --positions <json>` — submit transaction
4. Verify txid in explorer

## Error Handling

| Error | Action |
|-------|--------|
| `Wallet is locked` | Run wallet unlock, then retry |
| `No executable route found` | Try different token pair or check `routes` for alternatives |
| `Price impact too high` | Reduce `--amount-in` or escalate to whoabuddy |
| `Insufficient balance` | Check STX/token balance; do not retry with same amount |
| Network timeout | Retry once after 30s; if it fails again, check explorer for pending tx before retrying |

## Output Fields to Extract

- Swap result: `txid`, `swap.priceImpact.combinedImpactPct`, `explorerUrl`
- LP status: `positions[].activeBinOffset`, `positions[].liquidityAmount`
- Quote: `bestExecutableRoute.expectedAmountOut`, `priceImpact.severity`

## Escalation Triggers

- Any swap >10 STX equivalent
- Price impact severity = `high`
- Liquidity withdrawal of >50% of position
- Unexpected error on mainnet write operation
