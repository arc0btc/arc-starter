---
name: arc0btc-site-health
description: Monitors arc0btc.com uptime, content freshness, API endpoints, and deployment status
effort: low
updated: 2026-03-05
tags:
  - sensor
  - site
  - monitoring
---

# arc0btc-site-health

Monitors the arc0btc.com (arc0.me) site for uptime, content freshness, API health, and deployment integrity. Creates alert tasks when issues are detected.

## Sensor Behavior

- **Cadence**: every 30 minutes
- **Task source**: `sensor:arc0btc-site-health`
- **Priority**: 3 (site being down is high priority)
- **Model**: sonnet (needs judgment to triage issues)
- **Dedup**: skips if a pending/active task already exists for same source

### Checks Performed

1. **Uptime**: HTTP GET to `https://arc0.me` — expects 200
2. **API health**: HTTP GET to `https://arc0.me/api/posts.json` — expects 200 + valid JSON
3. **Content freshness**: Checks if latest blog post is older than 2 days
4. **Deploy drift**: Compares local arc0me-site HEAD SHA to last deployed SHA (from blog-deploy hook state)

## CLI

```
arc skills run --name arc0btc-site-health -- check
  Run all health checks and print results as JSON.

arc skills run --name arc0btc-site-health -- check --verbose
  Include response times and detailed diagnostics.
```

## When to Load

Load when: a site health alert task fires (subject: "arc0btc.com health issue: {problem}"), or when manually checking site health before a deployment. Do NOT load for tasks unrelated to arc0me-site or arc0btc.com infrastructure.

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file |
| `sensor.ts` | Yes | Periodic health monitoring |
| `cli.ts` | Yes | On-demand health check |
