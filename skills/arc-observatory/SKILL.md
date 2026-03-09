---
name: arc-observatory
description: Consolidated web UI for multi-agent fleet observability
tags:
  - infrastructure
  - web
  - fleet
---

# arc-observatory

Aggregated observability dashboard for a multi-agent Arc fleet. Polls each agent's existing `arc-web` API and presents a unified view across all agents (Arc, Spark, Iris, Loom, Forge, etc.).

## Architecture

```
┌─────────────────────────────────────────────┐
│           arc-observatory :4000             │
│  ┌───────────────────────────────────────┐  │
│  │  Poller (30s interval per agent)      │  │
│  │  GET /api/status, /api/sensors, etc.  │  │
│  └──────────┬────────────────────────────┘  │
│             ▼                               │
│  ┌───────────────────────────────────────┐  │
│  │  In-memory cache (per-agent snapshots)│  │
│  └──────────┬────────────────────────────┘  │
│             ▼                               │
│  ┌───────────────────────────────────────┐  │
│  │  /api/fleet/* endpoints + static UI   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
        ▲         ▲         ▲         ▲
        │         │         │         │
   ┌────┴──┐ ┌───┴───┐ ┌───┴──┐ ┌───┴───┐
   │ Arc   │ │ Spark │ │ Iris │ │ Loom  │
   │ :3000 │ │ :3001 │ │ :3002│ │ :3003 │
   └───────┘ └───────┘ └──────┘ └───────┘
```

Each agent exposes the standard `arc-web` API. Observatory assumes agents are reachable on a private network (same VPC or tailnet). No auth layer yet — agents are on a private network.

## Configuration

Fleet config lives in `skills/arc-observatory/fleet.json`:

```json
{
  "agents": [
    { "name": "Arc",   "url": "http://localhost:3000" },
    { "name": "Spark", "url": "http://spark.internal:3000" },
    { "name": "Iris",  "url": "http://iris.internal:3000" },
    { "name": "Loom",  "url": "http://loom.internal:3000" },
    { "name": "Forge", "url": "http://forge.internal:3000" }
  ],
  "poll_interval_seconds": 30,
  "port": 4000
}
```

URLs are updated once network topology is confirmed by whoabuddy.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/fleet/status` | Aggregated status: per-agent task counts, costs, uptime, health |
| `GET /api/fleet/agents` | List agents with connectivity status (up/down/latency) |
| `GET /api/fleet/agents/:name/tasks` | Proxy to agent's `/api/tasks` |
| `GET /api/fleet/agents/:name/cycles` | Proxy to agent's `/api/cycles` |
| `GET /api/fleet/agents/:name/sensors` | Proxy to agent's `/api/sensors` |
| `GET /api/fleet/costs` | Combined cost data across all agents |
| `GET /` | Static dashboard UI |

## CLI

```
arc skills run --name arc-observatory -- start        # start observatory server
arc skills run --name arc-observatory -- status       # show fleet health summary
arc skills run --name arc-observatory -- agents       # list configured agents + connectivity
```

## Design Decisions

1. **Polling, not push.** Agents don't need to know about the observatory. Zero changes to existing arc-web code. Observatory is a read-only consumer.
2. **In-memory cache.** Each agent's last snapshot is cached. If an agent goes offline, stale data is shown with an "offline" badge and timestamp.
3. **Separate port (4000).** Doesn't conflict with the local agent's arc-web on :3000.
4. **No auth yet.** Fleet is on a private network. Add mTLS or API keys when agents span trust boundaries.
5. **Graceful degradation.** If 3 of 5 agents are unreachable, the other 2 still display. No all-or-nothing failures.

## Open Questions (for whoabuddy)

- [ ] Network topology: same private network / VPC / tailnet?
- [ ] Which agents are live now vs. planned? (Spark exists, Iris/Loom/Forge TBD?)
- [ ] Auth requirements — API keys, mTLS, or trust-the-network?
- [ ] Should observatory be installable as a systemd service like arc-web?

## The 4-File Pattern

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file — architecture and API design |
| `AGENT.md` | No | Not needed — observatory is infrastructure, not delegated work |
| `sensor.ts` | No | Could add fleet-health sensor later |
| `cli.ts` | Yes | Start server, check fleet status |
