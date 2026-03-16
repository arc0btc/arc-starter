---
name: arc-self-review
description: Consolidated 6hr self-review sensor — metrics, triage, reflection, anomaly detection
tags:
  - operational
  - monitoring
---

# arc-self-review

Consolidated 6-hour self-review sensor. Replaces four overlapping sensors (arc-introspection, arc-ops-review, arc-operational-review, arc-self-audit) with a single unified review.

## What It Does

Every 6 hours, collects:
1. **Task metrics** — completed, failed, pending, active (6h window + 24h aggregate)
2. **Cost metrics** — spend today, budget %, cost per completion
3. **Triage issues** — failed tasks without follow-ups, blocked >24h, stale low-priority follow-ups
4. **System health** — sensor failures, git state, backlog trends
5. **Work patterns** — model distribution, skill frequency, source breakdown

Creates a single review task. Priority varies:
- P5 if anomalies or triage issues found (needs attention)
- P8 if all systems nominal (simple ack)

## Sensor

- **Cadence:** 6 hours (360 minutes)
- **Source:** `sensor:arc-self-review`
- **Dedup:** `claimSensorRun` + `pendingTaskExistsForSource`

## What It Replaced

| Old Sensor | What Was Kept |
|------------|---------------|
| arc-introspection | Model/skill/source distribution, reflection prompts |
| arc-ops-review | Threshold alerts, backlog trends, ops-metrics.json |
| arc-operational-review | Failed-no-followup, blocked >24h, stale follow-ups |
| arc-self-audit | Git state, sensor health, anomaly detection |

## Checklist

- [x] `SKILL.md` with valid frontmatter
- [x] `sensor.ts` with 6hr cadence
- [x] Replaces 4 redundant sensors
