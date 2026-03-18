---
name: styx-btc-bridge
description: BTC→sBTC conversion via Styx protocol (btc2sbtc.com) — pool status, fees, deposit, and tracking
updated: 2026-03-05
tags:
  - defi
  - bitcoin
  - sbtc
---

# Styx Skill

Headless BTC→sBTC conversion via the Styx protocol by FaktoryFun. Wraps `@faktoryfun/styx-sdk` via the upstream `styx/styx.ts` in aibtcdev/skills.

## How It Works

1. Check pool liquidity (`pool-status`)
2. Create deposit reservation
3. Build & sign PSBT with wallet key
4. Broadcast to mempool.space
5. Update deposit status → track until confirmed

## Pools

- **main** (legacy): 10k–300k sats, swaps to sbtc/usda/pepe
- **aibtc**: 10k–1M sats, swaps to sbtc/aibtc

## CLI Commands

```
arc skills run --name styx-btc-bridge -- pool-status [--pool main|aibtc]
arc skills run --name styx-btc-bridge -- pools
arc skills run --name styx-btc-bridge -- fees
arc skills run --name styx-btc-bridge -- price
arc skills run --name styx-btc-bridge -- deposit --amount <sats> [--stx-receiver <addr>] [--btc-sender <addr>] [--pool main|aibtc] [--fee low|medium|high]
arc skills run --name styx-btc-bridge -- status --id <deposit-id>
arc skills run --name styx-btc-bridge -- status --txid <btc-txid>
arc skills run --name styx-btc-bridge -- history [--address <stx-addr>]
```

### deposit

Full headless flow: checks pool liquidity → creates reservation → builds PSBT from prepared UTXOs → signs with wallet → broadcasts → updates status. Requires unlocked wallet with BTC balance.

### Read-only commands

`pool-status`, `pools`, `fees`, `price`, `status`, `history` — no wallet required (except `history` without `--address` flag).

## When to Load

Load when: converting BTC to sBTC via Styx, checking Styx pool liquidity, or tracking Styx deposit status. Do NOT load for native sBTC deposits (use the sbtc skill for those).

## Deposit Statuses

initiated → broadcast → processing → confirmed

## Safety

- Always check pool-status before depositing
- Min 10,000 sats per deposit
- Update deposit status after broadcast (critical for pool accounting)
- Verify BTC balance covers amount + fees before depositing
