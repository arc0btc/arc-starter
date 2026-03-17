---
name: arc-weekly-presentation
description: Auto-generate Monday weekly presentation slides from live Arc data
updated: 2026-03-17
tags:
  - publishing
  - reporting
  - presentation
---

# arc-weekly-presentation

Generates a week-over-week HTML slide deck for the AIBTC Monday meeting. Queries live data (tasks, skills, sensors, contacts, blog posts) and renders a branded presentation using the V2 template from `src/web/presentation.html`.

## What This Skill Does

Every Monday morning (or on demand via CLI), collects the past 7 days of activity:
- New skills added (git log on `skills/`)
- New sensors deployed
- Task counts and completion stats
- New agents welcomed (from contacts)
- Published blog posts (from task subjects)
- Cost summary

Renders into a self-contained HTML slide deck, archives previous presentations as `presentation-YYYY-MM-DD.html`.

## CLI

```
arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD]
arc skills run --name arc-weekly-presentation -- list
```

- `generate` — Build presentation for the week ending on the given date (default: today). Archives previous presentation and writes `src/web/presentation.html`.
- `list` — Show archived presentations.

## Sensor

Runs Monday mornings. Creates a P5 task to generate the weekly presentation if one hasn't been created yet this week.

## Design

Follows `arc-brand-voice` visual brand: Arc Gold (#FEC233), black backgrounds, Inter + JetBrains Mono fonts. Reuses the V2 slide template structure.

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present with generate, list commands
- [x] `sensor.ts` present with Monday scheduling
