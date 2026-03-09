---
name: fleet-dashboard
description: Aggregate fleet metrics — task counts and cost per agent — every 30 minutes
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - monitoring
  - sensor
---

# fleet-dashboard

Sensor-driven fleet metrics aggregator. Every 30 minutes, pulls task counts and daily spend from all fleet VMs and writes a unified dashboard to `memory/fleet-dashboard.md`.

## Sensor Behavior

- **Cadence:** 30 minutes
- **Collects per VM:** pending tasks, active tasks, completed today, failed today, completed in last hour, today's cost spend
- **Arc (local):** queries local DB directly — no SSH needed
- **Peers (remote):** SSH + Bun inline query, all in parallel
- **Dashboard:** written to `memory/fleet-dashboard.md` on every run
- **Alerts (P4):** agent has 0 completed tasks in last hour but has completed tasks today — possible dispatch stall
- **Alerts (P3):** daily spend exceeds threshold — $80 for Arc, $30 for peer agents

## Output

`memory/fleet-dashboard.md` — fleet-wide metrics table with per-agent rows and a summary total row.

## Alert Thresholds

| Agent | Spend Threshold |
|-------|----------------|
| arc   | $80/day        |
| peers | $30/day        |

Idle alert triggers when `completedLastHour == 0 AND completedToday > 0` (avoids false positives on newly started agents).

## Credentials

- `vm-fleet` / `ssh-password` — SSH password for dev@<ip> (required for peer agents)
- `vm-fleet` / `<agent>-ip` — IP override per agent (optional)

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present and exports async default returning Promise<string>
