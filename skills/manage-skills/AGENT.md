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

## sensor.ts Patterns

All sensors share these rules:
- Export an async default function taking no arguments, returning `Promise<string>`
- Return `"skip"` when gated out, `"ok"` when work was done
- Use `source: "sensor:<skill-name>"` when creating tasks
- Keep sensor logic lightweight — no LLM calls

### Pattern 1: Interval-based (every N minutes)

The simplest pattern. Fires every N minutes unconditionally.

```typescript
import { claimSensorRun, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "my-skill";
const INTERVAL_MINUTES = 10;
const TASK_SOURCE = "sensor:my-skill";

export default async function mySkillSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: "detected something",
    priority: 5,
  });

  return id !== null ? "ok" : "skip";
}
```

### Pattern 2: Daily at specific time (time-guard)

Polls every 30 minutes but only fires at a target hour. Uses hook state `last_fired_date` to prevent double-firing within the same hour window.

```typescript
import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "my-daily-skill";
const POLL_INTERVAL = 30; // check every 30 min
const TARGET_HOUR = 6;    // fire at 6am local time
const TASK_SOURCE = "sensor:my-daily-skill";

export default async function myDailySensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  // Time-of-day guard
  const now = new Date();
  if (now.getHours() !== TARGET_HOUR) return "skip";

  // Dedup: only fire once per calendar day
  const state = await readHookState(SENSOR_NAME);
  const today = now.toISOString().slice(0, 10); // "2026-03-19"
  if (state?.last_fired_date === today) return "skip";

  // Mark as fired for today
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    last_fired_date: today,
  });

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: "daily task for my-daily-skill",
    priority: 5,
  });

  return id !== null ? "ok" : "skip";
}
```

### Pattern 3: Poll-and-dedup (external API check)

Polls an external source and only creates tasks for new items not seen before.

```typescript
import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "my-poll-skill";
const INTERVAL_MINUTES = 15;
const TASK_SOURCE = "sensor:my-poll-skill";

export default async function myPollSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Fetch external data
  const res = await fetch("https://api.example.com/items");
  if (!res.ok) return "skip";
  const items = await res.json();

  // Load seen IDs from state
  const state = await readHookState(SENSOR_NAME);
  const seenIds: string[] = (state?.seen_ids as string[]) ?? [];
  const seenSet = new Set(seenIds);

  // Find new items
  let created = 0;
  for (const item of items) {
    if (seenSet.has(item.id)) continue;
    seenSet.add(item.id);
    const id = insertTaskIfNew(`${TASK_SOURCE}:${item.id}`, {
      subject: `process item: ${item.title}`,
      priority: 5,
    });
    if (id !== null) created++;
  }

  // Persist seen IDs (keep last 200 to prevent unbounded growth)
  const updatedIds = [...seenSet].slice(-200);
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: new Date().toISOString(),
    last_result: created > 0 ? "ok" : "skip",
    version: (state?.version ?? 0) + 1,
    seen_ids: updatedIds,
  });

  return created > 0 ? "ok" : "skip";
}
```

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

## End-to-End Checklist for Creating a Skill with Sensor

1. Create directory: `mkdir -p skills/<name>`
2. Write `SKILL.md` with frontmatter, description, and checklist
3. Write `sensor.ts` using the appropriate pattern above
4. (Optional) Write `AGENT.md` if the skill dispatches tasks to subagents
5. (Optional) Write `cli.ts` if the skill needs a CLI interface
6. Test sensor standalone: `bun skills/<name>/sensor.ts`
7. Verify with: `bun skills/manage-skills/cli.ts show <name>`

## Output

When creating a skill, produce all required files and run:
```
bun skills/<name>/cli.ts
```
to verify the CLI works without errors (if cli.ts was created).
