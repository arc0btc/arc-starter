---
name: arc-purpose-eval
description: Data-driven PURPOSE.md evaluation sensor — scores dimensions from SQL queries on tasks/cycle_log
updated: 2026-04-08
tags:
  - evaluation
  - metrics
  - orchestration
---

# arc-purpose-eval

Automated, data-driven scoring of PURPOSE.md dimensions using SQL queries against the tasks and cycle_log tables. Complements the LLM-driven `arc-strategy-review` by computing measurable scores without LLM calls.

## What It Measures

Four SQL-measurable dimensions (80% of PURPOSE weight):

| Dimension | Weight | Data Source |
|-----------|--------|-------------|
| Signal Quality | 25% | `tasks` — signal filing count + beat diversity today |
| Operational Health | 20% | `tasks` — success rate (completed vs failed, 24h) |
| Ecosystem Impact | 20% | `tasks` — PR review count (24h) |
| Cost Efficiency | 15% | `cycle_log` — cost/task and cost/day (24h) |

Three dimensions (20% weight) remain LLM-evaluated: Adaptation (10%), Collaboration (5%), Security (5%). The eval task asks a sonnet session to score these and compute the final 7-dimension weighted score.

## Sensor Behavior

- **Cadence**: Once per calendar day (12h interval + date dedup)
- **Source**: `sensor:arc-purpose-eval`
- **Follow-ups**: Auto-creates targeted tasks when scores are low:
  - Signal ≤ 2 → research task for signal-worthy topics
  - Ops ≤ 2 → failure triage task
  - Cost = 1 → cost optimization review
  - Ecosystem ≤ 1 → PR review sweep
- **State**: Persists last scores + metrics to `db/hook-state/arc-purpose-eval.json`

## Relationship to arc-strategy-review

`arc-strategy-review` creates a daily Opus task for subjective evaluation + directive progress. This sensor does the quantitative scoring first, so the strategy review can focus on qualitative assessment and directive tracking. They complement each other — consider adjusting `arc-strategy-review` to reference the data-driven scores once this sensor is validated.

## When to Load

Load when: interpreting PURPOSE scores, debugging eval metrics, or modifying the scoring rubric. Not needed for tasks that merely reference PURPOSE scores in passing.
