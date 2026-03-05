---
name: arc-cost-alerting
description: Monitor daily spend and alert when thresholds are exceeded — sensor-only, fires once per day at $30 default
updated: 2026-03-05
tags:
  - monitoring
  - cost
---

# cost-alerting

Sensor that monitors daily Claude Code spend and creates an alert task when the total exceeds a configurable threshold. Runs every 10 minutes. Creates at most one alert per day.

## How It Works

1. Sensor queries `tasks.cost_usd` for today's completed/active tasks
2. If daily total exceeds the threshold ($100 default), creates a priority-3 alert task
3. Uses a date-stamped source key (`sensor:arc-cost-alerting:YYYY-MM-DD`) so alerts are once-per-day
4. The alert task includes the current spend and threshold in its description

## Configuration

The threshold is defined as a constant in `sensor.ts`. Default: `$30.00/day` (based on $200/week budget).

## When to Receive This Task

Sensor-only — never explicitly loaded by dispatch. When you receive a cost alert task (subject: "Daily spend alert: $X exceeds threshold"), review `arc status` and `arc tasks` to identify high-cost tasks. Consider adjusting task priorities (downgrade expensive Opus tasks to Sonnet where appropriate) and close the alert.

## Checklist

- [x] `skills/arc-cost-alerting/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
