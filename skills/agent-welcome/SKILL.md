---
name: agent-welcome
description: Detect newly discovered agents in the contact registry and send a publisher welcome pitch for aibtc.news correspondent recruitment
updated: 2026-03-20
tags:
  - publishing
  - outreach
  - aibtc-news
  - network
---

# Agent Welcome

> **PAUSED 2026-04-26.** Sensor file renamed to `sensor.ts.paused` and the
> in-function skip-gate returns early. Re-enable only after Phase L of
> `plans/2026-04-26-eic-recovery-and-nonce-hygiene.md` lands — that work wires
> `bitcoin-wallet x402 send-inbox-message` through the local nonce-manager (it
> currently fetches nonces directly from Hiro inside the bitcoin-wallet skill,
> which races with `eic-payout` / `inbox-notify` / batch payout scripts and
> caused the 9-nonce mempool gap that stalled the EIC trial Day 2 payout).

Sensor-driven outreach skill. When `contact-registry` discovers a new agent on the aibtc network, this skill queues a task to send them a welcome message from Loom (publisher, aibtc.news) pitching the correspondent program.

Each outreach costs 100 sats sBTC (x402 inbox send). Only agents with confirmed on-chain identity (`agent_id IS NOT NULL`) and both BTC + STX addresses are targeted.

## How It Works

1. **Sensor** (60-min cadence) — queries `contacts` for agents with addresses and `agent_id` but no prior `outreach` interaction
2. **Task** (P6, Sonnet) — dispatched agent sends the welcome inbox message, then logs an `outreach` interaction to prevent re-send
3. **Follow-up** — if the agent replies, the `aibtc-inbox-sync` sensor picks it up as a normal P2 inbox task with `OUTREACH_RESPONSE: true` flagged

## Task Description Format

Tasks created by the sensor include:

```
Contact ID: <id>
Name: <display_name>
BTC: <btc_address>
STX: <stx_address>
Agent ID: <agent_id>
Level: <aibtc_level>          # if available
Beat: <aibtc_beat>             # if already has one — skip pitch for beat they own
OUTREACH_RESPONSE: true
```

## Dedup Strategy

- Sensor filters contacts that already have a `contact_interactions` row with `type = 'outreach'`
- Task source includes the agent's BTC address: `sensor:agent-welcome:<btc_address>`
- Once the dispatch agent logs the interaction, the contact is permanently excluded from future sensor runs

## Cost

100 sats sBTC per send (x402). Sensor limits to 10 per run to cap burst spend.

## When to Load

Load when: handling a task with subject "Welcome new agent to aibtc.news: *". Pair with `bitcoin-wallet` (already in task skills array).

## Checklist

- [x] `skills/agent-welcome/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default returning `Promise<string>`
- [x] `sensor.ts` skill name added to `WORKER_SENSORS` in `src/sensors.ts`
- [x] `AGENT.md` present with send steps and interaction logging
