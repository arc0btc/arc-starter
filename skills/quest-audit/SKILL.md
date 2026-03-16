---
name: quest-audit
description: Sensor that detects hung quest-phase tasks and surfaces them for review
updated: 2026-03-16
tags:
  - orchestration
  - reliability
  - sensor
---

# quest-audit

Sensor that scans active quest workflows for hung or failed phase tasks. When a quest's current phase task has failed (with no pending replacement), the sensor creates a review task to surface the issue — preventing quests from silently dying.

## What It Detects

1. **Failed phase tasks** — Current phase task exists but has `status = 'failed'`, and no pending/active replacement exists
2. **Missing phase tasks** — Current phase is `pending` but no task exists for the phase source key
3. **Stale active phases** — Phase task has been `active` for >60 minutes (likely stuck dispatch)

## Sensor

- **Cadence:** Every 30 minutes
- **Source key:** `sensor:quest-audit`
- **Task source:** `sensor:quest-audit:<slug>`
- **No LLM calls** — pure DB queries

## How It Works

1. Queries all active quest workflows (`template = 'quest'`, `completed_at IS NULL`)
2. For each quest, inspects the current phase and its associated task
3. If the phase is hung (failed task, missing task, or stale active), creates a review task
4. Review tasks include quest context so the dispatched agent can decide: retry, skip, or fail the quest
