---
name: nonce-manager
description: Backup sender nonce tracker for Stacks transactions — use canonical payment-status polling (by paymentId) as primary x402 state machine
updated: 2026-04-03
tags:
  - infrastructure
---

# Nonce Manager

Backup sender nonce tracker for Stacks transactions. Prevents wallet nonce gaps when multiple dispatch cycles send concurrently.

Canonical x402 payment state comes from polling `checkUrl` by `paymentId` — that is the primary state machine. This skill handles local sender nonce coordination and recovery only.

Wraps the upstream `nonce-manager` skill from skills-v0.36.2 (PR #250, #279, #290). State file: `~/.aibtc/nonce-state.json`, shared with aibtc-mcp-server.

## How It Works

1. `acquire` — atomically reserves the next nonce (mkdir-based cross-process lock)
2. Send transaction using acquired nonce
3. `release` — records outcome (success, broadcast failure, or rejected pre-broadcast)

Auto-syncs from Hiro API when state is stale (>90s since last sync).

## CLI Commands

```
arc skills run --name nonce-manager -- acquire --address SP...
arc skills run --name nonce-manager -- release --address SP... --nonce 42
arc skills run --name nonce-manager -- release --address SP... --nonce 42 --failed
arc skills run --name nonce-manager -- release --address SP... --nonce 42 --failed --rejected
arc skills run --name nonce-manager -- sync --address SP...
arc skills run --name nonce-manager -- status
arc skills run --name nonce-manager -- status --address SP...
arc skills run --name nonce-manager -- queue-check --address SP... [--relay-url URL]
```

### acquire

Reserves the next nonce for an address. Atomically increments state. Auto-syncs from Hiro if state is stale.

```json
{ "nonce": 42, "address": "SP...", "source": "local" }
```

### release

Records transaction outcome after broadcast or failure.

- Default: success (tx confirmed)
- `--failed`: tx failed, assume nonce was broadcast (consumed, do NOT roll back)
- `--failed --rejected`: tx never reached mempool, nonce NOT consumed (safe to roll back)

```json
{ "address": "SP...", "nonce": 42, "action": "confirmed" }
```

### sync

Force re-sync from Hiro API. Use after manual intervention or mempool clearance.

```json
{ "nonce": 43, "address": "SP...", "mempoolPending": 2, "lastExecuted": 42, "detectedMissing": [] }
```

### status

Show tracked nonce state for one or all addresses.

### queue-check

Query the relay's dispatch queue for a sender address — shows queue position and pending txs. Useful for stuck-tx triage without waiting for cycle timeout.

```json
{ "address": "SP...", "pending": [], "queuePosition": 0 }
```

Default relay: `https://x402-relay.aibtc.com`. Override with `--relay-url`.

## Payment Status → Release Mapping (v0.36.2+)

Use canonical payment status (from `checkUrl` polling) first. `terminalReason` is the normalized terminal signal.

| Canonical Status / terminalReason | Release Action |
|---|---|
| `confirmed` | `release --address ... --nonce N` |
| `replaced` / `not_found` | Stop polling old paymentId; `release --address ... --nonce N --failed --broadcast` |
| `failed` (terminal) | `release --address ... --nonce N --failed --broadcast` |

When canonical polling is unavailable, fall back to relay error codes:

| Relay Response | Release Action |
|---|---|
| 201 success | `release --address ... --nonce N` |
| 409 SENDER_NONCE_DUPLICATE | `release --address ... --nonce N --failed --broadcast` |
| 409 SENDER_NONCE_STALE | `release --address ... --nonce N --failed --rejected` |
| 409 SENDER_NONCE_GAP | `release --address ... --nonce N --failed --rejected` |
| 409 NONCE_CONFLICT | `release --address ... --nonce N --failed --broadcast` |
| 502/503 relay error | `release --address ... --nonce N --failed --rejected` |

## When to Load

Load when: diagnosing wallet nonce gaps, manually filling mempool gaps with self-transfers, or inspecting nonce state after wallet stalls. The x402 send path uses nonce tracking internally (via x402-retry.ts in skills-v0.36.2) and canonical payment-status polling as the primary state machine — this skill is for manual operations and diagnostics only.

## Changelog

**v0.36.2** (2026-04-03, PR #290): Architectural shift — canonical payment-status polling (by `paymentId` via `checkUrl`) is now the primary x402 state machine. nonce-manager demoted to backup sender nonce tracker. `terminalReason` is the normalized terminal signal for failed payments, replacing transport-level error classification. Local nonce release mapping now driven by canonical status states (`confirmed`, `replaced`, `not_found`); relay error code fallback preserved for when canonical polling is unavailable.

**v0.36.1** (2026-03-31, PR #279): `x402-retry.ts` now records `pending:{paymentId}` in the nonce tracker when payment is in pending state (no settlement txid yet) — previously stored empty string. Pairs with aibtc-mcp-server v1.46.1 which adds `payment` block (paymentId, status, checkUrl) to inbox responses. Together they close the payment observability gap for in-flight x402 transactions.
