---
name: auto-queue
description: Generates next task batch based on completion patterns and queue depth
updated: 2026-03-09
tags:
  - orchestration
  - scheduling
  - automation
---

# auto-queue

Analyzes task completion patterns and queue depth by skill domain. When a domain is "hungry" (completing faster than new tasks arrive, queue running low), creates a dispatch task to generate the next batch of work.

## How It Works

The sensor runs every 2 hours and:

1. **Collects completion stats** — Groups recently completed tasks by skill domain (last 6h window)
2. **Measures queue depth** — Counts pending tasks per domain
3. **Detects hungry domains** — A domain is hungry when:
   - It completed ≥3 tasks in the window AND has ≤2 pending tasks remaining
   - OR its completion rate exceeds its creation rate by 2x+
4. **Creates a batch task** — A single P5 task that lists the hungry domains and their stats, for dispatch to generate appropriate follow-up work

The sensor does NOT generate tasks directly — it creates a single "generate batch" task that dispatch executes with full LLM context. This keeps the sensor pure TypeScript (no LLM calls) while letting the dispatched session make intelligent decisions about what to queue next.

## Domain Detection

Skills are grouped into domains from the task's `skills` JSON array. Tasks without skills are grouped as `_general`. The first skill in the array is used as the domain key.

## CLI Commands

```bash
# Show current queue depth and completion stats by domain
bun skills/auto-queue/cli.ts status

# Show which domains are hungry (would trigger batch generation)
bun skills/auto-queue/cli.ts hungry

# Manually trigger batch generation task (bypasses sensor interval)
bun skills/auto-queue/cli.ts trigger
```

Via arc CLI:
```bash
arc skills run --name auto-queue -- status
arc skills run --name auto-queue -- hungry
arc skills run --name auto-queue -- trigger
```

## When to Load

Load when: tuning auto-queue thresholds, debugging why batches aren't generating, or manually triggering batch generation. Do NOT load for normal task execution.

## Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| Sensor interval | 120 min | How often the sensor checks |
| Lookback window | 6h | How far back to analyze completions |
| Min completions | 3 | Minimum completions to consider a domain active |
| Max pending | 2 | Queue depth below which a domain is "hungry" |
| Creation/completion ratio | 0.5 | Ratio below which backfill is needed |

## Batch Task Format

When hungry domains are detected, the sensor creates a task like:

```
Subject: "Auto-queue: 3 hungry domain(s) need work"
Description: Domain stats + guidance for what to generate
Priority: 5 (Sonnet — composition/operational)
Skills: ["auto-queue"]
```

The dispatched session reads the domain stats and creates appropriate follow-up tasks using `arc tasks add`. It should consult GOALS.md and MEMORY.md to align new work with current priorities.
