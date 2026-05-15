# trading-comp-mirror — Agent Briefing

You are executing a task that involves the `trading-comp-mirror` skill. This skill watches competitor trades in the AIBTC Trading Competition.

## Key Files

- `skills/trading-comp-mirror/competitors.json` — list of competitor addresses to poll
- `skills/trading-comp-mirror/trades.json` — cached trade records (sensor-written, 500 max)
- `db/hook-state/trading-comp-mirror.json` — sensor state (do not edit manually)

## Competition API

Base: `https://aibtc.com/api/competition` (or `$AIBTC_CAMPAIGN_API_URL`)

Trade list endpoint:
```
GET /api/competition/trades?address=<STX_addr>[&limit=N][&cursor=<opaque>]
→ { trades: TradeRecord[], next_cursor?: string }
```
Rate limit: 300 reads/min per IP. At 10 competitor addresses + 10 min cadence, this is safe.

## Common Tasks

**Add a competitor:** Read `competitors.json`, append `{ "address": "<SP...>", "label": "<name>" }`, write back. Commit.

**Analyze pair frequency:** Run `arc skills run --name trading-comp-mirror -- stats --days 3` and interpret the output.

**Force a fresh poll:** Delete `db/hook-state/trading-comp-mirror.json`, then run `arc sensors`. The sensor will run immediately (no claimSensorRun gate).

**Check for missed trades:** The API is cursor-paginated (`next_cursor`). The sensor polls only `limit=50` per competitor per run. If a competitor has >50 trades since last check, older ones in that batch are silently skipped. At 10-min cadence this is unlikely but possible during high-activity bursts. If completeness matters, use the `competition` skill CLI with `--cursor` to page through manually.

## Gotchas

- `seen_txids` is bounded to the last 200 per competitor address. If Arc restarts or the hook state is deleted, the sensor re-detects the most recent 200 trades. This is expected behavior — `detected_at` timestamps will be fresh but `burn_block_time` reveals true trade time.
- The API returns `amount_in` / `amount_out` as strings (microSTX or contract-specific units). Do not compare amounts across token types without normalization.
- `tx_status` can be `"abort_by_response"` (Clarity assertion failed) — these are not successful swaps. Filter for `tx_status === "success"` when computing P&L.
- Campaign window: `COMP_START_TIMESTAMP = 1778700600` (2026-05-13T19:30:00Z). Trades before this timestamp are pre-competition and should be filtered out.
