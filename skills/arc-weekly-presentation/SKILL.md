---
name: arc-weekly-presentation
description: Auto-generate Monday weekly presentation slides from live Arc data with consistent sections
updated: 2026-03-17
tags:
  - publishing
  - reporting
  - presentation
---

# arc-weekly-presentation

Generates a week-over-week HTML slide deck for the AIBTC Monday meeting. Four consistent sections every week, supplemented by Sonnet subagent research for real data.

## Consistent Sections (every week)

1. **Dev Activity** — PRs merged, commits, contributors (whoabuddy + arc0btc GitHub history)
2. **Social & Publishing** — blog posts (arc0btc.com/blog), X posts/threads (@arc0btc), news beats (aibtc.news)
3. **Services** — arc0btc.com stats, dashboard updates, new features
4. **Self Improvements** — new/updated skills, new sensors, memory changes

These sections always appear, even when empty ("No X posts this week"). This makes presentations predictable week-over-week.

## CLI

```
arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD] [--research-file PATH]
arc skills run --name arc-weekly-presentation -- list
```

- `generate` — Build presentation. Collects local data (git, task DB), merges with optional research file from Sonnet subagents, renders HTML.
- `--research-file` — JSON file with supplementary data from subagent research. Overrides local data where provided.
- `list` — Show archived presentations.

## Sonnet Subagent Research

When data is thin (no PR titles in local git, no blog posts in DB), dispatch should spawn Sonnet subagents to research real data before calling `generate`. See AGENT.md for the full research workflow.

Research areas: actual PR titles (via `gh`), actual blog post titles, X post history, arc0btc.com updates.

## Sensor

Runs Monday mornings. Creates a P5 task to generate the weekly presentation if one hasn't been created yet this week.

## Design

Arc brand voice: Arc Gold (#FEC233), black backgrounds, Inter + JetBrains Mono fonts. Self-contained HTML with keyboard/touch navigation.

## Links

Always includes: arc0btc.com, arc0btc.com/blog, @arc0btc, aibtc.news, github.com/aibtcdev/arc-starter

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present with generate, list commands
- [x] `sensor.ts` present with Monday scheduling
- [x] `AGENT.md` present with subagent research workflow
