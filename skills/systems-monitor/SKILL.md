---
name: systems-monitor
description: Fleet VM system health — disk, memory, CPU load, and service status for agent nodes
effort: low
updated: 2026-03-18
tags:
  - sensor
  - infrastructure
  - monitoring
  - fleet
---

# systems-monitor

OS-level system health monitoring for fleet VMs. Sensor checks the local node every 5 minutes; CLI provides on-demand checks for any fleet VM (local or via SSH).

Complements `fleet-health` (which checks dispatch age and arc services via SSH) by providing OS-layer metrics: disk usage, memory pressure, CPU load, and systemd service failures.

## Sensor Behavior

- **Cadence**: 5 minutes
- **Scope**: Local node only (no outbound SSH in sensor — use CLI for remote checks)
- **Checks**: disk usage per mount, 1-minute load average, memory utilization, systemd failed units
- **Alert dedup**: 1-hour cooldown per alert type via `db/hook-state/systems-monitor-*.json`

## Alert Thresholds

| Resource         | Warning (P4) | Critical (P2) |
|------------------|--------------|---------------|
| Disk usage       | > 80%        | > 90%         |
| Load avg (1m)    | > 4.0        | > 8.0         |
| Memory used      | > 85%        | > 95%         |
| Systemd failures | any          | 3+ units      |

## Task Shape

- **Subject**: `[systems-monitor] <node>: <resource> at <value>%`
- **Skills**: `["systems-monitor"]`
- **Priority**: 2 (critical), 4 (warning), 6 (service issue)
- **Source**: `sensor:systems-monitor:<check-type>`
- **Model**: sonnet (P2–P4), haiku (P6+)

## Fleet VMs

| Agent | IP            | Role        |
|-------|---------------|-------------|
| Arc   | 192.168.1.10  | Orchestrator |
| Spark | 192.168.1.12  | DeFi/AIBTC  |
| Iris  | 192.168.1.13  | Research/X  |
| Loom  | 192.168.1.14  | CI/CD       |
| Forge | 192.168.1.15  | Dev expert  |

SSH uses `dev@<ip>` with credentials from `arc creds get --service vm-fleet --key ssh-password`.

## CLI Commands

```
arc skills run --name systems-monitor -- status [--host IP]
arc skills run --name systems-monitor -- disk [--host IP]
arc skills run --name systems-monitor -- services [--host IP]
arc skills run --name systems-monitor -- metrics [--host IP]
```

Without `--host`, checks the local node. With `--host`, SSH's to the target IP.

## When You Receive an Alert Task

1. Run `status` to get current readings
2. If disk: identify largest directories with `du -sh /*` (or remote equivalent)
3. If load: identify top processes with resource usage
4. If memory: check for leaking processes
5. If services: run `systemctl --user status <unit>` to investigate
6. Remediate or create a P2 follow-up task for irreversible actions

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] sensor.ts exports async default returning Promise<string>
- [x] cli.ts parses named flags, exits 1 on errors
