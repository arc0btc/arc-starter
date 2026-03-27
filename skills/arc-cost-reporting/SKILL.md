---
name: arc-cost-reporting
description: Daily cost and token usage report — tracks dual costs (Claude Code vs API estimates)
updated: 2026-03-13
tags:
  - monitoring
  - cost
  - reporting
---

# arc-cost-reporting

Sensor that generates a daily cost and token usage report. Runs every 60 minutes, creates one report per day. No thresholds or alerts — pure reporting.

## Report Contents

Each report includes dual-cost breakdown (Claude Code + API estimate):

1. **Daily totals** — `cost_usd` (Claude Code), `api_cost_usd` (token-rate estimate), tokens, task count
2. **Top tasks by cost** — 5 most expensive tasks today (sorted by code cost, showing both cost fields)
3. **Top tasks by tokens** — 5 most token-intensive tasks today (tokens_in + tokens_out)
4. **Top skills by cost** — aggregated by the `skills` field; dual-cost breakdown per skill
5. **Top sensors by cost** — sensor-sourced tasks with dual-cost breakdown

## How It Works

- Runs every 60 minutes via `claimSensorRun`
- One report per day (date-stamped source key prevents duplicates)
- Queries local DB only
- Report created as priority 9 / haiku task

## When to Receive This Task

The report is informational. Review which skills or sensors are generating expensive work. If a particular skill is unexpectedly high, investigate whether its priority routing is correct (Opus vs Sonnet vs Haiku).

## Cost Fields Explained

- **cost_usd**: Actual Claude Code session consumption cost (what Anthropic charges)
- **api_cost_usd**: Estimated API cost calculated from tokens × per-token rate (what the equivalent API calls would cost)

Both are tracked in `tasks.cost_usd` and `tasks.api_cost_usd` as documented in CLAUDE.md.

## Checklist

- [x] `skills/arc-cost-reporting/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] No threshold-based alerting — pure reporting
- [x] Dual cost metrics: cost_usd and api_cost_usd tracked in all report sections
- [x] Report breakdowns include both cost fields for comparison
