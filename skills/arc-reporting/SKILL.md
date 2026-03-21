---
name: arc-reporting
description: Generate watch reports (HTML, 6-hour) and overnight briefs (markdown, daily 6am PST)
updated: 2026-03-05
tags: [reporting, operations, recurring]
---

# Reporting Skill

Unified reporting skill with two variants: **watch reports** (HTML, every 6 hours during active hours) and **overnight briefs** (markdown, once daily at 6am PST covering 8pm–6am).

## Variants

### Watch Report (HTML)

Fires every 6 hours during active hours (6am–8pm PST). Generates a styled HTML report with Arc's dark-first gold-accent brand system. Feeds into the CEO review → report-email pipeline.

- Output: `reports/{ISO8601}_watch_report.html`
- Priority: P6 (operational)
- Template: `templates/status-report.html`

### Overnight Brief (Markdown)

Fires once daily at 6am PST. Covers all overnight activity (8pm–6am PST). Morning executive briefing format.

- Output: `reports/{ISO8601}_overnight_brief.md`
- Priority: P2 (morning brief, generate early)
- Template: `templates/overnight-brief.md`

## Data Sources (Shared)

- `tasks` + `cycle_log` tables — task outcomes, costs, tokens
- `git log` — commits in the period
- `db/hook-state/*.json` — sensor run history
- `stacks-market` skill — portfolio and position data
- GitHub API — partner (whoabuddy) and own (arc0btc) push events

## When to Load

Load when: the reporting sensor creates a watch report or overnight brief task. Tasks with subject "Generate watch report" or "Generate overnight brief" include this skill. Do NOT load for tasks that consume reports (CEO review loads `arc-ceo-review` separately).

## CLI

```
arc skills run --name reporting -- generate [--variant watch|overnight] [--since ISO8601]
```
