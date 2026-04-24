---
name: eic-payout
description: Pay the Editor-in-Chief a flat daily rate in sBTC after brief inscribe
tags:
  - publishing
  - payments
---

# eic-payout

Pays the single Editor-in-Chief a flat **400,000 sats/day** in sBTC after the daily brief is compiled and inscribed. Supersedes the per-beat `editor-payout` skill (retired 2026-04-24) under the EIC trial (#634).

## Pipeline Position

```
EIC reviews signals across all 3 beats → daily-brief-compile (05:00 UTC)
  → daily-brief-inscribe (07:00 UTC)
  → editor-spot-check (3x/day, hygiene only)
  → eic-payout (09:00-14:00 UTC window)
  → balance-check follow-on (scripted, post-execute)
```

## Economics

- **Rate:** flat 400,000 sats/day to the EIC — not per-beat, not scaled by volume.
- **Trigger:** fires iff ≥1 of the 3 active beats (`aibtc-network`, `bitcoin-macro`, `quantum`) had any signals in yesterday's inscribed brief.
- **Editor-covered downstream:** correspondents, Sales DRI comp, Distribution DRI comp all flow through the EIC's pool — Publisher does not pay any of them directly.

## CLI Commands

```
arc skills run --name eic-payout -- calculate --date YYYY-MM-DD
```
Dry-run: reads registry, counts signals per beat, checks spot-check gate and sBTC balance, outputs payout plan. Does not send.

```
arc skills run --name eic-payout -- execute --date YYYY-MM-DD
```
Sends 400K sBTC to the EIC, records in `eic_payouts` table, and creates a script-only `balance-check --next-date <tomorrow>` follow-on task. Idempotent (skips if already sent for date).

```
arc skills run --name eic-payout -- status --date YYYY-MM-DD
```
Read-only audit: returns the `eic_payouts` row for the date.

```
arc skills run --name eic-payout -- balance-check --next-date YYYY-MM-DD
```
Script-only check. Exits 0 if current sBTC balance ≥ 400K; exits 1 visibly if short so Publisher can top up before the next day's send.

## Audit Trail (`eic_payouts` table)

| Column | Purpose |
|--------|---------|
| `date` | UTC editorial day the payout covers (UNIQUE) |
| `editor_name` | EIC display name at time of payout |
| `editor_btc_address` / `editor_stx_address` | Frozen at payout time from `editor_registry` |
| `amount_sats` | Always 400,000 during the trial |
| `beats_with_signals` | JSON array of beat slugs that had signals in the brief |
| `signals_total` | Count of signals in the brief (all beats combined) |
| `txid` | sBTC transaction id after send |
| `status` | pending / sent / failed |
| `spot_check_task_id` | Linked spot-check task (informational — not a gate) |

## Editor Source

Reads from the shared `editor_registry` table (populated by `editor-payout registry set` during Phase 2 of the EIC trial). During the trial all three beat_slug rows should point to the same editor — v3 validates that and uses the first row's addresses. If the registry ever shows divergent editors per beat, `calculate` and `execute` refuse to run.

## Sensor

Fires 09:00-14:00 UTC. Gates:
1. `daily-brief-inscribe` hookState shows it fired today
2. `editor_registry` populated and consistent (all rows same editor)
3. ≥1 beat with signals in yesterday's brief

Spot-check status is logged as informational, not a gate.

## Dependencies

- **bitcoin-wallet** — wallet unlock, sBTC send
- **editor-spot-check** — hygiene check (informational)
- **nonce-manager** — Stacks nonce management for sBTC transfers

## Lineage

- v1 — `brief-payout` (correspondent-level, retired when editor model adopted)
- v2 — `editor-payout` (per-beat editors, 175K×beat, retired 2026-04-24 under #634)
- **v3 — `eic-payout`** (single EIC, flat 400K, current)
