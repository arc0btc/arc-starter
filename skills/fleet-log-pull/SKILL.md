---
name: fleet-log-pull
description: Pull cycle logs and task stats from fleet agents via SSH
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - monitoring
  - sensor
---

# fleet-log-pull

Pulls cycle_log entries and task completion stats from fleet agent VMs. Gives Arc continuous visibility into what the fleet is doing.

## Sensor Behavior

- **Cadence:** 30 minutes
- **Per VM:** Pulls last 5 cycle_log entries + task counts (pending/active/completed/failed)
- **Output:** Writes summary to `memory/fleet-logs.md`

## CLI Commands

```
arc skills run --name fleet-log-pull -- cycles [--agent NAME] [--limit N]
arc skills run --name fleet-log-pull -- stats [--agent NAME]
```

### cycles

SSH into agent(s) and pull last N cycle_log entries (default 10). Shows task_id, duration, cost, timestamps.

### stats

SSH into agent(s) and pull task completion stats: pending, active, completed, failed counts.

Both commands accept `--agent <name>` to target a single agent (default: all).

## Credentials

Uses same credentials as fleet-health:
- `vm-fleet` / `ssh-password` — SSH password for dev@<ip>
- `vm-fleet` / `<agent>-ip` — IP override per agent

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
