---
name: blog-deploy
description: Auto-deploy arc0me-site to Cloudflare Workers on content changes
updated: 2026-07-09
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

**Default model: commit to arc0me-site main = production deploy within ~5 minutes.** This is
intentional and keeps Arc's daily blog publishing flowing untouched. See "Deploy Hold" below for the
opt-in escape hatch when a change needs real staging (operator sign-off) before it goes live.

## Deploy Hold (staging a change without deploying it)

Added 2026-07-09 (arc-storefront-revamp P7, finding `C-P7-1`): before this, there was no way to
commit a change to arc0me-site without it auto-deploying within 5 minutes — this silently defeated
the "prod site-flip is a hard gate, never auto-approved" rule twice (once for this quest's own P3,
once for the sibling `arc-day-n-publishing` quest's P2) because neither phase's authors knew the
sensor had no concept of "staged."

To stage a change (commit freely, do NOT deploy yet):
```bash
touch github/arc0btc/arc0me-site/.deploy-hold   # content ignored; presence is the signal
git -C github/arc0btc/arc0me-site add -A && git -C github/arc0btc/arc0me-site commit -m "..."
# sensor will see new commits but log a skip reason and NOT queue a deploy while the hold exists
```

To ship the held change (operator sign-off):
```bash
rm github/arc0btc/arc0me-site/.deploy-hold
# next sensor tick (≤5 min) queues the deploy for current HEAD, same as the default path
```

No hold file present = unchanged prior behavior (commit = deploy). The hold is opt-in per staged
change, not a global switch — remove it as soon as sign-off is granted so routine publishing isn't
left gated by accident.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Detects new commits in arc0me-site, queues deploy tasks (checks `.deploy-hold` first) |
| `cli.ts` | Build + deploy + verify pipeline |

## CLI

```
arc skills run --name blog-deploy -- deploy [--skip-verify]
arc skills run --name blog-deploy -- status
```

## Sensor Behavior

- Cadence: 5 minutes
- Deploy hold: if `github/arc0btc/arc0me-site/.deploy-hold` exists, skip and log — no task queued
  regardless of new commits (see "Deploy Hold" above)
- Trigger: arc0me-site HEAD SHA differs from `last_deployed_sha` in hook state
- Task model: `script` — runs `arc skills run --name blog-deploy -- deploy` directly, no LLM dispatch
- Task priority: 7
- Deduplicates: won't queue a second task if one is already pending

## Deploy Pipeline

1. Retrieve `cloudflare/api_token` from Arc credential store
2. `npm run build` (Astro static site build)
3. `npx wrangler deploy --env production` (deploys to arc0.me)
4. `verify-deploy` via blog-publishing skill (non-fatal warning on failure)
5. Record deployed SHA in hook state to suppress future re-queues

**Note (C-P7-1 sibling gap):** `wrangler deploy` bundles the entire on-disk source tree for its
dependency graph, not just intentionally-touched files. Do not leave staged/uncommitted edits sitting
in this checkout while running a deploy for an unrelated change (own or another phase's) — they will
ship as a side effect with no commit to point to. Prefer the `.deploy-hold` convention above (commit +
hold) over leaving edits uncommitted if a deploy might run in the meantime.

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
