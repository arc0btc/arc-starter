#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "../../src/skills.ts";
import { parseFlags, pad, truncate } from "../../src/utils.ts";

// ---- Constants ----

const ROOT = join(import.meta.dir, "../..");
const SKILLS_ROOT = join(ROOT, "skills");
const MEMORY_PATH = join(ROOT, "memory/MEMORY.md");
const PATTERNS_PATH = join(ROOT, "memory/patterns.md");
const MEMORY_LINE_THRESHOLD = 500;
const PATTERNS_LINE_THRESHOLD = 150;
const MEMORY_TOKEN_ESTIMATE_RATIO = 0.75; // ~0.75 tokens per word

// ---- Sensor Templates ----

function sensorInterval(name: string, interval: number): string {
  const fnName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Sensor";
  return `import { claimSensorRun, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "${name}";
const INTERVAL_MINUTES = ${interval};
const TASK_SOURCE = "sensor:${name}";

export default async function ${fnName}(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: "TODO: describe what this sensor detected",
    priority: 5,
  });

  return id !== null ? "ok" : "skip";
}
`;
}

function sensorDaily(name: string, hour: number): string {
  const fnName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Sensor";
  return `import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "${name}";
const POLL_INTERVAL = 30; // check every 30 min
const TARGET_HOUR = ${hour};
const TASK_SOURCE = "sensor:${name}";

export default async function ${fnName}(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  // Time-of-day guard
  const now = new Date();
  if (now.getHours() !== TARGET_HOUR) return "skip";

  // Dedup: only fire once per calendar day
  const state = await readHookState(SENSOR_NAME);
  const today = now.toISOString().slice(0, 10);
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
    subject: "TODO: describe the daily task",
    priority: 5,
  });

  return id !== null ? "ok" : "skip";
}
`;
}

function sensorPollDedup(name: string, interval: number): string {
  const fnName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Sensor";
  return `import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "${name}";
const INTERVAL_MINUTES = ${interval};
const TASK_SOURCE = "sensor:${name}";

export default async function ${fnName}(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // TODO: Replace with actual API call
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
    const id = insertTaskIfNew(\`\${TASK_SOURCE}:\${item.id}\`, {
      subject: \`process item: \${item.title}\`,
      priority: 5,
    });
    if (id !== null) created++;
  }

  // Persist seen IDs (keep last 200)
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
`;
}

// ---- Schedule parsing ----

interface Schedule {
  type: "daily" | "interval" | "poll";
  value: number;
}

function parseSchedule(raw: string): Schedule {
  // "daily:6" → daily at hour 6
  // "every:30m" or "every:30" → interval every 30 minutes
  // "poll:15m" or "poll:15" → poll-and-dedup every 15 minutes
  const [kind, val] = raw.split(":");
  const num = parseInt(val.replace(/m$/, ""), 10);

  if (isNaN(num)) {
    process.stderr.write(`Error: invalid schedule value '${val}' — expected a number\n`);
    process.exit(1);
  }

  if (kind === "daily") return { type: "daily", value: num };
  if (kind === "every") return { type: "interval", value: num };
  if (kind === "poll") return { type: "poll", value: num };

  process.stderr.write(`Error: unknown schedule type '${kind}' — use daily, every, or poll\n`);
  process.exit(1);
}

// ---- Subcommands ----

function cmdList(): void {
  const skills = discoverSkills();

  if (skills.length === 0) {
    process.stdout.write("No skills found.\n");
    return;
  }

  const header = pad("name", 22) + "description";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(64) + "\n");

  for (const skill of skills) {
    const line = pad(truncate(skill.name, 20), 22) + truncate(skill.description, 42);
    process.stdout.write(line + "\n");
  }
}

function cmdShow(args: string[]): void {
  const name = args[0];
  if (!name) {
    process.stderr.write("Error: skill name is required\n");
    process.stderr.write("Usage: bun skills/manage-skills/cli.ts show <name>\n");
    process.exit(1);
  }

  const skills = discoverSkills();
  const skill = skills.find((s) => s.name === name);

  if (!skill) {
    process.stderr.write(`Error: skill '${name}' not found\n`);
    process.exit(1);
  }

  const content = readFileSync(join(skill.path, "SKILL.md"), "utf-8");
  process.stdout.write(content);
}

