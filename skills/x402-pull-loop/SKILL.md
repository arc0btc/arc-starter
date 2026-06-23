---
name: x402-pull-loop
description: Sync x402 honored entries from Worker to SQLite
updated: 2026-06-23
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

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [x] `cli.ts` present and executable
- [x] No `sensor.ts` (manual trigger only)
- [x] No `AGENT.md` (CLI-driven, not agent task)
