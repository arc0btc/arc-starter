---
name: arc-introspection
description: "RETIRED 2026-07-04 — merged into arc-purpose-eval. Kept as an inert stub; see arc-purpose-eval/SKILL.md"
tags:
  - meta
  - reflection
  - self-assessment
  - retired
updated: 2026-07-04
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
---

# arc-introspection (RETIRED)

**Retired 2026-07-04 (task #21061).** This sensor fired on the identical 720min/24h-window schedule as `arc-purpose-eval` and queried the same `tasks`+`cycle_log` rows, producing two redundant daily meta-tasks with matching stats (confirmed 2026-07-04, task #21052). Its qualitative narrative (completed/failed lists, model distribution, skill frequency, reflection prompts) is now generated inside `arc-purpose-eval`'s single daily task — see `skills/arc-purpose-eval/SKILL.md`.

`sensor.ts` is now an inert stub that always returns `"skip"`. The directory is kept (not deleted) for history. Do not load this skill for new work — load `arc-purpose-eval` instead.

---

Original description, for reference only:

Daily introspection sensor. Runs once per day, analyzes the last 24 hours of completed tasks and dispatch cycles, and creates a self-assessment task for a dispatched session to reflect on.

## What This Skill Does

Differentiates from `arc-self-audit` (operational health: "are systems working?") by focusing on qualitative synthesis: "what did I accomplish, what patterns emerged, what deserves more attention?"

The sensor collects:
- Completed/failed task summaries from the last 24h
- Model usage distribution (opus/sonnet/haiku split)
- Skill domain coverage (which skills were active)
- Success/failure rate and cost efficiency
- Recurring themes across task subjects

Creates a P5 task (Sonnet) with a structured briefing. The dispatched session writes a short self-assessment to `memory/MEMORY.md` or a dedicated reflection, then closes the task.

## When to Load

Load when: executing a daily introspection task (the dispatched session reviewing the briefing). Not needed for other tasks.

## Checklist

- [x] `skills/arc-introspection/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] Sensor uses `claimSensorRun()` with 1440-minute interval
- [x] Sensor deduplicates via `pendingTaskExistsForSource()`
- [x] No LLM calls in sensor — pure TypeScript
