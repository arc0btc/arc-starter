---
name: workflow-review
description: Detect repeating task patterns and propose workflow state machines
tags:
  - orchestration
  - workflows
  - meta
---

# workflow-review

Sensor-only skill that analyzes completed task history to detect repeating multi-step processes. When it finds a pattern that recurs but isn't modeled as a workflow state machine, it creates a task to design one.

## How It Works

The sensor runs every 4 hours and:

1. **Queries** completed tasks from the last 7 days
2. **Groups** tasks by source prefix to find recurring patterns
3. **Detects** multi-step sequences: tasks with parent/child chains, or source-linked task groups that repeat
4. **Filters** patterns already covered by existing workflow templates
5. **Creates** a task (P5, skills: workflows) to design a new state machine when a novel repeating pattern is found

## Detection Criteria

A pattern qualifies when:
- Same source prefix appears in ≥3 completed tasks in the window
- Tasks form chains (parent_id links or `task:N` sources) with ≥2 steps
- No existing workflow template covers the pattern
- No pending review task already exists for this pattern

## Sensor

- **Cadence:** 240 minutes (4 hours)
- **Source:** `sensor:workflow-review`
- **Task priority:** 5 (Sonnet tier — composition/design work)
- **Skills loaded:** `["workflows", "manage-skills"]`

## Checklist

- [x] `skills/workflow-review/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
