---
name: arc-weekly-presentation
description: Auto-generate the Monday AIBTC working-group deck from live Arc data — four consistent sections, last-week anchor, subagent research
updated: 2026-04-22
tags:
  - publishing
  - reporting
  - presentation
---

# arc-weekly-presentation

Generates the week-over-week deck for the Monday AIBTC working-group meeting. Internal recap, data-dense, predictable shape. Not the same as [`agent-pitch`](../agent-pitch/SKILL.md) — that skill is for external-audience narrative talks. Use both together when an external deck needs current stats.

## Consistent sections (every week, always present)

1. **Dev Activity** — PRs merged, commits, contributors (whoabuddy + arc0btc GitHub history)
2. **Social & Publishing** — blog posts (arc0btc.com/blog), X posts/threads (@arc0btc), news beats (aibtc.news)
3. **Services** — arc0btc.com stats, dashboard updates, new features shipped
4. **Self Improvements** — new/updated skills, new sensors, memory changes

Empty sections render as "No X this week" — never omitted. Predictable structure is the point.

## Target shape

- **8 slides default**: title + 4 section slides + 1 closing + optional *New Agents Welcomed* + optional *Highlight* if a standout item deserves its own slide.
- Under 10 slides total. If you have more material, tighten — don't expand.
- Brand: Arc Gold (`#FEC233`) on black. Matches `arc-brand-voice`.

## CLI

```
arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD] [--research-file PATH]
arc skills run --name arc-weekly-presentation -- list
```

- `generate` — Collect local data (git + task DB), merge optional research file, render deck. Writes `src/web/presentation.html` (served at `/presentation`) and archives the prior file to `src/web/archives/YYYYMMDD-aibtc-weekly.html`.
- `--week YYYY-MM-DD` — Monday of the week to generate for. Defaults to this past Monday UTC.
- `--research-file PATH` — JSON with supplementary data from subagents. Overrides local data where provided.
- `list` — Show archived weekly decks under `src/web/archives/`.

## Sonnet subagent research

When local data is thin (git log misses PR titles, task DB misses blog titles), **dispatch should spawn Sonnet subagents in parallel** to collect real data before calling `generate`. See AGENT.md for the workflow, schema, and per-subagent briefs.

Research areas: PR titles (`gh`), blog titles (`arc0btc.com/blog`), X post subjects, aibtc.news beat titles.

## Sensor

Runs hourly. Mondays only. Creates a P5 Sonnet task if no weekly task exists for the current Monday (7-day dedup via source prefix `sensor:arc-weekly-presentation:YYYY-MM-DD`).

## Last-week anchor

Before generating, read the most recent file under `src/web/archives/` matching `*-aibtc-weekly.html` (or `*-aibtc-tuesday.html` if the cadence shifts). Use it to frame what's *new* this week vs. carried over. Don't copy content — just context.

## Links always in the closing slide

`arc0btc.com` · `arc0btc.com/blog` · `@arc0btc` · `aibtc.news` · `github.com/aibtcdev/arc-starter`

## Checklist

- [x] SKILL.md with valid frontmatter, under 2000 tokens
- [x] `cli.ts` with `generate` + `list` commands
- [x] `sensor.ts` with Monday scheduling + 7-day dedup
- [x] `AGENT.md` with subagent research workflow and JSON schema
- [x] Archives land in `src/web/archives/YYYYMMDD-aibtc-weekly.html`
- [x] Live slot stays at `src/web/presentation.html` for `/presentation` endpoint
