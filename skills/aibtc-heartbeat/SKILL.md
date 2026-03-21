---
name: aibtc-heartbeat
description: Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing
updated: 2026-03-09
tags:
  - aibtc
  - heartbeat
  - sensor
---

# AIBTC Heartbeat

Sensor-only skill. Performs a signed check-in to the AIBTC platform every 5 minutes. No LLM needed — pure TypeScript.

## How It Works

1. Loads all wallets (primary + legacy) for the current agent via `getAgentWallets()`
2. For each wallet, signs `"AIBTC Check-In | {ISO_TIMESTAMP}"` using BIP-137
3. POSTs `{timestamp, signature, btcAddress}` to `https://aibtc.com/api/heartbeat`
4. Logs response per wallet (level, checkInCount, unreadCount)
5. If `unreadCount > 0` for any wallet, creates a per-wallet task to read the AIBTC inbox

## Rate Limit

The AIBTC API allows 1 check-in per 5 minutes per address. The sensor cadence matches this limit. Each wallet checks in independently.

## Credentials

Each wallet requires its own credential pair in the Arc creds store:

| Wallet | Service | Keys |
|--------|---------|------|
| Primary | `bitcoin-wallet` | `id`, `password` |
| Legacy | `bitcoin-wallet-{label}` | `id`, `password` |

Example: a legacy wallet with label `spark-v0.11` uses service `bitcoin-wallet-spark-v0.11`.

## Dependencies

- Wallet skill (`skills/bitcoin-wallet/sign-runner.ts`) for BTC message signing
- Identity module (`src/identity.ts`) for multi-wallet resolution

## When to Receive This Task

This skill is sensor-only — never explicitly loaded by dispatch. It runs autonomously every 5 minutes. If unread AIBTC inbox messages are detected, it creates a task with `skills: ["bitcoin-wallet"]` to handle the inbox. No dispatch task ever loads this skill directly.

## Checklist

- [x] `skills/aibtc-heartbeat/SKILL.md` exists with valid frontmatter
- [x] `skills/aibtc-heartbeat/sensor.ts` exports async default function returning `Promise<string>`