async function cmdCreate(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const name = positional[0];

  if (!name) {
    process.stderr.write("Error: skill name is required\n");
    process.stderr.write("Usage: bun skills/manage-skills/cli.ts create <name> [--description TEXT]\n");
    process.exit(1);
  }

  // Validate name: lowercase, hyphens only
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    process.stderr.write(`Error: skill name must be lowercase alphanumeric with hyphens (got: ${name})\n`);
    process.exit(1);
  }

  const skillDir = join(SKILLS_ROOT, name);

  if (existsSync(skillDir)) {
    process.stderr.write(`Error: skill '${name}' already exists at ${skillDir}\n`);
    process.exit(1);
  }

  const description = flags["description"] || "TODO: describe this skill";

  const template = `---
name: ${name}
description: ${description}
tags:
  - todo
---

# ${name}

TODO: Describe what this skill does and why it exists.

## What This Skill Does

TODO: Explain the capability this skill provides.

## The 4-File Pattern

This skill follows the arc-agent skill pattern:

| File | Present | Purpose |
|------|---------|---------|
| \`SKILL.md\` | Yes | This file — documentation and checklist |
| \`AGENT.md\` | No | Add if agents need guidance for tasks using this skill |
| \`sensor.ts\` | No | Add if this skill should detect conditions automatically |
| \`cli.ts\` | No | Add if this skill needs a CLI interface |

## How to Use

TODO: Describe how to use this skill.

## Checklist

- [ ] \`skills/${name}/SKILL.md\` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter \`name\` matches directory name (${name})
- [ ] SKILL.md is under 2000 tokens
- [ ] TODO: Add skill-specific checklist items
`;

  await Bun.write(join(skillDir, "SKILL.md"), template);

  process.stdout.write(`Created skill '${name}' at skills/${name}/SKILL.md\n`);
  process.stdout.write(`Edit the file to complete the skill definition.\n`);
}

