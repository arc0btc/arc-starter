---
name: heartbeat
description: Periodic system-alive task creator
tags:
  - sensor
  - system
---

# heartbeat

The heartbeat sensor creates a "system alive check" task every 6 hours to confirm the agent is running and processing work.

## Sensor Behavior

- **Cadence**: every 360 minutes (6 hours)
- **Task source**: `sensor:heartbeat`
- **Priority**: 1 (lowest — background signal only)
- **Dedup**: skips if a pending or active heartbeat task already exists

## State

Scheduling state is stored in `db/hook-state/heartbeat.json`. The sensor reads this file on every invocation to decide whether enough time has passed before creating a new task.

## Why Heartbeat

A periodic heartbeat task provides a lightweight indicator that the dispatch loop is alive and processing. If heartbeat tasks accumulate without being completed, it signals the dispatch loop may be stalled.
