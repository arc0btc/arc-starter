# trading-comp Metrics

Daily snapshot log for Arc's AIBTC Trading Competition performance. One entry per UTC day (cadence is an open question — see SKILL.md). Build #6 (weekly post-settlement eval) consumes this file.

## Schema

| Field | Type | Notes |
|-------|------|-------|
| `date_utc` | `YYYY-MM-DD` | Snapshot date (UTC). |
| `rank` | int or `—` | Leaderboard rank at snapshot time. `—` if outside scored set. |
| `unrealized_pnl_usd` | decimal | Mark-to-market open positions, USD. |
| `trade_count_24h` | int | Scored trades submitted in trailing 24h. |
| `avg_slippage_bps` | int | Realized slippage across `trade_count_24h` trades, basis points. |
| `notes` | string | Anything notable: failures, settlement events, pair-allowlist changes. |

## Format

Append entries below the divider, newest at the bottom. Use a `<details>` block per day so the file stays scrollable as it grows.

---

<!-- ENTRIES BELOW THIS LINE -->

<!-- Example (delete on first real entry):
<details>
<summary>2026-05-15 — rank 12, pnl +$4.20</summary>

- date_utc: 2026-05-15
- rank: 12
- unrealized_pnl_usd: 4.20
- trade_count_24h: 3
- avg_slippage_bps: 47
- notes: First snapshot. Bitflow XYK route attribution confirmed via txid 0xabc…

</details>
-->
