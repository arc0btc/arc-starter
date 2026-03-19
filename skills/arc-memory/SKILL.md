---
name: arc-memory
description: Pattern libraries and decision frameworks — loads memory/patterns.md + memory/frameworks.md to change how problems are approached, not just store notes
effort: medium
updated: 2026-03-18
tags:
  - meta
  - memory
  - patterns
  - frameworks
---

# arc-memory

Loads Arc's accumulated pattern library and decision frameworks into dispatch context. The distinction from MEMORY.md: these files change **how problems are approached**, not just what is remembered.

- `memory/patterns.md` — Operational patterns extracted from past cycles. Validated, reusable, actionable.
- `memory/frameworks.md` — Decision logic for recurring situation types (priority assignment, fleet routing, failure triage, decomposition, cost optimization).

## When to Load

Load this skill when the task involves:
- Meta-work: retrospectives, self-audits, pattern extraction
- Strategic planning: roadmap, architecture decisions, v6 work
- Failure triage: diagnosed a systemic issue, not just a one-off
- Cost analysis: daily/weekly cost review tasks
- Dispatch evaluation: reviewing Arc's own behavior
- Any task tagged with `arc-introspection` or `arc-dispatch-eval`

Do NOT load for routine domain tasks (DeFi, X posting, PR reviews) — the frameworks add context overhead without benefit.

## CLI Commands

```bash
# Add a new pattern to patterns.md (under the specified section)
arc skills run --name arc-memory -- add-pattern --section "Sensor Patterns" --pattern "TEXT"

# List all section headers in patterns.md
arc skills run --name arc-memory -- list-sections

# Run a retrospective: extract patterns from completed tasks in the last N days
arc skills run --name arc-memory -- retrospective [--days 7] [--dry-run]

# Show a specific decision framework by name
arc skills run --name arc-memory -- framework --name "Failure Triage"
```

## Sensor Behavior

Weekly retrospective sensor (interval: 10080 min / 7 days):
- Queries completed tasks from the past 7 days
- Creates a P7 (Sonnet) pattern extraction task
- Task briefing includes: top failed tasks, high-cost cycles, recurring subjects
- Dispatched session reads cycles, extracts reusable patterns, writes to patterns.md

## Pattern Quality Bar

Before adding to patterns.md, verify:
1. **Reusable** — applies to ≥3 future task types
2. **Actionable** — changes what you DO, not just what you know
3. **Validated** — observed in ≥2 distinct task cycles
4. **Deduplicated** — check existing patterns.md entries before writing
5. **Specific** — names context (sensor, integration, fleet), not just a principle

## Frameworks Reference

Six decision frameworks in `memory/frameworks.md`:
1. Task Priority Assignment — P1 vs P5 vs P8 decision tree
2. Fleet Routing — who handles what, degraded fleet fallbacks
3. Failure Triage — 403s, rate limits, service outages, code bugs
4. Task Decomposition — when to split vs keep atomic
5. Memory / Pattern Extraction — what goes where
6. Cost / Model Optimization — detecting over-spend

Read `memory/frameworks.md` directly for the full decision trees.

## Checklist

- [x] `skills/arc-memory/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (arc-memory)
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] Sensor uses `claimSensorRun()` with 10080-minute interval (weekly)
- [x] Sensor deduplicates via `pendingTaskExistsForSource()`
- [x] `cli.ts` exports default CLI with add-pattern, list-sections, retrospective, framework commands
