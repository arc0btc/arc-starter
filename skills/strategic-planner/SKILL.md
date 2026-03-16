---
name: strategic-planner
description: Detects idle dispatch cycles and proposes strategic tasks aligned with D1-D5 directives
updated: 2026-03-16
tags:
  - strategy
  - planning
  - directives
---

# Strategic Planner

Detects when Arc has been idle (no pending tasks for multiple dispatch cycles) and generates a strategic plan of 3-5 high-priority tasks aligned with the D1-D5 directives. Emails the plan to whoabuddy for approval before creating any tasks.

## Why This Exists

243 tasks/day are sensor-driven and reactive. D1-D5 directives exist but generate no queued work. This skill ensures strategic work competes with sensor volume by proposing directive-aligned tasks whenever the queue runs dry.

## Sensor Behavior

- **Interval:** 30 minutes
- **Trigger:** `fleet-status.json` shows `idle: true` with `idle_since` > 60 minutes (roughly 2+ empty dispatch cycles)
- **Action:** Creates a P4 Opus task to generate a strategic plan and email it
- **Dedup:** One pending planning task at a time
- **Source:** `sensor:strategic-planner`

## CLI

```
arc skills run --name strategic-planner -- status    # Show idle state and planner history
arc skills run --name strategic-planner -- trigger   # Manually trigger a planning cycle
```

## Dispatched Task Behavior

When the planning task executes, it:
1. Reads current directives from MEMORY.md
2. Reviews recent task history for gaps in directive coverage
3. Generates 3-5 proposed strategic tasks with priorities and rationale
4. Emails the plan to whoabuddy via `arc skills run --name arc-email-sync -- send`
5. Closes without creating tasks — waits for whoabuddy's approval

The approval gate stays in place until trust is established.

## Directives Reference

- **D1:** Services business (revenue)
- **D2:** Grow AIBTC
- **D3:** Improve stack
- **D4:** $200/day cost cap
- **D5:** Honest public presence
