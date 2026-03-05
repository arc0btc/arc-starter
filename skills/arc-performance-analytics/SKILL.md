---
name: arc-performance-analytics
description: Cost and token analytics by model tier, skill, and time period
updated: 2026-03-05
tags:
  - analytics
  - ops
---

# performance-analytics

Provides cost, token, and performance breakdowns across model tiers (Opus/Sonnet/Haiku), skills, and time periods. Helps track budget utilization and identify optimization opportunities.

## CLI Commands

```
arc skills run --name performance-analytics -- summary [--period today|week|month|all]
  Cost/token totals by model tier for the given period (default: today).

arc skills run --name performance-analytics -- by-skill [--period today|week|month|all] [--limit N]
  Cost/token breakdown per skill. Shows which skills consume the most budget.

arc skills run --name performance-analytics -- cycles [--limit N]
  Recent dispatch cycles with model, duration, cost, and token counts.

arc skills run --name performance-analytics -- help
  Print usage.
```

## Data Sources

- `tasks` table: cost_usd, api_cost_usd, tokens_in, tokens_out, priority, model, skills, status
- `cycle_log` table: cost_usd, api_cost_usd, tokens_in, tokens_out, duration_ms, model, skills_loaded

## Model Tier Mapping

| Priority | Tier | Model |
|----------|------|-------|
| P1-4 | Opus | Senior work |
| P5-7 | Sonnet | Mid-level |
| P8+ | Haiku | Junior |

Explicit `task.model` overrides priority-based routing.

## When to Load

Load when: the CEO review or a cost alert task requires detailed model-tier spend analysis, or when investigating whether task priorities are mismatched to their actual complexity. Use `summary` and `by-skill` for budget reviews. Do NOT load for routine dispatch tasks.

## Checklist

- [x] `skills/arc-performance-analytics/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runnable
