---
name: arc-payments
description: Watch Stacks blockchain for STX and sBTC payments to Arc's address and create service tasks from arc: memo codes
updated: 2026-03-12
tags:
  - payments
  - stacks
  - sbtc
  - sensor
  - monetization
---

# arc-payments

Monitors the Stacks blockchain for confirmed STX transfers and sBTC SIP-010 transfers to Arc's address (`SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`). Decodes memo fields, matches against known service codes, and creates dispatch tasks for valid payments.

This is the server-side counterpart to the `/services/order` page on arc0.me, which uses `@stacks/connect` for human wallet payments.

Renamed from `stacks-payments` on 2026-03-12 to reflect broader payment scope (STX + sBTC).

## Sensor Behavior

- **Cadence:** Every 3 minutes
- **API:** Hiro Stacks API (`/extended/v1/address/{principal}/transactions`)
- **State:** Tracks `last_block_height` in hook state to avoid reprocessing

For each confirmed transaction to Arc's address:
1. Identify payment type (STX token_transfer or sBTC SIP-010 contract_call)
2. Decode memo (hex for STX, Clarity repr for sBTC)
3. Match against `arc:` service prefix table
4. Validate minimum payment amount (dust attack prevention, currency-specific)
5. Dedup by txid (one task per transaction, ever)
6. Create dispatch task with sender address, txid, currency, and service context

## Payment Types

### STX Token Transfers
Direct `token_transfer` transactions with hex-encoded 34-byte memo field.

### sBTC SIP-010 Transfers
Contract calls to `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` with `transfer` function. The optional `(buff 34)` memo argument carries the `arc:` service prefix. The Stacks Extended API returns decoded function args — no custom ABI parsing needed.

## Service Routing

### STX Minimums

| Memo | Min STX | Task Priority | Model | Skills |
|------|---------|---------------|-------|--------|
| `arc:arxiv-latest` | 5 STX | P6 | Sonnet | arxiv-research |
| `arc:ask-quick` | 1 STX | P8 | Haiku | — |
| `arc:ask-informed` | 5 STX | P6 | Sonnet | — |
| `arc:pr-standard` | 40 STX | P5 | Sonnet | aibtc-repo-maintenance |

### sBTC Minimums (satoshis)

| Memo | Min sats | ~USD | Task Priority | Model | Skills |
|------|----------|------|---------------|-------|--------|
| `arc:arxiv-latest` | 5,000 | ~$5 | P6 | Sonnet | arxiv-research |
| `arc:ask-quick` | 1,000 | ~$1 | P8 | Haiku | — |
| `arc:ask-informed` | 5,000 | ~$5 | P6 | Sonnet | — |
| `arc:pr-standard` | 40,000 | ~$40 | P5 | Sonnet | aibtc-repo-maintenance |

## Memo Format

**STX:** 34-byte buffers encoded as hex. Sensor strips `0x` prefix, decodes hex → UTF-8, strips trailing null bytes.

**sBTC:** Optional `(buff 34)` in the SIP-010 `transfer` call. Extracted from Clarity repr via the decoded function_args in the API response.

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

Edit `SERVICE_MAP`, `MIN_AMOUNTS_STX`, and `MIN_AMOUNTS_SBTC` in `sensor.ts`. Convention:
- Memo format: `arc:<service-name>` (ASCII, max 34 bytes total)
- STX amount: 3x API cost baseline in microSTX
- sBTC amount: USD-equivalent in satoshis at ~$100k BTC
- Model: match to complexity (haiku/sonnet/opus)
- Skills: include any skill that provides relevant context for delivery
