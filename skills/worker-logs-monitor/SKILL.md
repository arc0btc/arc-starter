---
name: worker-logs-monitor
description: Query worker-logs instances for errors, cross-reference GitHub issues, file new issues
updated: 2026-03-06
tags:
  - monitoring
  - infrastructure
  - logs
---

# Worker Logs Monitor

Queries log data from all worker-logs deployments on a sensor cadence, detects errors and anomalies, cross-references against open GitHub issues, and files new issues when warranted.

## Deployments

| Name | URL | Repo | App ID | API Key Cred | Admin Key Cred |
|------|-----|------|--------|--------------|----------------|
| arc0btc | https://logs.arc0btc.com | arc0btc/worker-logs | arc0btc-worker | `worker-logs/arc0btc_worker_api_key` | `worker-logs/arc0btc_admin_api_key` |
| wbd | https://logs.wbd.host | whoabuddy/worker-logs | stx402 | `worker-logs/wbd_api_key` | `worker-logs/whoabuddy_admin_api_key` |
| mainnet | https://logs.aibtc.com | aibtcdev/worker-logs | aibtc-mainnet | `worker-logs/aibtc_api_key` | `worker-logs/aibtc_admin_api_key` |
| testnet | https://logs.aibtc.dev | aibtcdev/worker-logs | aibtc-testnet | `worker-logs/aibtc_api_key` | `worker-logs/aibtc_admin_api_key` |

Auth is dual-mode: `X-Api-Key` + `X-App-ID` headers for data queries (`/logs`), `X-Admin-Key` header for management queries (`/apps`, `/stats`). The admin key also works for data queries — if the per-app API key is missing, the code falls back to the admin key automatically. Keys stored in credential store under `worker-logs/` service.

## API Endpoints Used

- `GET /logs?level=ERROR&limit=50` — fetch error logs (API key + App ID auth)
- `GET /apps` — list registered apps (admin key auth)
- `GET /stats/:app_id?days=1` — daily stats per app (admin key auth)

## Sensor

Runs every 60 minutes. For each deployment with a configured admin key:
1. Fetch ERROR-level logs since last run
2. Group errors by pattern (message similarity)
3. Check GitHub issues on the corresponding repo for existing reports
4. Create a task if new error patterns are found (with issue-filing instructions)

## CLI Commands

```
arc skills run --name worker-logs-monitor -- errors [--deployment NAME] [--limit N]
  Fetch recent error logs. Default: all deployments, limit 20.

arc skills run --name worker-logs-monitor -- stats [--deployment NAME] [--days N]
  Show daily stats for all apps. Default: 1 day.

arc skills run --name worker-logs-monitor -- issues [--repo OWNER/REPO]
  List open worker-logs issues on GitHub.
```

## When to Load

Load when: sensor detects new error patterns and creates an investigation task, or when manually querying log data. Do NOT load for fork sync tasks (use `github-worker-logs` instead).

## Checklist

- [x] `skills/worker-logs-monitor/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
- [x] `sensor.ts` present: exports async default function returning `Promise<string>`
- [x] `AGENT.md` present: describes investigation workflow
