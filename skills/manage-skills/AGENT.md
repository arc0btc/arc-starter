# manage-skills Agent Instructions

You are creating or modifying a skill for the arc-agent framework. Follow these rules exactly.

## The 4-File Pattern

A skill lives at `skills/<name>/` and contains up to four files:

- `SKILL.md` — required; documentation + frontmatter + checklist
- `AGENT.md` — optional; instructions for subagents using this skill
- `sensor.ts` — optional; background sensor that creates tasks
- `cli.ts` — optional; standalone CLI for human/agent interaction

## Frontmatter Format

Every `SKILL.md` must start with a YAML frontmatter block:

```yaml
---
name: skill-name
description: One-line description of what this skill does
tags:
  - tag1
  - tag2
---
```

Rules:
- `name` must match the directory name exactly
- `description` is a single sentence, no period at end
- `tags` is a YAML list of lowercase hyphenated strings

## SKILL.md Requirements

- Must have valid frontmatter (name, description, tags)
- Must have a Checklist section with `[ ]` items that are concretely testable
- Must stay under 2000 tokens (~1500 words)
- Use plain Markdown, no HTML

## Checklist Section Requirement

Every SKILL.md must include a `## Checklist` section. Items must be concretely testable:

```markdown
## Checklist

- [ ] `skills/<name>/SKILL.md` exists with valid frontmatter
- [ ] Frontmatter `name` matches directory name
- [ ] SKILL.md is under 2000 tokens
```

## sensor.ts Pattern

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

Rules:
- Export an async default function taking no arguments, returning `Promise<string>`
- Return `"skip"` when gated out, `"ok"` when work was done
- Use `claimSensorRun(name, intervalMinutes)` for interval gating
- Use `pendingTaskExistsForSource()` to deduplicate tasks
- Use `source: "sensor:<skill-name>"` when creating tasks
- Keep sensor logic lightweight — no LLM calls

## cli.ts Pattern

```typescript
#!/usr/bin/env bun

const args = process.argv.slice(2);
const sub = args[0];

if (sub === "list") {
  // handle list
} else if (sub === "create") {
  // handle create
} else {
  process.stderr.write(`Usage: bun skills/<name>/cli.ts <subcommand>\n`);
  process.exit(1);
}
```

Rules:
- Parse `process.argv.slice(2)` directly, no external arg parsing library
- Must be runnable standalone with `bun skills/<name>/cli.ts`
- Exit with code 1 on errors, write errors to stderr
- For flags: scan args for `--key value` pairs manually

## Output

When creating a skill, produce all required files and run:
```
bun skills/<name>/cli.ts
```
to verify the CLI works without errors.
