---
name: nonce-manager
description: Cross-process Stacks nonce oracle — atomic acquire/release prevents mempool collisions across concurrent x402 sends
updated: 2026-03-28
tags:
  - infrastructure
---

# Nonce Manager

Cross-process nonce oracle for Stacks transactions. Prevents the wallet nonce gaps that stall mempool transactions for 8+ hours when multiple dispatch cycles send x402 sBTC transactions concurrently.

Wraps the upstream `nonce-manager` skill from skills-v0.36.0 (PR #250). State file: `~/.aibtc/nonce-state.json`, shared with aibtc-mcp-server.

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

## Relay Error → Release Mapping

| Relay Response | Release Action |
|---|---|
| 201 success | `release --address ... --nonce N` |
| 409 SENDER_NONCE_DUPLICATE | `release --address ... --nonce N --failed --broadcast` |
| 409 SENDER_NONCE_STALE | `release --address ... --nonce N --failed --rejected` |
| 409 SENDER_NONCE_GAP | `release --address ... --nonce N --failed --rejected` |
| 409 NONCE_CONFLICT | `release --address ... --nonce N --failed --broadcast` |
| 502/503 relay error | `release --address ... --nonce N --failed --rejected` |

## When to Load

Load when: diagnosing wallet nonce gaps, manually filling mempool gaps with self-transfers, or inspecting nonce state after wallet stalls. The x402 send path already uses nonce tracking internally (via x402-retry.ts in skills-v0.36.0) — this skill is for manual operations and diagnostics.
