---
name: arc0btc-deploy-monitor
description: Unified deployment monitor for all arc0btc org sites — uptime, structure, freshness, worker-logs errors
updated: 2026-03-16
tags:
  - sensor
  - site
  - monitoring
  - deployment
---

# arc0btc-deploy-monitor

Unified health monitor for all sites deployed from the arc0btc GitHub org. Consolidates uptime checks, structural consistency, content freshness, and worker-logs error counts into a single sensor.

Replaces: `arc0btc-site-health` + `site-consistency` (both deprecated).

## Sites Monitored

| Site | URL | Role | Checks |
|------|-----|------|--------|
| arc0.me | https://arc0.me | Blog | Uptime, API, content freshness, no-services, no-x402, links to arc0btc.com |
| arc0btc.com | https://arc0btc.com | Services | Uptime, has services, has x402, links to arc0.me |
| logs.arc0btc.com | https://logs.arc0btc.com | Worker-logs | Uptime, error count via /stats API |

## Sensor Behavior

- **Cadence**: every 30 minutes
- **Task source**: `sensor:arc0btc-deploy-monitor`
- **Priority**: 3 (site down/degraded is high priority)
- **Model**: sonnet (needs judgment to triage)
- **Dedup**: skips if a pending/active task already exists for same source

### Check Categories

1. **Uptime** — HTTP GET each site, expect 200
2. **API health** — arc0.me/api/posts.json returns valid JSON array
3. **Content freshness** — Latest blog post within 2 days
4. **Structural consistency** — Role separation (no services/x402 on blog, services/x402 on arc0btc.com), cross-links
5. **Worker-logs errors** — Query logs.arc0btc.com /stats for recent error count (admin key required)

### Worker-Logs Integration

Uses `worker-logs/arc0btc_admin_api_key` credential to query `/stats` on logs.arc0btc.com. This provides a lightweight error count signal. Detailed error pattern analysis remains in `worker-logs-monitor` (60min sensor).

## CLI

```
arc skills run --name arc0btc-deploy-monitor -- check [--verbose]
  Run all checks across all sites. Returns JSON.

arc skills run --name arc0btc-deploy-monitor -- check --site arc0me|arc0btc|logs
  Run checks for a specific site only.
```

## When to Load

Load when: a deploy-monitor alert task fires, or when manually checking site health. Do NOT load for worker-logs error investigation tasks (use `worker-logs-monitor` instead).

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file |
| `sensor.ts` | Yes | Unified 30-minute health monitoring |
| `cli.ts` | Yes | On-demand health checks |
