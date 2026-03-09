---
name: arc-cost-alerting
description: Monitor daily fleet spend (Claude + Codex) and alert when thresholds are exceeded
updated: 2026-03-09
tags:
  - monitoring
  - cost
  - fleet
---

# cost-alerting

Sensor that monitors daily spend across the full agent fleet — including both Claude Code and OpenAI Codex (dual-dispatch) costs. Runs every 10 minutes. Creates at most one alert per day.

## How It Works

1. Queries local `tasks.cost_usd` for today's tasks, split by Claude vs Codex (`model LIKE 'codex%'`)
2. SSHes into fleet agents (spark, iris, loom, forge) to query their daily spend
3. Sums fleet-wide totals including Codex costs
4. If combined spend exceeds $150 (of $200/day cap), creates a priority-3 alert with per-agent breakdown

## Thresholds

- **Alert threshold:** $150/day (75% of cap)
- **Daily cap:** $200/day (hard budget)

## Alert Content

Alert tasks include a per-agent cost breakdown showing Claude and Codex spend separately, plus total Codex (OpenAI) spend across the fleet. Unreachable agents are flagged.

## When to Receive This Task

When you receive a cost alert task, review `arc status` and `arc tasks` to identify high-cost tasks. Consider:
- Downgrading Opus tasks to Sonnet where appropriate
- Deferring low-priority Codex tasks (OpenAI API costs add up)
- Pausing fleet agents if over cap

## Checklist

- [x] `skills/arc-cost-alerting/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] Tracks Claude Code + OpenAI Codex costs (dual-dispatch)
- [x] Fleet-wide aggregation via SSH
