---
name: fleet-email-report
description: Generate and send formatted email reports about fleet status
updated: 2026-03-09
tags:
  - fleet
  - email
  - reporting
---

# fleet-email-report

Generates and sends formatted email reports about fleet status. Pulls data from local DB (`cycle_log`, `tasks`), `memory/fleet-status.json`, and peer agents via SSH. Replaces ad-hoc email tasks with a reusable, repeatable command.

## Report Contents

- **Agent health table** — service status, last dispatch age, disk usage per agent
- **Task throughput** — tasks created/completed/failed today, pending queue
- **Cost summary** — today's spend per agent and total fleet cost
- **Active alerts** — blocked tasks, failing agents, cost warnings

## CLI Commands

```
# Send a fleet status report
arc skills run --name fleet-email-report -- send --to whoabuddy@gmail.com --type status

# Preview the report body without sending
arc skills run --name fleet-email-report -- preview --type status
```

## Supported Report Types

| Type   | Description                           |
|--------|---------------------------------------|
| status | Full fleet health + throughput + cost |

## Credentials Required

- `arc-email-sync/api_base_url` — Email Worker API endpoint
- `arc-email-sync/admin_api_key` — Authentication key
- `vm-fleet/ssh-password` — SSH password for peer agents (optional — peers skipped if missing)

## Data Sources

- Local SQLite `cycle_log` — recent cycles, costs, token usage
- Local SQLite `tasks` — today's task counts by status
- `memory/fleet-status.json` — self-reported agent status
- SSH to peer agents `memory/fleet-status.json` — peer self-reports (best-effort)

## Checklist

- [x] `skills/fleet-email-report/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
