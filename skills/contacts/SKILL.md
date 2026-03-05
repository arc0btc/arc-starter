---
name: contacts
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
arc skills run --name contacts -- list [--status active|inactive|archived]
arc skills run --name contacts -- show --id <N>
arc skills run --name contacts -- add --display-name <text> [--type agent|human] [--stx <addr>] [--btc <addr>] ...
arc skills run --name contacts -- update --id <N> [--display-name <text>] [--notes <text>] ...
arc skills run --name contacts -- link --a <id> --b <id> --relationship <text> [--notes <text>]
arc skills run --name contacts -- interactions --id <N> [--limit <N>]
arc skills run --name contacts -- log --id <N> --type <type> --summary <text> [--task <N>] [--at <datetime>]
arc skills run --name contacts -- search --term <text>
```

## Importing Schema

Other skills can import directly:

```ts
import { initContactsSchema, getContactById, searchContacts } from "../contacts/schema";
```

Call `initContactsSchema()` to ensure tables exist before querying.

## Checklist

- [x] `SKILL.md` with valid frontmatter
- [x] `schema.ts` — 3 tables, types, queries, importable
- [x] `cli.ts` — 8 commands
- [x] `AGENT.md` — subagent briefing
