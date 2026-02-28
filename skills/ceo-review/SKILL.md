---
name: ceo-review
description: CEO reviews the latest watch report and actively manages the task queue
tags: [strategy, review, recurring]
---

# CEO Review Skill

Reviews the most recent watch report through the CEO lens, appends a strategic review, and actively manages the task queue.

## How It Works

The sensor fires every 240 minutes (4 hours), after the status-report sensor. It creates a dispatch task that:

1. Loads the CEO skill context (strategic operating manual)
2. Reads the most recent watch report from `reports/`
3. Reviews research intelligence from the Research Intelligence section
4. Evaluates the work against CEO principles (direction, resource allocation, results)
5. Reviews the full task queue — pending, active, and blocked
6. Appends a review to the CEO Review section of the report (including research insights)
7. Modifies the queue: reprioritize, edit, kill, or create tasks
8. Commits the updated report

## What the CEO Can Do

**Review the report** — assess the watch against strategic direction.

**Modify existing tasks:**
- Reprioritize (change priority number)
- Edit subject or description (sharpen scope, add context)
- Kill tasks that don't serve the direction (close as completed with explanation)
- Unblock tasks by creating prerequisite tasks

**Create new tasks (max 3 per review):**
- Strategic work the agent should be doing
- Process improvements identified from the report
- Responses to patterns (e.g., "costs are rising, investigate")

## Planning Horizons

**Next watch (4 hours):** What should dispatch focus on right now? Priorities 1-4.

**Next day (24 hours):** What should be true by this time tomorrow? This shapes which tasks to create or promote.

## Dependencies

- Requires a watch report in `reports/` (created by status-report sensor)
- Loads `ceo` skill context for strategic framework
- Tasks created with source `"sensor:ceo-review"` for tracking
