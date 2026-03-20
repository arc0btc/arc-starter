---
name: manage-skills
description: Create, inspect, and manage agent skills
updated: 2026-03-19
tags:
  - meta
  - skills
  - scaffolding
---

# manage-skills

This skill manages the arc-agent skill system. Skills are knowledge containers that teach the agent how to do specific things.

## The 4-File Pattern

Every skill is a directory with up to four files. Only `SKILL.md` is required.

| File | Required | Purpose |
|------|----------|---------|
| `SKILL.md` | Yes | Documentation, frontmatter, checklist |
| `AGENT.md` | No | Instructions for a subagent using this skill |
| `sensor.ts` | No | Background sensor: detect conditions and create tasks |
| `cli.ts` | No | Standalone CLI: `bun skills/<name>/cli.ts [args]` |

Each file must be self-contained: `SKILL.md` frontmatter (name, description, tags); `sensor.ts` exports async default returning `Promise<string>` (`"skip"` or `"ok"`); `cli.ts` parses `process.argv.slice(2)`, exits 1 on errors.

## How to Create a New Skill

1. Create directory: `skills/<name>/`
2. Write `SKILL.md` with frontmatter (name, description, tags) and content
3. Add `AGENT.md` if the skill involves agent task execution
4. Add `sensor.ts` if the skill should auto-detect conditions
5. Add `cli.ts` if the skill needs a human/agent interface

Use the scaffold command to generate a starter template:

```
bun skills/manage-skills/cli.ts create <name> --description "what it does"
bun skills/manage-skills/cli.ts create-with-sensor <name> --description "what it does" --schedule "daily:6"
```

## Sensor Scheduling Patterns

Sensors run on a polling loop. Use these patterns for different scheduling needs:

### Interval-based (every N minutes)
Use `claimSensorRun(name, intervalMinutes)` — fires every N minutes.

### Time-of-day (daily at specific hour)
Combine `claimSensorRun` with an hour guard. The sensor polls every 30 min but only fires at the target hour. Use hook state `last_fired_date` to prevent double-firing within the same hour window.

### Poll-and-dedup (check external source, act once per event)
Poll an API/source, compare against stored state, create a task only for new items.

## WORKER_SENSORS Allowlist

**Critical**: After creating a sensor, the skill name MUST be added to `WORKER_SENSORS` in `src/sensors.ts` or the sensor won't run on worker agents. Only `arc0` runs all sensors — workers only run allowlisted ones.

## Memory Consolidation

The `consolidate-memory` command and sensor keep `memory/MEMORY.md` lean.

- **CLI check**: `bun skills/manage-skills/cli.ts consolidate-memory check` — reports stats
- **CLI commit**: `bun skills/manage-skills/cli.ts consolidate-memory commit` — stages and commits

## Checklist

- [ ] `skills/<name>/SKILL.md` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter `name` matches directory name
- [ ] SKILL.md is under 2000 tokens
- [ ] If `cli.ts` present: `bun skills/<name>/cli.ts` runs without error
- [ ] If `sensor.ts` present: exports an async default function returning `Promise<string>`
- [ ] If `sensor.ts` present: skill name added to `WORKER_SENSORS` in `src/sensors.ts`
- [ ] If `AGENT.md` present: describes inputs, outputs, and any gotchas

## CLI Commands

```
bun skills/manage-skills/cli.ts list
bun skills/manage-skills/cli.ts show <name>
bun skills/manage-skills/cli.ts create <name> --description "text"
bun skills/manage-skills/cli.ts create-with-sensor <name> --description "text" --schedule "daily:6"
bun skills/manage-skills/cli.ts consolidate-memory [check|commit]
```
