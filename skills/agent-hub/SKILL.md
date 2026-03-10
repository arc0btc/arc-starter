---
name: agent-hub
description: Fleet-internal agent registry, capability index, and task routing hub
updated: 2026-03-10
tags:
  - fleet
  - registry
  - routing
---

# Agent Hub

Local Bun/SQLite agent registry for Arc's 5-agent fleet. Arc is source of truth. Tracks agent registrations, capabilities, health, and provides task routing based on capability matching.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — orchestrator context |
| `schema.ts` | DB schema + types + query functions (importable) |
| `cli.ts` | CLI: list, show, register, capabilities, route, health, stats |
| `sensor.ts` | Registry sync — collects fleet status via SSH (15min) |

## Schema

Three tables in `db/arc.sqlite`:

- **hub_agents** — Agent registry. Fields: agent_name (unique), display_name, ip_address, stx_address, btc_address, bns_name, status (online/offline/degraded), version, skill_count, sensor_count, last_heartbeat, registered_at, updated_at.
- **hub_capabilities** — Capability index. Fields: agent_name FK, skill_name, has_sensor, has_cli, has_agent_md, tags (JSON array), registered_at.
- **hub_task_routes** — Routing log. Fields: task_id, from_agent, to_agent, skill_match, reason, routed_at.

## CLI

```
arc skills run --name agent-hub -- list                         # list registered agents
arc skills run --name agent-hub -- show --agent <name>          # agent detail + capabilities
arc skills run --name agent-hub -- register --agent <name> --ip <addr>  # register/update agent
arc skills run --name agent-hub -- capabilities --agent <name>  # list agent capabilities
arc skills run --name agent-hub -- route --skill <name>         # find best agent for a skill
arc skills run --name agent-hub -- health                       # fleet health summary
arc skills run --name agent-hub -- stats                        # task routing stats
```

## API Endpoints (in web.ts)

```
GET  /api/hub/agents                    # list all agents
GET  /api/hub/agents/:name              # agent detail + capabilities
POST /api/hub/agents                    # register/update agent (fleet-auth)
GET  /api/hub/capabilities?skill=<name> # find agents with capability
GET  /api/hub/health                    # fleet health overview
POST /api/hub/route                     # route a task to best agent (fleet-auth)
```

All mutation endpoints use fleet authentication (`ARC_FLEET_SECRET` bearer token).

## Importing Schema

```ts
import { initHubSchema, getHubAgent, findAgentForSkill } from "../agent-hub/schema";
```

Call `initHubSchema()` to ensure tables exist before querying.

## Checklist

- [x] `SKILL.md` with valid frontmatter
- [x] `schema.ts` — 3 tables, types, queries, importable
- [x] `cli.ts` — 7 commands
- [x] `sensor.ts` — fleet registry sync (15min)
- [x] API endpoints in `web.ts`
