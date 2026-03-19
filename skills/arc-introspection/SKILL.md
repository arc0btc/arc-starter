---
name: arc-introspection
description: Daily introspection — synthesizes 24h of dispatch cycles into qualitative self-assessment
effort: high
tags:
  - meta
  - reflection
  - self-assessment
updated: 2026-03-08
---

# arc-introspection

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
