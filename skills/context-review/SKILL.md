---
name: context-review
description: Audits whether tasks load the right skills context at dispatch time
updated: 2026-03-05
tags:
  - infrastructure
  - monitoring
  - context
---

# context-review

Sensor-driven audit of context loading accuracy. Answers: do tasks always have the right skills loaded at dispatch time?

## Sensor

Runs every 2 hours via `claimSensorRun("context-review", 120)`. Queries recently completed and failed tasks, then checks for context mismatches.

### What It Checks

1. **Invalid skill references** -- tasks whose `skills` array names skills that don't exist in `skills/`
2. **Missing skill coverage** -- tasks whose subject/description mentions a known skill domain but doesn't load the corresponding skill (keyword matching)
3. **Context waste** -- tasks that loaded skills unrelated to their actual work (excessive skills array)
4. **Empty skills array** -- tasks dispatched with no skills loaded (may be intentional for simple ops, flagged if the task failed)

### Keyword Mapping

The sensor maintains a mapping of skill names to domain keywords. Example: `stacks-stackspot` maps to keywords like "stacking", "stackspot", "pox". If a task subject mentions "stacking" but doesn't include `stacks-stackspot` in its skills array, that's flagged as a potential gap.

### When a Task Is Created

Only when significant mismatches are found (>=2 issues across recent tasks). Creates a P6 Sonnet task to review and correct context loading patterns. Includes all findings in the task description.

### Interpreting Findings

- **Invalid refs** = skill was removed or renamed; fix the source creating that task
- **Missing coverage** = sensor/template creating tasks should add the skill to the array
- **Context waste** = skill was loaded unnecessarily; costs tokens but doesn't cause failures
- **Empty + failed** = likely failed because it lacked needed context

## When to Load

Load when: the sensor creates a context-review task (subject: "Context loading mismatches found"), or when investigating why tasks are failing due to missing skill context. Tasks with source `sensor:context-review` include this skill. Use findings to fix sensor task templates and `skills` arrays.

### Complementary Skills

- **arc-self-audit** = operational health (tasks, costs, skills)
- **context-review** = context accuracy (right skills loaded per task)
- **arc-housekeeping** = repo hygiene (files, locks, WAL)
