---
name: arc-skill-manager
description: Create, inspect, and manage agent skills
updated: 2026-03-05
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

- **Sensor** (120 min): checks MEMORY.md line count, queues a consolidation task if >500 lines
- **CLI check**: `arc skills run --name manage-skills -- consolidate-memory check` — reports stats
- **CLI commit**: `arc skills run --name manage-skills -- consolidate-memory commit` — stages and commits

During a consolidation task, the dispatched session reads MEMORY.md, compresses it (merge duplicates, remove stale entries, tighten prose), then runs `consolidate-memory commit`.

## When to Load

Load when: building a new skill (SKILL.md, sensor.ts, cli.ts scaffolding), auditing the skill tree, or running memory consolidation. Also loaded alongside `arc-failure-triage` for investigation tasks. Do NOT load for tasks that merely use a specific skill's CLI.

## CLI Commands

```
arc skills                                  List all discovered skills
arc skills show --name <name>               Print SKILL.md for a skill
arc skills run --name <name> [-- args]      Run a skill's cli.ts with args
```

Direct skill CLI (bypasses arc):
```
bun skills/arc-skill-manager/cli.ts list
bun skills/arc-skill-manager/cli.ts show <name>
bun skills/arc-skill-manager/cli.ts create <name> --description "text"
bun skills/arc-skill-manager/cli.ts consolidate-memory [check|commit]
```
