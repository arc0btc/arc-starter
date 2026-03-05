---
name: arc-scheduler
description: Manages future task scheduling with deferred creation, overdue detection, and priority boost for past-due tasks
tags:
  - scheduling
  - tasks
  - core
---

# Scheduler Skill

Manages future task scheduling. Provides deferred task creation from the CLI and monitors the scheduled task queue for health.

## How Scheduling Works

Tasks have a `scheduled_for` column. When set to a future datetime, the task is held until that time arrives — dispatch ignores it until then.

**Once the time passes:**
- The task becomes eligible for normal dispatch
- If it's been waiting >1 minute past its scheduled time, it receives a **+2 effective priority boost** in the dispatch queue (lower number = dispatched sooner)

The scheduler sensor provides observability: how many tasks are queued, when the next one fires, and alerts if tasks back up unexpectedly.

## CLI: Creating Deferred Tasks

Use `arc tasks add` with either flag:

```bash
# Human-friendly duration (relative to now)
arc tasks add --subject "Review logs" --defer 30m
arc tasks add --subject "Weekly report" --defer 2h
arc tasks add --subject "Quarterly review" --defer 1d
arc tasks add --subject "Deploy in 1.5 hours" --defer 1h30m

# Absolute ISO datetime
arc tasks add --subject "Run at midnight" --scheduled-for "2026-03-04T00:00:00Z"
```

**Duration format:** `[Nd][Nh][Nm]` where N is a positive integer. Examples:
- `30m` → 30 minutes
- `2h` → 2 hours
- `1d` → 24 hours
- `1h30m` → 90 minutes
- `2d12h` → 60 hours

## Viewing Scheduled Tasks

```bash
# All pending tasks (includes scheduled, sorted by priority/time)
arc tasks --status pending

# To see scheduled_for values, query DB directly (development only)
# arc tasks shows scheduled tasks in the queue — they appear when their time arrives
```

## Sensor

The scheduler sensor runs every 5 minutes. It:
1. Counts upcoming scheduled tasks (not yet eligible)
2. Detects tasks past their scheduled_for time that haven't been dispatched
3. Alerts if >5 tasks are overdue by >30 minutes (indicates dispatch may be stuck)

Sensor output: `ok: upcoming=N, overdue=N, next=<datetime>`

## Priority Boost

Past-due scheduled tasks are sorted ahead of same-priority unscheduled tasks. The boost applies at query time — no DB writes needed:

- Scheduled task with priority 7, due 5 minutes ago → effective sort key = max(1, 7-2) = 5
- Unscheduled task with priority 6 → effective sort key = 6
- Result: the overdue scheduled task dispatches first

Model tier (Opus/Sonnet/Haiku) is still determined by the raw `priority` field.

## Use Cases

**Follow-up after X hours:**
```bash
# After completing a task, schedule follow-up
arc tasks add --subject "Check deployment health" --defer 2h --source "task:903"
```

**Retry after cooldown:**
```bash
arc tasks add --subject "Retry rate-limited API call" --defer 15m --priority 6
```

**Lifecycle deferral:**
```bash
# Sensor creates a task, deferred until conditions are expected to change
arc tasks add --subject "Check if PR merged" --defer 1d --skills workflows
```
