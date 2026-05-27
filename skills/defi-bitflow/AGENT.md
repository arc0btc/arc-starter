---
id: defi-bitflow-agent
topics: [defi, bitflow, stacks, sbtc, market-intelligence, dca]
source: task:17744
created: 2026-05-27
---

# Bitflow DEX — Subagent Briefing (Market Intelligence & DCA)

You are executing market intelligence analysis or DCA automation on Bitflow DEX. This is the **market intelligence and DCA skill** — not for managing LP positions. If the task involves LP positions (add/remove liquidity, portfolio swaps), stop and load the `bitflow` skill instead.

---

## Skill Boundary

| Use `defi-bitflow` for | Use `bitflow` for |
|---|---|
| Analyzing spread/volatility data | Arc's own LP positions |
| Setting up DCA orders | Executing portfolio swaps |
| Reading Bitflow ticker/route data | Adding/withdrawing liquidity |
| High-spread market intelligence | Managing LP bins |

---

## Token ID Format

Bitflow uses its own token ID format — **not** full contract addresses.

| Token | Bitflow SDK ID |
|---|---|
| STX | `token-stx` |
| sBTC | `token-sbtc` |
| stSTX | `token-ststx` |

Never pass contract addresses like `SP...sbtc-token` to CLI commands — they will fail. Always use the SDK format above.

**API note (2026-03-18):** The Bitflow API removed `bid`/`ask` fields. Spread data now uses `(high - low) / last_price` as a volatility proxy. The `spreads` command reflects this calculation.

---

## API Endpoint

Base URL: `https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev`

Key endpoint: `GET /ticker` — returns all pairs with `high`, `low`, `last_price`, `base_volume`, `target_volume`, `liquidity_in_usd`.

---

## CLI Commands

All commands output single JSON objects.

```bash
# Get a swap quote (read-only)
arc skills run --name defi-bitflow -- quote \
  --token-x token-stx --token-y token-sbtc --amount-in <decimal>

# Execute a swap (write — mainnet, irreversible)
arc skills run --name defi-bitflow -- swap \
  --token-x token-stx --token-y token-sbtc --amount-in <decimal> [--slippage <decimal>]

# Get ticker data for all pairs or a specific pair
arc skills run --name defi-bitflow -- ticker \
  [--base-currency token-stx] [--target-currency token-sbtc]

# List all supported tokens
arc skills run --name defi-bitflow -- tokens

# Get available swap routes between two tokens
arc skills run --name defi-bitflow -- routes \
  --token-x token-stx --token-y token-sbtc

# Show pairs above spread threshold (default 15%)
arc skills run --name defi-bitflow -- spreads [--threshold <pct>]
```

### DCA Commands (planned — not yet implemented)

```bash
arc skills run --name defi-bitflow -- dca-create \
  --token-x token-stx --token-y token-sbtc --amount <decimal> --interval <hours>
arc skills run --name defi-bitflow -- dca-status
arc skills run --name defi-bitflow -- dca-cancel --order-id <id>
```

If DCA commands return `command not found` or similar, the feature is not yet implemented. Create a follow-up task to track implementation rather than retrying.

---

## Spread Analysis

The sensor runs every **60 minutes** and logs pairs where the daily high-low range exceeds 15% of last price, filtered by `liquidity_in_usd >= $10,000 USD`. It logs intelligence only — no tasks are created.

**Default spread threshold:** 15% (`BITFLOW_SPREAD_THRESHOLD` env var overrides)

**Liquidity filter:** $10,000 USD minimum (`MIN_LIQUIDITY_USD` in sensor.ts)

When running a manual spread analysis task:
1. `arc skills run --name defi-bitflow -- spreads` — shows current high-spread pairs
2. Review top pairs by spread percentage
3. If a pair shows >25% range, note it as notable intelligence in task output

---

## Beat-Scope Guard — CRITICAL

**Never file signals about Bitflow data to any news beat.**

Bitflow is a Stacks L2 DEX trading sBTC/STX/stSTX pairs. These are **DeFi volatility signals**, not ordinals, not quantum, not bitcoin-macro. Arc does not own a DeFi beat.

| Beat | Valid for Bitflow data? |
|---|---|
| `ordinals` | **No — beat-scope violation** |
| `bitcoin-macro` | **No — DeFi is not macro** |
| `quantum` | **No** |
| `aibtc-network` | Possibly, if the signal is about the AIBTC ecosystem broadly |

If a task asks you to file a Bitflow spread signal, close it as failed with: `"beat-scope violation: Bitflow DeFi data has no matching owned beat"`.

Signal filing is also currently **PAUSED** as of 2026-05-19 per whoabuddy policy — do not file signals regardless.

---

## Swap Safety

Before executing any swap:

1. `quote` — verify expected output and price impact
2. Check `priceImpact.severity`: `low` or `medium` = proceed; `high` = escalate to whoabuddy
3. Swaps with >5% price impact require `--confirm-high-impact` flag — do not pass this flag autonomously
4. Swap amounts capped at **10 STX per trade** (`BITFLOW_MAX_TRADE_STX` env var)
5. Wallet credentials required: `bitcoin-wallet/id` and `bitcoin-wallet/password`

Mainnet only — all transactions are real and irreversible.

---

## DCA via Keeper Contracts (Future)

DCA uses Bitflow Keeper contracts for scheduled recurring swaps. When implemented, the pattern is:

- `dca-create`: registers a recurring swap order with a Keeper contract on-chain
- Orders execute automatically when triggered by Keeper bots
- Parameters: source token, destination token, amount per execution, execution interval in hours
- Keeper contract addresses are embedded in `cli.ts` — do not hardcode them in tasks

Until DCA is fully implemented, Arc's recurring buys go through Jingswap (see `jingswap` skill).

---

## Signal Pipeline Relationship

The signal-pipeline pattern (JingSwap → P2P fallback) depends on this skill for **price context** when deciding deposit timing. Before a Jingswap deposit task, you may run:

```bash
arc skills run --name defi-bitflow -- ticker --base-currency token-sbtc --target-currency token-stx
```

to check current sBTC/STX pricing before committing a deposit. This is read-only — no auth needed.

---

## Error Handling

| Error | Action |
|---|---|
| API `!response.ok` | Retry once. If still failing, log and close task as failed. |
| Token ID format error | Verify using `tokens` command. Never use contract addresses. |
| `No route found` | Try `routes` to check available paths. Different token pair may be needed. |
| `Price impact too high` | Do not pass `--confirm-high-impact`. Escalate. |
| `Wallet locked` | Unlock credentials and retry once. |
| DCA command not found | Feature not yet implemented. Create follow-up task. |
| Beat-scope violation attempt | Close task as failed immediately. |

---

## Do Not

- **Do not use full contract addresses** as token IDs — use Bitflow SDK format (`token-stx`, `token-sbtc`).
- **Do not file signals** from Bitflow data to any news beat.
- **Do not confuse this skill with `bitflow`** — load `bitflow` for LP position management.
- **Do not exceed 10 STX** per swap without escalating.
- **Do not pass `--confirm-high-impact`** autonomously.
