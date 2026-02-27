---
name: status-report
description: Generate watch reports (4-hour) summarizing all agent activity
tags: [reporting, operations, recurring]
---

# Status Report Skill

Generates a structured watch report every 4 hours covering all agent activity since the last report.

## How It Works

The sensor fires every 240 minutes (4 hours). It creates a dispatch task that:

1. Queries the DB for all tasks, cycles, and costs since the last report
2. Checks git log for commits in the period
3. Reads sensor state files for heartbeat/inbox/email activity
4. Generates a report from the template at `templates/status-report.md`
5. Writes the report to `reports/{ISO8601}_watch_report.md`
6. Commits the report to git

## Report Location

Reports are written to `reports/` (gitignored — local only). Filenames use ISO 8601 timestamps:
- `reports/2026-02-27T22:00:00Z_watch_report.md`

## Template

The report template lives at `templates/status-report.md`. The dispatch task fills in all sections above the CEO Review line. The CEO Review section is filled by a separate `ceo-review` task that runs after.

## Data Sources

- `tasks` table — completed/failed/blocked tasks, costs, token counts
- `cycle_log` table — dispatch cycle history, durations, costs
- `git log` — commits made during the reporting period
- `db/hook-state/*.json` — sensor run history
- Task `result_summary` fields — one-line outcomes
- GitHub API (`gh api /users/whoabuddy/events`) — partner activity from interactive sessions
- GitHub API (`gh api /users/arc0btc/events`) — own repo push activity

## CLI

```
arc skills run --name status-report -- generate [--since ISO8601]
```

Manually trigger a report generation. If `--since` is omitted, uses the last report timestamp or 4 hours ago.
