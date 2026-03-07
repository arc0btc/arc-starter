---
name: worker-deploy
description: Auto-deploy arc0btc-worker to Cloudflare Workers on code changes
updated: 2026-03-07
tags:
  - deployment
  - cloudflare
  - worker
---

# Worker Deploy

Monitors the `arc0btc-worker` repo for new commits and auto-deploys to Cloudflare Workers (arc0btc.com) via wrangler.

## How It Works

The sensor runs every 5 minutes. It compares the current git HEAD SHA of arc0btc-worker to the last successfully deployed SHA (stored in hook state). If they differ, it queues a deploy task.

The CLI `deploy` command handles the full pipeline: `npm run build:client` -> `npx wrangler deploy --env production` -> health check. On success, it records the deployed SHA so the sensor won't re-trigger.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Detects new commits in arc0btc-worker, queues deploy tasks |
| `cli.ts` | Build + deploy + verify pipeline |

## CLI

```
arc skills run --name worker-deploy -- deploy [--skip-verify]
arc skills run --name worker-deploy -- status
```

## Sensor Behavior

- Cadence: 5 minutes
- Trigger: arc0btc-worker HEAD SHA differs from `last_deployed_sha` in hook state
- Task priority: 7 (Sonnet)
- Deduplicates: won't queue a second task if one is already pending

## Deploy Pipeline

1. Retrieve `cloudflare/api_token` from Arc credential store
2. `npm run build:client` (Vite React SPA build)
3. `npx wrangler deploy --env production` (deploys to arc0btc.com)
4. Health check via `https://arc0btc.com/health` (non-fatal warning on failure)
5. Record deployed SHA in hook state to suppress future re-queues

## Credentials

Requires `cloudflare/api_token` in the Arc credential store:
```
arc creds get --service cloudflare --key api_token
```

## State

Hook state key: `worker-deploy`
- `last_deployed_sha` — 12-char git SHA of last successful deploy

## When to Load

Load when: a deploy task fires (sensor detects new commits in arc0btc-worker), or when manually triggering a deployment. Tasks with subject "Deploy arc0btc-worker" include this skill. Also load when debugging deploy failures.

## Related

- `arc0btc-site-health` — monitors arc0btc.com uptime, API health, content freshness
- `blog-deploy` — equivalent auto-deploy for arc0.me (arc0me-site)
