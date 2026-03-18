---
name: arc-monitoring-service
description: Paid endpoint monitoring service — checks uptime, response time, and alerts on failures
updated: 2026-03-18
tags:
  - service
  - monetization
  - monitoring
---

# arc-monitoring-service

Paid monitoring-as-a-service. Customers register endpoint URLs and Arc monitors them on a recurring schedule, storing health reports and firing alert webhooks on failures.

## Service Tiers

| Tier | Interval | Cost | Features |
|------|----------|------|----------|
| Basic | 60 min | 500 sats/month (~$0.50) | Uptime + response time |
| Pro | 5 min | 2,500 sats/month (~$2.50) | Uptime + response time + alert webhook |

## How It Works

1. Customer registers an endpoint via `POST /api/services/monitor` or on-chain payment with `arc:monitor-basic` / `arc:monitor-pro` memo
2. Sensor runs every 1 minute, picks up endpoints due for check based on their interval
3. HTTP GET with 10s timeout — records status code, response time
4. After 3 consecutive failures, fires alert webhook (Pro tier) and creates an alert task
5. Health reports available via `GET /api/services/monitor/:id`

## API

```
POST /api/services/monitor
  Body: { "endpoint_url": "https://example.com", "tier": "basic|pro", "label": "My API", "alert_webhook": "https://..." }
  Returns: { "id": 1, "status": "active", "tier": "basic", "poll_url": "/api/services/monitor/1" }

GET /api/services/monitor
  Service info, pricing, and current capacity.

GET /api/services/monitor/:id
  Health report for a monitored endpoint.

DELETE /api/services/monitor/:id
  Cancel monitoring for an endpoint.
```

## CLI

```
arc skills run --name arc-monitoring-service -- list [--status active|paused|expired]
  List all monitored endpoints.

arc skills run --name arc-monitoring-service -- check --id N
  Run an on-demand health check for endpoint N.

arc skills run --name arc-monitoring-service -- add --url URL [--tier basic|pro] [--label LABEL] [--webhook URL]
  Register a new endpoint for monitoring.

arc skills run --name arc-monitoring-service -- remove --id N
  Remove a monitored endpoint.

arc skills run --name arc-monitoring-service -- report --id N
  Show recent health history for endpoint N.
```

## Payment Integration

On-chain payments via `arc-payments` sensor:
- Memo `arc:monitor-basic` — registers endpoint (sender provides URL via X DM)
- Memo `arc:monitor-pro` — registers endpoint with Pro tier

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | This file |
| `sensor.ts` | Runs health checks on due endpoints |
| `cli.ts` | Endpoint management CLI |

## Data

Endpoints stored in `monitored_endpoints` table (see `src/db.ts`).
