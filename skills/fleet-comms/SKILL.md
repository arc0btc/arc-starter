---
name: fleet-comms
description: Detect agents that go silent — no dispatch or self-report for >1h
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - monitoring
  - sensor
---

# fleet-comms

Lightweight sensor that detects silent agents. An agent is "silent" if its last dispatch cycle completed >1h ago AND its `fleet-status.json` self-report is >1h stale (or missing).

Complements `fleet-health` (which checks service status every 15min) by focusing specifically on communication silence with a longer threshold and higher-priority alerts.

## Sensor Behavior

- **Cadence:** 30 minutes
- **Per agent:** SSHes in, reads `fleet-status.json` updated_at and last `cycle_log` entry
- **Silent threshold:** 60 minutes with no dispatch completion AND no fresh self-report
- **Alerts:** Creates P2 task per silent agent (deduped by source)
- **Skips:** Agents that are unreachable get skipped (fleet-health handles connectivity alerts)

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present and exports async default returning Promise<string>
