---
name: editor-payout
description: RETIRED 2026-04-24 — superseded by eic-payout. Kept as historical reference.
tags:
  - publishing
  - payments
  - retired
---

# editor-payout (RETIRED 2026-04-24)

**This skill is retired. Superseded by `skills/eic-payout/` under the Editor-in-Chief trial (#634).**

- Sensor file renamed to `sensor.ts.retired` so the sensors service no longer picks it up.
- An early `return "skip"` is also wired into the sensor function as belt-and-suspenders if the file is ever put back.
- CLI still works for reading historical state (`registry list`, `status --date ...`); do not use for new payouts.
- `editor_payouts` audit table preserved intact with historical Orb/Coda/Zen rows through 2026-04-23.

Active payout pipeline: `skills/eic-payout/`.

---

## Historical context (pre-retirement)

Pays beat editors after the daily brief is compiled and inscribed. Replaces the correspondent-level `brief-payout` skill — editors receive a flat rate per beat and are responsible for paying their own correspondents.

## Pipeline Position

```
editors review signals → daily-brief-compile (05:00 UTC) → daily-brief-inscribe (07:00 UTC)
  → editor-spot-check (3x/day) → editor-payout (09:00-14:00 UTC, gated by spot-check)
```

## How Editor Payouts Work

1. **Spot-check gate:** At least one spot-check task must have completed for today (or the 01:00 UTC window expired with no flags)
2. **Brief inclusion check:** For each active beat, verify at least 1 signal was included in today's brief
3. **Editor lookup:** Resolve editor BTC address per beat from cached registry (sourced from aibtc.news API)
4. **Payment:** 175,000 sats per editor per beat via sBTC transfer
5. **Audit:** Every payout recorded in local `editor_payouts` SQLite table with txid, linked spot-check task, and timestamps

## Economics

- **Rate:** 175,000 sats per beat per day (only if beat has signals in brief)
- **Max daily cost:** 525,000 sats (3 beats x 175K)
- **Editor responsibility:** Pay correspondents from their allocation

## CLI Commands

```
arc skills run --name editor-payout -- calculate --date YYYY-MM-DD
```
Dry run: check spot-check gate, count signals per beat, resolve editor addresses, output payout plan.

```
arc skills run --name editor-payout -- execute --date YYYY-MM-DD
```
Execute payouts: send sBTC transfers, record txids to local DB. Supports resume on partial failure.

```
arc skills run --name editor-payout -- status --date YYYY-MM-DD
```
Check payout status for a date.

```
arc skills run --name editor-payout -- registry list
```
Show cached editor registry.

```
arc skills run --name editor-payout -- registry refresh
```
Refresh editor registry from aibtc.news API (fetches beat members, identifies editors).

```
arc skills run --name editor-payout -- registry set --beat SLUG --btc-address ADDR --stx-address ADDR --name NAME
```
Manually set editor for a beat (fallback when API doesn't expose editor role).

## Audit Trail

All payouts recorded in `editor_payouts` table in `db/arc.sqlite`:

| Column | Purpose |
|--------|---------|
| `date` | UTC editorial day |
| `beat_slug` | Which beat |
| `editor_btc_address` | Editor's BTC address (from registry at time of payout) |
| `editor_stx_address` | Resolved Stacks address for sBTC |
| `amount_sats` | 175,000 |
| `signals_included` | Count of signals from this beat in brief |
| `txid` | sBTC transaction ID after send |
| `status` | pending/sent/confirmed/failed |
| `spot_check_task_id` | Links to the spot-check task that gated this payout |

Query example: `SELECT * FROM editor_payouts WHERE date = '2026-04-13' ORDER BY beat_slug`

## Editor Registry

Cached in `editor_registry` table in `db/arc.sqlite`. Refreshed from API or set manually via CLI.

| Column | Purpose |
|--------|---------|
| `beat_slug` | Beat this editor manages |
| `editor_name` | Human-readable name |
| `btc_address` | Editor's BTC address |
| `stx_address` | Editor's Stacks address (for sBTC) |
| `cached_at` | When this entry was last refreshed |
| `source` | "api" or "manual" |

## Sensor

Safety-net trigger at 09:00-14:00 UTC (same window as old brief-payout). Gated by:
1. Inscription completed for today
2. At least one spot-check task completed (or 01:00 UTC window passed)
3. Editor registry populated for active beats

## Dependencies

- **bitcoin-wallet** -- wallet unlock, sBTC balance, signing
- **editor-spot-check** -- spot-check gate
- **contact-registry** -- BTC->STX address resolution fallback

## Escalation

If sBTC balance insufficient or editor address unresolvable, task goes `blocked` and escalates.
