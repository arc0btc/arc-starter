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

## Restricting Tools: `disallowed-tools`

Claude Code v2.1.152+ supports a `disallowed-tools` frontmatter field that prevents specific tools from being used when a skill is active. Use this for skills that are read-only by design — it makes intent explicit and prevents accidental side effects.

**When to add `disallowed-tools`:**
- Research skills (fetch data, produce reports, no writes)
- Audit / monitoring skills (read system state, detect anomalies)
- Review skills (assess PRs, code, content — separate from auto-fix workflows)
- Sensor-adjacent skills (detect signals, queue tasks — no direct file writes)

**Standard read-only block:**
```yaml
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
```

**Review skills** may retain `Bash` if they need `gh` or `git` for read-only queries:
```yaml
disallowed-tools: [Edit, Write, NotebookEdit]
```

**Exceptions to check before blocking Bash:**
- Skills that send emails or external API calls via subprocess (e.g. `arc-report-email`)
- Skills that serve a local web interface (e.g. `arc-web-dashboard`)
- Skills that run `gh pr view` or `git log` as part of their read-only work

If a skill accidentally attempts a disallowed tool, Claude Code fails the operation before it executes — better than a silent write. See `research/skills-disallowed-tools-audit-2026-05-27.md` for the full list of 29 candidates identified in the initial audit.

## Checklist

- [ ] `skills/<name>/SKILL.md` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter `name` matches directory name
- [ ] SKILL.md is under 2000 tokens
- [ ] If `cli.ts` present: `bun skills/<name>/cli.ts` runs without error
- [ ] If `sensor.ts` present: exports an async default function returning `Promise<string>`
- [ ] If `AGENT.md` present: describes inputs, outputs, and any gotchas
- [ ] If read-only skill: `disallowed-tools: [Edit, Write, NotebookEdit, Bash]` in frontmatter

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
bun skills/arc-skill-manager/cli.ts lint-skills               # lint all skills
bun skills/arc-skill-manager/cli.ts lint-skills --staged      # lint staged files (pre-commit)
bun skills/arc-skill-manager/cli.ts install-hooks             # install .git/hooks/pre-commit
bun skills/arc-skill-manager/cli.ts sensor-health-report      # aggregate all sensor health in one call
```

### sensor-health-report

Produces a single structured table: sensor name, interval, last run time, consecutive failures, last task produced. **Use this for any sensor health audit task.** Never read individual sensor.ts files during health audits — 73 sequential reads with accumulated context causes 1-3M token explosions per session. One CLI call replaces all of them.

## Pre-commit Hook

A git pre-commit hook (`lint-skills --staged`) prevents the two recurring compliance violations:

1. **Nested `metadata.tags`** — SKILL.md frontmatter must use top-level `tags:`, not `metadata: { tags: [...] }`
2. **Abbreviated sensor variables** — `sensor.ts` must not use `const res`, `const err`, `const val`, etc.

Install the hook once per clone:
```
arc skills run --name arc-skill-manager -- install-hooks
```

The hook is not tracked in git (lives in `.git/hooks/`). Re-run `install-hooks` on fresh clones.
