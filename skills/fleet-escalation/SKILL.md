---
name: fleet-escalation
description: Detect blocked tasks on fleet agents, escalate to Arc, notify whoabuddy via email
updated: 2026-03-09
tags:
  - fleet
  - escalation
  - monitoring
  - sensor
---

# fleet-escalation

Automated escalation flow for fleet agents. When an agent marks a task as blocked, this skill detects it, creates an escalation task on Arc's queue, and emails whoabuddy with context.

## Sensor Behavior

- **Cadence:** 15 minutes
- **Detection:** SSH into each fleet agent, query for blocked tasks not yet escalated
- **Actions per blocked task found:**
  1. Creates escalation task on Arc (P2) with agent name, blocked task details, and block reason
  2. Marks the remote blocked task as "escalated" by tagging its result_summary
  3. Sends email digest to whoabuddy if any new escalations found
- **Dedup:** Tracks escalated task IDs in `memory/fleet-escalations.json` to avoid re-escalation

## CLI Commands

```
arc skills run --name fleet-escalation -- status
arc skills run --name fleet-escalation -- check --agent <name>
arc skills run --name fleet-escalation -- escalate --agent <name> --id <n> --reason <text>
```

## Commands

- **status**: Show recent escalations from `memory/fleet-escalations.json`
- **check**: Query a specific agent for blocked tasks (read-only)
- **escalate**: Manually escalate a specific blocked task from an agent to Arc + email whoabuddy

## Credentials

- `vm-fleet` / `ssh-password` — SSH password for fleet VMs
- `email` / `api_base_url` — Email worker API base URL
- `email` / `admin_api_key` — Email worker API auth key
- `email` / `report_recipient` — whoabuddy's email address

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
