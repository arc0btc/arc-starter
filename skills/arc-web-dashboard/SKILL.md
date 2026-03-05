---
name: arc-web-dashboard
description: Arc's live web dashboard — real-time task feed, sensor status, cost tracking
tags: [web, ui, operations, monitoring]
---

# Dashboard Skill

A live web dashboard that shows Arc's operational state in real time. Hosted with `Bun.serve()`, served as a single-page app with no build step.

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

## CLI

```
arc skills run --name dashboard -- start [--port 3000]    # Start web server
arc skills run --name dashboard -- stop                    # Stop web server
```