async function cmdCreateWithSensor(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const name = positional[0];

  if (!name) {
    process.stderr.write("Error: skill name is required\n");
    process.stderr.write("Usage: bun skills/manage-skills/cli.ts create-with-sensor <name> --description TEXT --schedule TYPE:VALUE\n");
    process.stderr.write("\nSchedule types:\n");
    process.stderr.write("  daily:HOUR     Fire once per day at HOUR (0-23). Example: daily:6\n");
    process.stderr.write("  every:MINUTES  Fire every N minutes. Example: every:30\n");
    process.stderr.write("  poll:MINUTES   Poll-and-dedup every N minutes. Example: poll:15\n");
    process.exit(1);
  }

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    process.stderr.write(`Error: skill name must be lowercase alphanumeric with hyphens (got: ${name})\n`);
    process.exit(1);
  }

  const skillDir = join(SKILLS_ROOT, name);

  if (existsSync(skillDir)) {
    process.stderr.write(`Error: skill '${name}' already exists at ${skillDir}\n`);
    process.exit(1);
  }

  const description = flags["description"] || "TODO: describe this skill";
  const scheduleRaw = flags["schedule"] || "every:30";
  const schedule = parseSchedule(scheduleRaw);

  // Generate sensor.ts based on schedule type
  let sensorContent: string;
  let scheduleDoc: string;

  switch (schedule.type) {
    case "daily":
      sensorContent = sensorDaily(name, schedule.value);
      scheduleDoc = `Runs daily at ${schedule.value}:00 (polls every 30 min, fires once per day)`;
      break;
    case "interval":
      sensorContent = sensorInterval(name, schedule.value);
      scheduleDoc = `Runs every ${schedule.value} minutes`;
      break;
    case "poll":
      sensorContent = sensorPollDedup(name, schedule.value);
      scheduleDoc = `Polls every ${schedule.value} minutes, deduplicates by item ID`;
      break;
  }

  // Generate SKILL.md
  const skillTemplate = `---
name: ${name}
description: ${description}
tags:
  - todo
---

# ${name}

TODO: Describe what this skill does and why it exists.

## What This Skill Does

TODO: Explain the capability this skill provides.

## Sensor

${scheduleDoc}.

## How to Use

TODO: Describe how to use this skill.

## Checklist

- [ ] \`skills/${name}/SKILL.md\` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter \`name\` matches directory name (${name})
- [ ] SKILL.md is under 2000 tokens
- [ ] \`skills/${name}/sensor.ts\` exports async default function returning Promise<string>
- [ ] Skill name \`${name}\` added to WORKER_SENSORS in \`src/sensors.ts\`
- [ ] TODO: Add skill-specific checklist items
`;

  await Bun.write(join(skillDir, "SKILL.md"), skillTemplate);
  await Bun.write(join(skillDir, "sensor.ts"), sensorContent);

  process.stdout.write(`Created skill '${name}' with sensor at skills/${name}/\n`);
  process.stdout.write(`  SKILL.md  — ${description}\n`);
  process.stdout.write(`  sensor.ts — ${scheduleDoc}\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`⚠ IMPORTANT: Add '${name}' to WORKER_SENSORS in src/sensors.ts\n`);
  process.stdout.write(`  or the sensor will only run on arc0.\n`);
}

function cmdConsolidateMemory(args: string[]): void {
  const sub = args[0] || "check";

  switch (sub) {
    case "check":
      cmdMemoryCheck();
      break;
    case "commit":
      cmdMemoryCommit();
      break;
    default:
      process.stderr.write(`Error: unknown consolidate-memory subcommand '${sub}'\n`);
      process.stderr.write("Usage: bun skills/manage-skills/cli.ts consolidate-memory [check|commit]\n");
      process.exit(1);
  }
}

function cmdMemoryCheck(): void {
  if (!existsSync(MEMORY_PATH)) {
    process.stderr.write("Error: memory/MEMORY.md not found\n");
    process.exit(1);
  }

  const content = readFileSync(MEMORY_PATH, "utf-8");
  const lines = content.split("\n");
  const lineCount = lines.length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const estimatedTokens = Math.round(wordCount * MEMORY_TOKEN_ESTIMATE_RATIO);
  const needsConsolidation = lineCount > MEMORY_LINE_THRESHOLD;

  process.stdout.write(`memory/MEMORY.md stats:\n`);
  process.stdout.write(`  lines:            ${lineCount}\n`);
  process.stdout.write(`  words:            ${wordCount}\n`);
  process.stdout.write(`  estimated tokens: ${estimatedTokens}\n`);
  process.stdout.write(`  threshold:        ${MEMORY_LINE_THRESHOLD} lines\n`);
  process.stdout.write(`  status:           ${needsConsolidation ? "NEEDS CONSOLIDATION" : "OK"}\n`);

  // Also check patterns.md
  if (existsSync(PATTERNS_PATH)) {
    const pContent = readFileSync(PATTERNS_PATH, "utf-8");
    const pLines = pContent.split("\n");
    const pLineCount = pLines.length;
    const pNeedsConsolidation = pLineCount > PATTERNS_LINE_THRESHOLD;

    process.stdout.write(`\nmemory/patterns.md stats:\n`);
    process.stdout.write(`  lines:            ${pLineCount}\n`);
    process.stdout.write(`  threshold:        ${PATTERNS_LINE_THRESHOLD} lines\n`);
    process.stdout.write(`  status:           ${pNeedsConsolidation ? "NEEDS CONSOLIDATION" : "OK"}\n`);
  }
}

function cmdMemoryCommit(): void {
  if (!existsSync(MEMORY_PATH)) {
    process.stderr.write("Error: memory/MEMORY.md not found\n");
    process.exit(1);
  }

  // Stage memory/MEMORY.md
  const addResult = Bun.spawnSync(["git", "add", "memory/MEMORY.md"], {
    cwd: ROOT,
  });
  if (addResult.exitCode !== 0) {
    process.stderr.write(`Error staging memory/MEMORY.md: ${addResult.stderr.toString()}\n`);
    process.exit(1);
  }

  // Check if there are staged changes
  const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--quiet", "memory/MEMORY.md"], {
    cwd: ROOT,
  });

  if (diffResult.exitCode === 0) {
    process.stdout.write("No changes to memory/MEMORY.md — nothing to commit.\n");
    return;
  }

  // Commit
  const commitResult = Bun.spawnSync(
    ["git", "commit", "-m", "docs(memory): consolidate MEMORY.md"],
    { cwd: ROOT }
  );

  if (commitResult.exitCode !== 0) {
    process.stderr.write(`Error committing: ${commitResult.stderr.toString()}\n`);
    process.exit(1);
  }

  process.stdout.write("Committed memory/MEMORY.md consolidation.\n");
}

function printUsage(): void {
  process.stdout.write(`manage-skills CLI

USAGE
  bun skills/manage-skills/cli.ts <subcommand> [args]

SUBCOMMANDS
  list
    List all discovered skills.

  show <name>
    Print the SKILL.md content for a skill.

  create <name> [--description TEXT]
    Scaffold a new skill directory with a template SKILL.md.

  create-with-sensor <name> --description TEXT --schedule TYPE:VALUE
    Scaffold a skill with a sensor. Schedule types:
      daily:HOUR     Fire once per day at HOUR (0-23)
      every:MINUTES  Fire every N minutes
      poll:MINUTES   Poll-and-dedup every N minutes

  consolidate-memory [check|commit]
    Memory consolidation. 'check' reports stats (default). 'commit' stages and commits.

EXAMPLES
  bun skills/manage-skills/cli.ts list
  bun skills/manage-skills/cli.ts show manage-skills
  bun skills/manage-skills/cli.ts create my-skill --description "Does something useful"
  bun skills/manage-skills/cli.ts create-with-sensor daily-report --description "Generate daily report" --schedule "daily:6"
  bun skills/manage-skills/cli.ts create-with-sensor health-check --description "Check service health" --schedule "every:10"
  bun skills/manage-skills/cli.ts create-with-sensor feed-watcher --description "Watch RSS feed" --schedule "poll:15"
  bun skills/manage-skills/cli.ts consolidate-memory check
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "list":
      cmdList();
      break;
    case "show":
      cmdShow(args.slice(1));
      break;
    case "create":
      await cmdCreate(args.slice(1));
      break;
    case "create-with-sensor":
      await cmdCreateWithSensor(args.slice(1));
      break;
    case "consolidate-memory":
      cmdConsolidateMemory(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
