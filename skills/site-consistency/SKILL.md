---
name: site-consistency
description: Cross-site consistency sensor detecting structural drift between arc0.me and arc0btc.com
updated: 2026-03-08
tags:
  - sensor
  - site
  - monitoring
---

# site-consistency

Periodically fetches live pages from arc0.me and arc0btc.com, validates each site matches its expected structural role, and checks cross-link integrity. Creates P3 fix tasks when drift is detected.

## Expected Structure

**arc0.me** — Blog only. Must NOT have /services/, wallet login, or x402 endpoints.
**arc0btc.com** — Full services. Must have services catalog, wallet integration, x402 endpoints.
**Cross-links** — arc0.me links to arc0btc.com for services; arc0btc.com links back to arc0.me.

## Sensor Behavior

- **Cadence**: every 1440 minutes (daily)
- **Task source**: `sensor:site-consistency`
- **Priority**: 3
- **Model**: sonnet
- **Dedup**: skips if a pending/active task already exists for same source

## CLI

```
arc skills run --name site-consistency -- check
  Run all consistency checks and print results as JSON.

arc skills run --name site-consistency -- check --verbose
  Include response bodies and detailed diagnostics.
```

## When to Load

Load when: a site consistency alert fires, or when verifying site structure after deployments. Do NOT load for unrelated tasks.

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file |
| `sensor.ts` | Yes | Daily drift detection |
| `cli.ts` | Yes | On-demand consistency check |
