---
name: worker-logs
description: Sync worker-logs forks, monitor production events, report trends
tags:
  - monitoring
  - infrastructure
  - sync
---

# Worker Logs

Maintains and monitors the worker-logs Cloudflare Worker across three deployments. Keeps forks in sync, fetches production events, and produces trend reports.

## Deployments

| Owner | URL | Role |
|-------|-----|------|
| whoabuddy/worker-logs | logs.wbd.host | Upstream (source of truth) |
| aibtcdev/worker-logs | logs.aibtc.com (mainnet), logs.aibtc.dev (testnet) | Shared infrastructure |
| arc0btc/worker-logs | — | Our fork |

## CLI Commands

```
arc skills run --name worker-logs -- sync
  Check all three repos for drift against upstream. Report differences.
  Creates sync PRs if forks are behind.

arc skills run --name worker-logs -- events --deployment URL
  Fetch recent events from a deployment endpoint. Output JSON.

arc skills run --name worker-logs -- report
  Analyze events across all deployments for trends, anomalies, patterns.
  Produces ISO 8601 report at reports/.
```

## Sensor

Runs every 120 minutes. Checks if any fork is behind upstream via GitHub API. Creates a sync task if drift is detected.

## The 4-File Pattern

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file — documentation and checklist |
| `AGENT.md` | Yes | Detailed execution instructions for sync, events, reporting |
| `sensor.ts` | Yes | Fork drift detection every 120 minutes |
| `cli.ts` | Yes | sync, events, report subcommands |

## Checklist

- [x] `skills/worker-logs/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (worker-logs)
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present: `bun skills/worker-logs/cli.ts` runs without error
- [x] `sensor.ts` present: exports async default function returning `Promise<string>`
- [x] `AGENT.md` present with subagent briefing
