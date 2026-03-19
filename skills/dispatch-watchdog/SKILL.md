---
name: dispatch-watchdog
description: Monitors dispatch cycle gaps and writes stall incidents to memory/topics/incidents.md
tags:
  - monitoring
  - health
---

# dispatch-watchdog

Detects dispatch stalls by monitoring cycle_log gaps. When a stall exceeds the threshold (95 minutes) with pending tasks waiting, records the incident to `memory/topics/incidents.md` and creates a high-priority alert task.

Complements `service-health` (which detects stalls and resets gates) by providing persistent incident documentation for post-mortem analysis.

## Sensor Behavior

- **Cadence:** Every 10 minutes
- **Detection:** Last cycle older than 95 minutes + pending tasks exist
- **Actions on stall:**
  1. Appends structured incident entry to `memory/topics/incidents.md`
  2. Creates P2 alert task (deduped by source)
- **Dedup:** Only writes one incident per stall event (tracks last reported stall timestamp in hook state)

## When to Load

Load when investigating dispatch reliability, stall history, or incident patterns. Not needed for routine task execution.
