---
name: arc-ops-review
description: Tracks task creation vs completion rate, backlog trend, fleet utilization, and cost-per-useful-output
tags:
  - ops
  - metrics
  - sensor
---

# arc-ops-review

Sensor that runs every 4 hours to analyze operational metrics from the local task queue. Tracks:

- **Creation vs completion rate** — are we keeping up or falling behind?
- **Backlog trend** — pending task count over time
- **Fleet utilization** — reads `memory/fleet-status.json` for self-reported agent state
- **Cost per useful output** — total spend vs completed tasks

Creates a P7 review task when backlog is growing or cost efficiency drops.

## Sensor Behavior

- **Cadence:** 240 minutes (4 hours)
- **Source:** `sensor:arc-ops-review`
- **Alert thresholds:**
  - Backlog growth: created > completed by 50%+ over the window
  - Cost per completion > $1.00 (indicates wasted cycles)
  - Failure rate > 30% of completed tasks
- **Output:** Writes `memory/ops-metrics.json` with latest snapshot. Creates task only when thresholds breached.

## Checklist

- [x] `skills/arc-ops-review/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
