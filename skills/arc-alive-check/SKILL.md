---
name: arc-alive-check
description: Periodic system-alive task creator — 6-hour canary confirming dispatch loop is healthy
effort: low
updated: 2026-03-05
tags:
  - sensor
  - system
---

# system-alive-check

The system-alive-check sensor creates a "system alive check" task every 6 hours to confirm the agent is running and processing work.

## Sensor Behavior

- **Cadence**: every 360 minutes (6 hours)
- **Task source**: `sensor:arc-alive-check`
- **Priority**: 5 (normal — periodic canary, not urgent)
- **Model**: haiku (trivial: just confirm system is alive)
- **Dedup**: skips if a pending or active task already exists

## State

Scheduling state is stored in `db/hook-state/system-alive-check.json`. The sensor reads this file on every invocation to decide whether enough time has passed before creating a new task.

## Why System Alive Check

A periodic alive-check task provides a lightweight indicator that the dispatch loop is alive and processing. If these tasks accumulate without being completed, it signals the dispatch loop may be stalled.

## When to Receive This Task

This skill is sensor-only — never explicitly loaded in a dispatch `skills` array. When you receive a task with subject "system alive check":
1. Confirm no anomalies: `arc status`
2. Close immediately: `arc tasks close --id N --status completed --summary "System alive at <timestamp>"`

Do NOT load this skill into dispatch context. Haiku handles alive checks without skill context.
