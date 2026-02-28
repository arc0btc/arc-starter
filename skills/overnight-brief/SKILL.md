---
name: overnight-brief
description: Generate a consolidated overnight brief at 6am PST covering all activity from 8pm–6am
tags: [reporting, operations, recurring]
---

# Overnight Brief Skill

Generates a consolidated morning brief covering all overnight agent activity (8pm–6am PST). Fires once per day at 6am PST, replacing the hourly watch reports that are suppressed during quiet hours.

## How It Works

The sensor fires every 60 minutes but only creates a task during the 6am PST hour (14:00–15:00 UTC). The dispatch task:

1. Queries the DB for all tasks, cycles, and costs from the overnight window (8pm–6am PST)
2. Checks git log for commits in the period
3. Reads sensor state files for overnight sensor activity
4. Generates a brief from the template at `templates/overnight-brief.md`
5. Writes the brief to `reports/{ISO8601}_overnight_brief.md`
6. Commits the brief to git

## Report Location

Briefs are written to `reports/` alongside watch reports. Filenames use ISO 8601 timestamps:
- `reports/2026-02-28T14:00:00Z_overnight_brief.md`

## Template

The brief template lives at `templates/overnight-brief.md`. Covers the same data as a watch report but framed as a morning summary — what happened while the CEO slept.

## Data Sources

Same as status-report: `tasks`, `cycle_log`, `git log`, `db/hook-state/*.json`, GitHub API.

## CLI

```
arc skills run --name overnight-brief -- generate [--since ISO8601]
```

Manually trigger a brief. If `--since` is omitted, uses 8pm PST the previous evening.
