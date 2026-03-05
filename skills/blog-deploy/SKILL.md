---
name: blog-deploy
description: Auto-deploy arc0me-site to Cloudflare Workers on content changes
updated: 2026-03-05
tags:
  - deployment
  - cloudflare
  - blog
---

# Blog Deploy

Monitors the `github/arc0btc/arc0me-site` repo for new commits and auto-deploys to Cloudflare Workers via wrangler.

## How It Works

The sensor runs every 5 minutes. It compares the current git HEAD SHA of arc0me-site to the last successfully deployed SHA (stored in hook state). If they differ, it queues a deploy task.

The CLI `deploy` command handles the full pipeline: `npm run build` → `npx wrangler deploy --env production` → `verify-deploy`. On success, it records the deployed SHA so the sensor won't re-trigger.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Detects new commits in arc0me-site, queues deploy tasks |
| `cli.ts` | Build + deploy + verify pipeline |

## CLI

```
arc skills run --name blog-deploy -- deploy [--skip-verify]
arc skills run --name blog-deploy -- status
```

## Sensor Behavior

- Cadence: 5 minutes
- Trigger: arc0me-site HEAD SHA differs from `last_deployed_sha` in hook state
- Task priority: 7 (Sonnet) — needs credential access, multi-step execution, error handling
- Deduplicates: won't queue a second task if one is already pending

## Deploy Pipeline

1. Retrieve `cloudflare/api_token` from Arc credential store
2. `npm run build` (Astro static site build)
3. `npx wrangler deploy --env production` (deploys to arc0.me)
4. `verify-deploy` via blog-publishing skill (non-fatal warning on failure)
5. Record deployed SHA in hook state to suppress future re-queues

## Credentials

Requires `cloudflare/api_token` in the Arc credential store:
```
arc creds get --service cloudflare --key api_token
```

## State

Hook state key: `blog-deploy`
- `last_deployed_sha` — 12-char git SHA of last successful deploy

To reset (force re-deploy on next sensor cycle):
```bash
# The sensor will re-queue if SHA doesn't match — just deploy manually to resync
arc skills run --name blog-deploy -- deploy
```

## When to Load

Load when: a deploy task fires (sensor detects new commits in arc0me-site), or when manually triggering a deployment. Tasks with subject "Deploy arc0me-site" include this skill. Also load when debugging deploy failures or resetting the deployed SHA state.

## Related

- `blog-publishing` — content creation, drafts, scheduling
- `blog-publishing verify-deploy` — post-deploy health check
