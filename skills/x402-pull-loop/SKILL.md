---
name: x402-pull-loop
description: Sync x402 honored entries from Worker to SQLite — now sensor-driven, 60min cadence
updated: 2026-07-17
tags:
  - x402
  - payments
  - sync
  - infrastructure
---

# x402-pull-loop

Syncs HTTP 402 honored payment entries from the arc0btc Worker to the local SQLite `x402_sale` table. Single writer, uses Compare-And-Swap (CAS) state guard to prevent downgrades.

## Purpose

The x402 payment system tracks confirmed payments in the `x402_sale` table. This skill reads honored entries from the Worker's `/api/x402/honored` endpoint and upserts them with state protection — transitions `pending` → `confirmed` but never downgrades a terminal state.

## Usage

Pull from Worker (default, requires `WORKER_URL` env var):
```bash
WORKER_URL=https://arc0btc-worker.arc0.workers.dev arc skills run --name x402-pull-loop
```

Control-plane inject (override for testing or manual entry):
```bash
arc skills run --name x402-pull-loop -- --entry '{"chain":"stacks","txid":"0x...","payment_id":"pay_...","buyer_address":"SP...","product_slug":"research-daily","asset":"STX","amount_base_units":49627665,"provenance":"self_funded_test","confirmed_at":"2026-06-22T17:00:00Z"}'
```

## State Transitions

- **Insert**: New entry → `payment_status = 'confirmed'`
- **Update**: Only if current status is `pending` (terminal states unchanged)
- **No-op**: Entry exists with terminal status (no change)

## Architecture Notes

Single-writer design ensures no race conditions on the `x402_sale` table. The upsert uses `ON CONFLICT DO UPDATE` with conditional SET to enforce the state machine.

## Cadence (added 2026-07-17, control-plane-remediation P4, defect-register row 18)

`sensor.ts` claims a run every 60 minutes and, if none is already pending, queues a dispatch task
that runs `arc skills run --name x402-pull-loop` (Worker-pull mode). This gives the sync loop a
verifiable cadence in `db/hook-state/x402-pull-loop.json` for the first time -- previously the
CLI was genuinely never invoked automatically (no crontab, no systemd timer, no calling code
anywhere in the repo), so `x402_sale`'s staleness (register row 13) couldn't be distinguished from
a dead sync path. A 404 from the Worker's `/api/x402/honored` endpoint (not yet implemented) is
expected and handled by `cli.ts` — it does not mark the hook-state run as an error.

Direct `--entry` control-plane injection (for testing or manual entry) remains fully supported and
unaffected by the sensor.

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [x] `cli.ts` present and executable
- [x] `sensor.ts` present — queues a periodic Worker-pull task (see Cadence above); manual
      `--entry` injection still works directly via `cli.ts`
- [x] No `AGENT.md` (CLI-driven, not agent task)
