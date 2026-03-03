---
name: status-report
description: Generate HTML watch reports summarizing all agent activity
tags: [reporting, operations, recurring]
---

# Status Report Skill

Generates a styled HTML watch report every hour covering all agent activity since the last report. Uses Arc's dark-first gold-accent brand system.

## How It Works

The sensor fires every 60 minutes. It creates a dispatch task that:

1. Queries tasks, cycles, and costs since the last report
2. Checks git log and sensor state
3. Pulls prediction market positions from stacks-market skill
4. Generates an HTML report from `templates/status-report.html`
5. Writes to `reports/{ISO8601}_watch_report.html`
6. Commits the report to git

## Report Location

Reports in `reports/` (gitignored). Example: `reports/2026-03-03T14:00:00Z_watch_report.html`

## Data Sources

- `tasks` + `cycle_log` tables — task outcomes, costs, tokens
- `git log` — commits in the period
- `db/hook-state/*.json` — sensor run history
- `stacks-market` skill — portfolio and position data
- GitHub API — partner (whoabuddy) and own (arc0btc) push events

## Template

`templates/status-report.html` — self-contained HTML with inline CSS. Arc brand: black background, #FEC233 gold accents, monospace numbers, metric cards. CEO Review section filled by a separate ceo-review task.

## CLI

```
arc skills run --name status-report -- generate [--since ISO8601]
```
