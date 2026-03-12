---
name: arc-cost-reporting
description: Daily cost and token usage report — top tasks, skills, and sensors by spend
updated: 2026-03-12
tags:
  - monitoring
  - cost
  - reporting
---

# arc-cost-reporting

Sensor that generates a daily cost and token usage report. Runs every 60 minutes, creates one report per day. No thresholds or alerts — pure reporting.

## Report Contents

Each report includes:

1. **Daily totals** — total cost_usd, token count, task count
2. **Top tasks by cost** — 5 most expensive tasks today (cost_usd)
3. **Top tasks by tokens** — 5 most token-intensive tasks today (tokens_in + tokens_out)
4. **Top skills by cost** — aggregated by the `skills` field; which skill combinations are spending most
5. **Top sensors by cost** — sensor-sourced tasks that generated the most downstream cost

## How It Works

- Runs every 60 minutes via `claimSensorRun`
- One report per day (date-stamped source key prevents duplicates)
- Queries local DB only (no SSH fleet aggregation)
- Report created as priority 9 / haiku task

## When to Receive This Task

The report is informational. Review which skills or sensors are generating expensive work. If a particular skill is unexpectedly high, investigate whether its priority routing is correct (Opus vs Sonnet vs Haiku).

## Checklist

- [x] `skills/arc-cost-reporting/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] No threshold-based alerting — pure reporting
- [x] Two cost metrics: cost_usd and token counts
