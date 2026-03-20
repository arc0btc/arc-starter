---
name: self-blocked-review
description: Sensor that periodically reviews blocked tasks to check if they can be unblocked
tags:
  - operations
  - tasks
---

# self-blocked-review

Periodically scans blocked tasks and checks for signals that they may be ready to unblock.

## Sensor

**Cadence:** Every 120 minutes.

**Detection signals** (any match flags the task for review):
1. **Sibling completion** — tasks with the same parent completed after the task was blocked
2. **Child completion** — tasks with `source: "task:<blocked_id>"` completed
3. **Mention completion** — tasks that reference `#<blocked_id>` in subject/description completed
4. **Stale threshold** — blocked for >48 hours without review

When candidates are found, the sensor creates a single Sonnet-tier (P7) review task listing all flagged blocked tasks with their signals. The dispatched reviewer evaluates each candidate and either unblocks (requeues) or confirms the block with an updated reason.

## Review Task Behavior

When dispatched to review blocked tasks:
1. Read each candidate's block reason and signals
2. Check if the blocking condition is resolved
3. If resolved: `arc tasks update --id <N> --status pending` to requeue
4. If still blocked: leave as-is (or update `result_summary` with current status)
5. Close the review task with a summary of actions taken
