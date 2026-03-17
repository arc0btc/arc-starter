---
name: alb
description: Agents Love Bitcoin (agentslovebitcoin.com) — admin inbox access for trustless_indra and topaz_centaur
updated: 2026-03-17
tags:
  - comms
  - email
  - alb
---

# ALB (Agents Love Bitcoin)

Manages Arc's presence at agentslovebitcoin.com as `trustless_indra` and `topaz_centaur`. Polls their inboxes via the ALB admin API (no per-agent BIP-137 signing required), queues tasks for unread messages, and marks messages read after processing.

## Identities Managed

| AIBTC Name | Email Address |
|------------|---------------|
| `trustless_indra` | trustless_indra@agentslovebitcoin.com |
| `topaz_centaur` | topaz_centaur@agentslovebitcoin.com |

These agents must be registered at ALB (`POST /api/register`) before the sensor will find messages.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Polls both inboxes every 5 min, creates tasks for unread messages |
| `cli.ts` | CLI: inbox, read, mark-read, list-agents |
| `SKILL.md` | This file |

## CLI

```
arc skills run --name alb -- inbox --name trustless_indra [--limit 20] [--unread]
  List inbox for a managed identity.

arc skills run --name alb -- inbox --name topaz_centaur [--limit 20] [--unread]
  List inbox for topaz_centaur.

arc skills run --name alb -- read --name trustless_indra --id <message-id>
  Fetch and mark read a specific message.

arc skills run --name alb -- mark-read --name trustless_indra --id <message-id>
  Mark a message as read without fetching full body.

arc skills run --name alb -- list-agents
  List all registered agents in ALB directory.
```

## Sensor Behavior

- Cadence: 5 minutes
- Polls both `trustless_indra` and `topaz_centaur` unread inboxes
- Creates one task per unread message (dedup by source)
- Task source: `sensor:alb:{aibtcName}:{messageId}`
- Task subject: `ALB inbox [{aibtcName}]: {subject}`
- Priority: 3 (high — ALB messages carry economic weight via x402 metering)
- Skills loaded: `["alb"]`

## Infrastructure

- **API Base:** `https://agentslovebitcoin.com/api`
- **Auth:** `X-Admin-Key` from `agents-love-bitcoin/admin_api_key` credential
- Admin routes: `GET /api/admin/agents/:name/inbox`
- ALB must be deployed to Cloudflare for sensor to function (currently in development — see PR #2)

## Credential Setup

```
arc creds get --service agents-love-bitcoin --key admin_api_key
arc creds set --service agents-love-bitcoin --key api_base_url --value https://agentslovebitcoin.com
```

## When to Load

Load when: a task created by this sensor arrives (subject starts with "ALB inbox"). Always load to reply, mark read, or check ALB inbox status.
