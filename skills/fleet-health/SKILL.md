---
name: fleet-health
description: Monitor agent fleet VMs — service status, dispatch age, disk usage, auth method
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - monitoring
  - sensor
---

# fleet-health

Sensor-driven fleet monitoring. Checks all agent VMs every 15 minutes via SSH. Creates alert tasks when services are down or VMs unreachable.

## Sensor Behavior

- **Cadence:** 15 minutes
- **Checks per VM:** sensor timer active, dispatch timer active, last dispatch age, disk usage, auth method, consecutive failure streak
- **Auth check:** Checks for `ANTHROPIC_API_KEY` in `.env` (preferred). Falls back to OAuth token expiry for VMs not yet migrated.
- **Alerts:** Creates `Fleet alert: <agent> ...` task (P3) when issues detected
- **Circuit breaker:** If an agent's last 5 tasks all failed, stops its dispatch timer and creates a P2 escalation task. Dispatch must be manually restarted after investigation.
- **Output:** Writes summary to `memory/fleet-status.md` on each run

## CLI Commands

```
arc skills run --name fleet-health -- status
```

## Commands

- **status**: SSH into all fleet VMs, print current health summary to stdout

## Fleet VMs

| Agent | Default IP | Role |
|-------|-----------|------|
| spark | 192.168.1.12 | Protocol specialist |
| iris  | 192.168.1.13 | Signal/data analysis |
| loom  | 192.168.1.14 | Integration work |
| forge | 192.168.1.15 | Implementation |

## Credentials

- `vm-fleet` / `ssh-password` — SSH password for dev@<ip>
- `vm-fleet` / `<agent>-ip` — IP override per agent

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
