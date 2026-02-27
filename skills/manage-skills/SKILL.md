---
name: manage-skills
description: Create, inspect, and manage agent skills
tags:
  - meta
  - skills
  - scaffolding
---

# manage-skills

This skill manages the arc-agent skill system. Skills are knowledge containers that teach the agent how to do specific things.

## What Skills Are

A skill is a directory under `skills/` that packages knowledge and optional executable code around a focused capability. Skills are how the agent learns: each skill brings its own documentation, sensor logic, and CLI interface.

Skills are discovered automatically. The CLI scans `skills/*/SKILL.md` at runtime — no registration step is needed.

## The 4-File Pattern

Every skill is a directory with up to four files. Only `SKILL.md` is required.

| File | Required | Purpose |
|------|----------|---------|
| `SKILL.md` | Yes | Documentation, frontmatter, checklist |
| `AGENT.md` | No | Instructions for a subagent using this skill |
| `sensor.ts` | No | Background sensor: detect conditions and create tasks |
| `cli.ts` | No | Standalone CLI: `bun skills/<name>/cli.ts [args]` |

### SKILL.md

The entry point for any skill. Must include YAML frontmatter:

```yaml
---
name: skill-name
description: One-line description of what this skill does
tags:
  - tag1
  - tag2
---
```

Keep SKILL.md under 2000 tokens. It should be readable quickly by both humans and agents.

### AGENT.md

Instructions for a subagent assigned a task that uses this skill. Describe what inputs the agent needs, what outputs it should produce, and any patterns or pitfalls to watch for. Keep it concise and actionable.

### sensor.ts

A sensor runs every minute via the sensors service. It detects conditions and creates tasks. Sensors take no arguments, return `"skip"` or `"ok"`, and use `claimSensorRun()` for interval gating.

```typescript
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "my-skill";
const INTERVAL_MINUTES = 10;
const TASK_SOURCE = "sensor:my-skill";

export default async function mySkillSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({ subject: "detected something", source: TASK_SOURCE, priority: 5 });
  return "ok";
}
```

### cli.ts

A CLI for direct human or agent interaction with the skill. Must be runnable standalone:

```
bun skills/<name>/cli.ts <subcommand> [args]
```

Parse `process.argv.slice(2)` directly. Exit with code 1 on errors.

## How to Create a New Skill

1. Create directory: `skills/<name>/`
2. Write `SKILL.md` with frontmatter (name, description, tags) and content
3. Add `AGENT.md` if the skill involves agent task execution
4. Add `sensor.ts` if the skill should auto-detect conditions
5. Add `cli.ts` if the skill needs a human/agent interface

Use the scaffold command to generate a starter template:

```
arc skills run --name manage-skills -- create <name> --description "what it does"
```

## Checklist

- [ ] `skills/<name>/SKILL.md` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter `name` matches directory name
- [ ] SKILL.md is under 2000 tokens
- [ ] If `cli.ts` present: `bun skills/<name>/cli.ts` runs without error
- [ ] If `sensor.ts` present: exports an async default function returning `Promise<string>`
- [ ] If `AGENT.md` present: describes inputs, outputs, and any gotchas

## Memory Consolidation

The `consolidate-memory` command and sensor keep `memory/MEMORY.md` lean.

- **Sensor** (360 min): checks MEMORY.md line count, queues a consolidation task if >80 lines
- **CLI check**: `arc skills run --name manage-skills -- consolidate-memory check` — reports stats
- **CLI commit**: `arc skills run --name manage-skills -- consolidate-memory commit` — stages and commits

During a consolidation task, the dispatched session reads MEMORY.md, compresses it (merge duplicates, remove stale entries, tighten prose), then runs `consolidate-memory commit`.

## CLI Commands

```
arc skills                                  List all discovered skills
arc skills show --name <name>               Print SKILL.md for a skill
arc skills run --name <name> [-- args]      Run a skill's cli.ts with args
```

Direct skill CLI (bypasses arc):
```
bun skills/manage-skills/cli.ts list
bun skills/manage-skills/cli.ts show <name>
bun skills/manage-skills/cli.ts create <name> --description "text"
bun skills/manage-skills/cli.ts consolidate-memory [check|commit]
```
