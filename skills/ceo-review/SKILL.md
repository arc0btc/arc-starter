---
name: ceo-review
description: CEO reviews the latest status report and provides strategic direction
tags: [strategy, review, recurring]
---

# CEO Review Skill

Reviews the most recent quarterly status report through the CEO lens and appends a strategic review section.

## How It Works

The sensor fires every 240 minutes (4 hours), offset from the status-report sensor. It creates a dispatch task that:

1. Loads the CEO skill context (strategic operating manual)
2. Reads the most recent status report from `reports/`
3. Evaluates the work against CEO principles (direction, resource allocation, results)
4. Appends a review to the CEO Review section of the report
5. Creates up to 3 follow-up tasks to adjust course
6. Commits the updated report

## Review Criteria

The CEO evaluates:
- **Direction alignment** — Are we working on the right things? One project focus?
- **Resource efficiency** — Cost per completed task, token spend, cycle utilization
- **Results delivered** — What actually shipped? What's visible to others?
- **Queue health** — Is the queue balanced? Too many external tasks crowding internal work?
- **Failure patterns** — Are the same things failing repeatedly?

## Follow-up Task Budget

**Maximum 3 follow-up tasks per review.** This is a hard cap to prevent review cascades.

Follow-up tasks should be:
- Priority adjustments (reprioritize existing work)
- New strategic tasks (things the CEO identifies as missing)
- Process improvements (tuning sensors, skills, or workflows)

## Dependencies

- Requires a status report to exist in `reports/` (created by status-report sensor)
- Loads `ceo` skill context for strategic framework
- Creates tasks with source `"sensor:ceo-review"` for tracking
