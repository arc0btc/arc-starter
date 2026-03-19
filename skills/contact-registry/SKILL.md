---
name: contact-registry
description: Contact management — agents, humans, addresses, handles, relationships, interaction history
updated: 2026-03-05
tags:
  - crm
  - network
  - data
---

# Contacts

Persistent contact store for Arc's network. Tracks agents, humans, on-chain addresses, social handles, relationships, and interaction history. Schema lives in `schema.ts` and is importable by other skills.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — orchestrator context |
| `AGENT.md` | Subagent briefing for contact management tasks |
| `schema.ts` | DB schema + types + query functions (importable) |
| `cli.ts` | CLI: list, show, add, update, link, interactions, log, search |

## Schema

Three tables in `db/arc.sqlite`:

- **contacts** — Core record. Fields: display_name, aibtc_name, bns_name (fallback chain for display), type (agent/human), status, visibility (public/private), addresses (stx/btc/taproot), handles (github/x/email/website), agent fields (agent_id, operator_contact_id FK, x402_endpoint, aibtc_beat, aibtc_level), notes.
- **contact_links** — Bidirectional relationships (contact_a_id, contact_b_id, relationship text, notes).
- **contact_interactions** — Interaction log (contact_id, task_id FK optional, type, summary, occurred_at).

Display name resolution: `display_name > aibtc_name > bns_name > "Contact #N"`.

## CLI

```
arc skills run --name contact-registry -- list [--status active|inactive|archived]
arc skills run --name contact-registry -- show --id <N>
arc skills run --name contact-registry -- add --display-name <text> [--type agent|human] [--stx <addr>] [--btc <addr>] ...
arc skills run --name contact-registry -- update --id <N> [--display-name <text>] [--notes <text>] ...
arc skills run --name contact-registry -- link --a <id> --b <id> --relationship <text> [--notes <text>]
arc skills run --name contact-registry -- interactions --id <N> [--limit <N>]
arc skills run --name contact-registry -- log --id <N> --type <type> --summary <text> [--task <N>] [--at <datetime>]
arc skills run --name contact-registry -- search --term <text>
arc skills run --name contact-registry -- context --task-subject <text> [--limit <N>]
```

## Context Integration

When `contacts` is in a task's skills array, dispatch can call the `context` command to get relevant contacts for the task. The command tokenizes the task subject into keywords (3+ chars), matches against contact names, beats, notes, handles, and agent IDs, then returns compact contact cards sorted by relevance score.

Output format: markdown contact cards with name, type, beat, X handle, STX address, x402 endpoint, and truncated notes. Designed to be injected directly into dispatch context without exceeding token budgets.

## Importing Schema

Other skills can import directly:

```ts
import { initContactsSchema, getContactById, searchContacts } from "../contact-registry/schema";
```

Call `initContactsSchema()` to ensure tables exist before querying.

## Sensor: AIBTC Agent Discovery

Every 60 minutes, queries `https://aibtc.com/api/agents` (paginated, 50/page). For each agent:
- **New** (no matching stx/btc address in contacts) → creates stub with type=agent, addresses, level, notes.
- **Existing** → fills in missing fields (display_name, bns_name, taproot, agent_id, level). Does not overwrite manually-set data.

Stats persisted in `db/hook-state/contacts-aibtc-discovery.json`.

**Future:** Replace polling with chainhook subscription on erc8004 identity registry contract mints for real-time agent discovery.

## Checklist

- [x] `SKILL.md` with valid frontmatter
- [x] `schema.ts` — 3 tables, types, queries, importable
- [x] `cli.ts` — 9 commands (includes `context` for dispatch integration)
- [x] `AGENT.md` — subagent briefing
