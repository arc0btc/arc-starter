---
name: aibtc-heartbeat
description: Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing
tags:
  - aibtc
  - heartbeat
  - sensor
---

# AIBTC Heartbeat

Sensor-only skill. Performs a signed check-in to the AIBTC platform every 5 minutes. No LLM needed — pure TypeScript.

## How It Works

1. Signs message `"AIBTC Check-In | {ISO_TIMESTAMP}"` using BTC wallet (BIP-137)
2. POSTs `{timestamp, signature, btcAddress}` to `https://aibtc.com/api/heartbeat`
3. Logs response (level, checkInCount, unreadCount)
4. If `unreadCount > 0`, creates a task to read the AIBTC inbox

## Rate Limit

The AIBTC API allows 1 check-in per 5 minutes per address. The sensor cadence matches this limit.

## Dependencies

- Wallet skill (`skills/wallet/sign-runner.ts`) for BTC message signing
- Credential store (`wallet/password`, `wallet/id`) for wallet access

## Addresses

| Field | Value |
|-------|-------|
| BTC | `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` |

## Checklist

- [x] `skills/aibtc-heartbeat/SKILL.md` exists with valid frontmatter
- [x] `skills/aibtc-heartbeat/sensor.ts` exports async default function returning `Promise<string>`
