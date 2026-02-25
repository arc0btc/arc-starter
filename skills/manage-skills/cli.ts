#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "../../src/skills.ts";

// ---- Helpers ----

const SKILLS_ROOT = join(import.meta.dir, "../../skills");

function pad(s: string, width: number): string {
  return s.length >= width ? s + " " : s + " ".repeat(width - s.length);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "~" : s;
}

function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = "true";
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { flags, positional };
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

function cmdCreate(args: string[]): void {
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

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), template, "utf-8");

  process.stdout.write(`Created skill '${name}' at skills/${name}/SKILL.md\n`);
  process.stdout.write(`Edit the file to complete the skill definition.\n`);
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

EXAMPLES
  bun skills/manage-skills/cli.ts list
  bun skills/manage-skills/cli.ts show manage-skills
  bun skills/manage-skills/cli.ts create my-skill --description "Does something useful"
`);
}

// ---- Entry point ----

const args = process.argv.slice(2);
const sub = args[0];

if (sub === "list") {
  cmdList();
} else if (sub === "show") {
  cmdShow(args.slice(1));
} else if (sub === "create") {
  cmdCreate(args.slice(1));
} else if (sub === "help" || sub === "--help" || sub === "-h") {
  printUsage();
} else if (sub === undefined) {
  printUsage();
} else {
  process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
  printUsage();
  process.exit(1);
}
