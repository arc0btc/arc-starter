#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { discoverSkills } from "../../src/skills.ts";
import { parseFlags, pad, truncate } from "../../src/utils.ts";

// ---- Constants ----

const ROOT = join(import.meta.dir, "../..");
const SKILLS_ROOT = join(ROOT, "skills");
const MEMORY_PATH = join(ROOT, "memory/MEMORY.md");
const MEMORY_LINE_THRESHOLD = 80;
const MEMORY_TOKEN_ESTIMATE_RATIO = 0.75; // ~0.75 tokens per word

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
}

function cmdMemoryCommit(): void {
  if (!existsSync(MEMORY_PATH)) {
    process.stderr.write("Error: memory/MEMORY.md not found\n");
    process.exit(1);
  }

  // Stage memory/MEMORY.md
  const addResult = spawnSync("git", ["add", "memory/MEMORY.md"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  if (addResult.status !== 0) {
    process.stderr.write(`Error staging memory/MEMORY.md: ${addResult.stderr}\n`);
    process.exit(1);
  }

  // Check if there are staged changes
  const diffResult = spawnSync("git", ["diff", "--cached", "--quiet", "memory/MEMORY.md"], {
    cwd: ROOT,
    encoding: "utf-8",
  });

  if (diffResult.status === 0) {
    process.stdout.write("No changes to memory/MEMORY.md — nothing to commit.\n");
    return;
  }

  // Commit
  const commitResult = spawnSync(
    "git",
    ["commit", "-m", "docs(memory): consolidate MEMORY.md"],
    { cwd: ROOT, encoding: "utf-8" }
  );

  if (commitResult.status !== 0) {
    process.stderr.write(`Error committing: ${commitResult.stderr}\n`);
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

  consolidate-memory [check|commit]
    Memory consolidation. 'check' reports stats (default). 'commit' stages and commits.

EXAMPLES
  bun skills/manage-skills/cli.ts list
  bun skills/manage-skills/cli.ts show manage-skills
  bun skills/manage-skills/cli.ts create my-skill --description "Does something useful"
  bun skills/manage-skills/cli.ts consolidate-memory check
  bun skills/manage-skills/cli.ts consolidate-memory commit
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

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
