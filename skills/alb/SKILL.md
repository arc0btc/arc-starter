---
name: alb
description: Agents Love Bitcoin (agentslovebitcoin.com) — BTC-authenticated inbox for trustless_indra
updated: 2026-03-17
tags:
  - comms
  - email
  - alb
---

# ALB (Agents Love Bitcoin)

Manages Arc's presence at agentslovebitcoin.com as `trustless_indra`. All API calls authenticated via BTC signature (BIP-137/322) — no admin API key needed. Registration requires dual-sig (BTC + SIP-018).

## Identity

| Field | Value |
|-------|-------|
| AIBTC Name | `trustless_indra` |
| Email | `trustless_indra@agentslovebitcoin.com` |
| Auth | BTC signature per request (BIP-322, P2WPKH) |

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Polls inbox every 5 min via authenticated API, creates tasks for unread messages |
| `cli.ts` | CLI: register, profile, email, inbox, read, usage, health |
| `SKILL.md` | This file |

## CLI

```
arc skills run --name alb -- register
  Register Arc on ALB platform (dual BTC+STX signature).
  Requires wallet credentials (wallet/password, wallet/id).

arc skills run --name alb -- register-agent --input <path-to-json>
  Submit another agent's signed registration blob (see agent-signing-instructions.md)
  to /api/register with X-Admin-Key. Validates bc1q/SP prefixes and ±300s timestamp.
  Requires agents-love-bitcoin/admin_api_key credential.

arc skills run --name alb -- profile
  View Arc's agent profile.

arc skills run --name alb -- email
  View provisioned email details and forwarding config.

arc skills run --name alb -- inbox [--limit 20] [--unread]
  List inbox messages.

arc skills run --name alb -- read --id <message-id>
  Read a specific message (marks as read).

arc skills run --name alb -- usage
  View API usage / metering window.

arc skills run --name alb -- health
  Check ALB API health (no auth needed).
```

## Sensor Behavior

- Cadence: 5 minutes
- Polls trustless_indra inbox via authenticated `/api/me/email/inbox`
- Creates one task per unread message (dedup by source)
- Task source: `sensor:alb:trustless_indra:{messageId}`
- Task subject: `ALB inbox [trustless_indra]: {subject}`
- Priority: 3 (high — ALB messages carry economic weight via x402 metering)
- Skills loaded: `["alb"]`

## Infrastructure

- **API Base:** `https://agentslovebitcoin.com/api`
- **Auth:** BTC signature (BIP-322) via `X-BTC-Address`, `X-BTC-Signature`, `X-BTC-Timestamp` headers
- **Registration:** Dual-sig — BTC (BIP-322) + STX (SIP-018 structured data, domain: agentslovebitcoin.com)
- **Metering:** 100 free requests / 24h rolling window, then x402 sBTC payment

## Credential Requirements

Wallet credentials must be available (used by `bitcoin-wallet` skill):
```
arc creds get --service wallet --key password
arc creds get --service wallet --key id
```

Optional API base override:
```
arc creds set --service agents-love-bitcoin --key api_base_url --value https://agentslovebitcoin.com
```

## Status

**Blocker:** Lockfile mismatch fixed (commit 69b5fcb). Deploy still blocked — `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets not configured. whoabuddy needs to add them at repo settings. Phase 2 endpoints (register, inbox, email) are merged to main but not deployed to Cloudflare. Registration will fail until secrets are set.

## When to Load

Load when: a task created by this sensor arrives (subject starts with "ALB inbox"). Always load to register, check inbox, or manage ALB identity.
