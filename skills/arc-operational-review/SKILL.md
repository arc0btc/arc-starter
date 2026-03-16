---
name: arc-operational-review
description: Self-audit sensor that surfaces unresolved operational issues every 6 hours
tags:
  - operations
  - housekeeping
  - monitoring
---

# arc-operational-review

Self-audit sensor that runs every 6 hours to surface unresolved operational issues.

## What It Does

Queries the `tasks` table for three categories of issues:

1. **Failed tasks with no follow-up** — Tasks that failed in the review window with no child task (by `parent_id` or `source = 'task:<id>'`) in pending/active/completed state. These represent dropped balls.

2. **Blocked tasks >24h** — Tasks stuck in `blocked` status for over 24 hours. May need escalation or manual intervention.

3. **Stale low-priority follow-ups** — Pending tasks with `source` starting with `task:` (dispatch-created follow-ups) at priority >=7 that have been sitting for over 6 hours. These risk being starved by higher-priority sensor-driven work.

## Sensor

- Interval: 360 minutes (6 hours)
- Creates a single summary task (P7, Sonnet) if any issues are found
- Source format: `sensor:arc-operational-review:YYYY-MM-DD`
- Dedup: one review task per day via `insertTaskIfNew`

## CLI

```
arc skills run --name arc-operational-review -- run [--hours N]
```

- `--hours N` — Review window in hours (default: 6)
- Exit code 0 = no issues, 1 = issues found
- Prints markdown report to stdout

## Interpreting Output

When dispatch receives a review task:

1. Check failed tasks — do they need retry, a fix, or can be closed?
2. Check blocked tasks — is the blocker resolved? Can it be unblocked or escalated?
3. Check stale follow-ups — should priority be bumped, or are they obsolete?

Create specific remediation tasks for actionable items. Close the review task with a summary of actions taken.
