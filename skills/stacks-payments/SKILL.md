---
name: stacks-payments
description: Watch Stacks blockchain for STX payments to Arc's address and create service tasks from arc: memo codes
updated: 2026-03-06
tags:
  - payments
  - stacks
  - sensor
  - monetization
---

# stacks-payments

Monitors the Stacks blockchain for confirmed STX transfers to Arc's address (`SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`). Decodes memo fields, matches against known service codes, and creates dispatch tasks for valid payments.

This is the server-side counterpart to the `/services/order` page on arc0.me, which uses `@stacks/connect` for human wallet payments.

## Sensor Behavior

- **Cadence:** Every 3 minutes
- **API:** Hiro Stacks API (`/extended/v1/address/{principal}/transactions`)
- **State:** Tracks `last_block_height` in hook state to avoid reprocessing

For each confirmed transfer to Arc's address:
1. Decode hex memo to UTF-8
2. Match against `arc:` service prefix table
3. Validate minimum payment amount (dust attack prevention)
4. Dedup by txid (one task per transaction, ever)
5. Create dispatch task with sender address, txid, and service context

## Service Routing

| Memo | Min STX | Task Priority | Model | Skills |
|------|---------|---------------|-------|--------|
| `arc:arxiv-latest` | 5 STX | P6 | Sonnet | arxiv-research |
| `arc:ask-quick` | 1 STX | P8 | Haiku | — |
| `arc:ask-informed` | 5 STX | P6 | Sonnet | — |
| `arc:pr-standard` | 40 STX | P5 | Sonnet | aibtc-repo-maintenance |

## Memo Format

STX memos are 34-byte buffers encoded as hex in the Stacks API. The sensor:
1. Strips the `0x` prefix
2. Decodes hex → UTF-8
3. Strips trailing null bytes
4. Matches against service prefix table

## Ask Arc / PR Review Delivery

For services requiring additional input (question, PR URL), the task description instructs dispatch to:
1. Check X DMs from the sender's Stacks address
2. Or cross-reference @arc0btc DMs where sender quotes the txid
3. Reference the txid in all responses for verification

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file |
| `sensor.ts` | Yes | Blockchain polling + task creation |

## When to Load

Not typically loaded into dispatch context — sensor-only skill. Load SKILL.md if debugging payment routing or adding new service codes.

## Adding New Service Codes

Edit `SERVICE_MAP` and `MIN_AMOUNTS` in `sensor.ts`. Convention:
- Memo format: `arc:<service-name>` (ASCII, max 34 bytes total)
- Amount: 3x API cost baseline in microSTX
- Model: match to complexity (haiku/sonnet/opus)
- Skills: include any skill that provides relevant context for delivery
