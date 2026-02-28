---
name: dashboard
description: Arc's live web dashboard — real-time task feed, sensor status, cost tracking
tags: [web, ui, operations, monitoring]
---

# Dashboard Skill

A live web dashboard that shows Arc's operational state in real time. Hosted with `Bun.serve()`, served as a single-page app with no build step.

## Design

**Theme:** Black + gold, matching arc0btc.com. Pure black (`#000`) background, gold (`#FEC233`) accents, warm beige (`#E9D4CF`) secondary text. System fonts. Left-border cards. Minimal, terminal-luxury aesthetic.

**Layout:** Mobile-first single column. On desktop (>768px), expands to a 2-column grid with persistent header. No sidebar — vertical scroll with section anchors.

**Personality:** Fun and alive. The dashboard should feel like watching a machine think — tasks flowing, sensors pulsing, costs ticking. Not a boring admin panel.

## Architecture

```
src/web.ts          — Bun.serve() HTTP server (API + static)
src/web/            — Static assets (HTML, CSS, JS)
  index.html        — Single-page dashboard (inline CSS + JS, no build step)
```

The web server reads directly from SQLite (read-only connection) and serves JSON API endpoints. The frontend is a single HTML file with inline styles and vanilla JS — no framework, no build tools, no node_modules.

## API Endpoints

```
GET /                          — Dashboard HTML
GET /api/status                — Task counts, last cycle, cost today, uptime
GET /api/tasks?status=S&limit=N — Task list with filters
GET /api/tasks/:id             — Single task detail
GET /api/cycles?limit=N        — Recent dispatch cycles
GET /api/sensors               — All sensor states (from hook-state JSON)
GET /api/skills                — Skill catalog (name, description, tags)
GET /api/costs?range=day|week  — Cost aggregation over time
GET /api/identity              — Arc's identity (from SOUL.md: name, addresses, balances)
GET /api/events                — SSE stream for live updates (new tasks, cycle completions)
```

All endpoints return JSON except `/` (HTML) and `/api/events` (SSE).

## Service

Runs as a persistent `arc-web.service` (systemd) or `com.arc-agent.web.plist` (launchd).

```
arc services install    — Also installs web service (port from ARC_WEB_PORT env, default 3000)
arc services status     — Shows web service status alongside sensors/dispatch
```

## Dashboard Sections

### Header
- Arc avatar + name + `arc0.btc`
- Live status indicator (green pulse if dispatch ran in last 5 min)
- Cost today ticker
- Links to arc0.me, arc0btc.com, GitHub

### Activity Feed (hero section)
- Real-time task stream — newest first
- Each task: status badge (color-coded), subject, source, age
- Active task highlighted with gold pulse border
- Click to expand: description, result_summary, cost, duration

### Sensor Grid
- Card per sensor with name + interval + last run + status dot
- Green dot: ok, Red dot: error, Gray dot: skip/stale
- Pulse animation on sensors that ran in the last minute
- Mobile: 2-col grid. Desktop: 3-4 col grid

### Dispatch Metrics
- Cycles today, success rate, avg duration
- Cost chart (actual vs API estimate) — simple bar/sparkline
- Token throughput (in/out per hour)
- Current queue depth

### Skill Catalog
- Card grid of all installed skills
- Name, description, tags as gold pills
- Expandable to show sensor interval, CLI commands

### Identity Card
- BNS name, BTC/STX addresses (truncated, click to copy)
- Current balances (if available)
- Links to explorer pages

## CLI

```
arc skills run --name dashboard -- start [--port 3000]    # Start web server
arc skills run --name dashboard -- stop                    # Stop web server
```

## Implementation Phases

Phase 1: API server + JSON endpoints (src/web.ts, Bun.serve)
Phase 2: Frontend shell (HTML/CSS, black+gold theme, mobile-first layout)
Phase 3: Dashboard views (activity feed, sensor grid, metrics, skill catalog)
Phase 4: Live updates (SSE stream, auto-refresh, pulse animations)
Phase 5: Service integration (systemd/launchd unit, arc services support)
