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
    process.stderr.write("Usage: bun skills/arc-skill-manager/cli.ts show <name>\n");
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
    process.stderr.write("Usage: bun skills/arc-skill-manager/cli.ts create <name> [--description TEXT]\n");
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
      process.stderr.write("Usage: bun skills/arc-skill-manager/cli.ts consolidate-memory [check|commit]\n");
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

// ---- Lint: skill frontmatter + sensor naming ----

interface LintViolation {
  file: string;
  line?: number;
  message: string;
}

/** Parse YAML-style frontmatter block delimited by --- lines. Returns raw block string or null. */
function extractFrontmatter(content: string): string | null {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (endIdx === -1) return null;
  return lines.slice(1, endIdx).join("\n");
}

/** Lint a SKILL.md file for frontmatter compliance. */
function lintSkillMd(filePath: string, content: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const frontmatter = extractFrontmatter(content);

  if (frontmatter === null) {
    violations.push({ file: filePath, message: "Missing or malformed frontmatter (expected --- delimiters)" });
    return violations;
  }

  // Check required top-level fields: name, description, tags
  const hasName = /^name\s*:/m.test(frontmatter);
  const hasDescription = /^description\s*:/m.test(frontmatter);
  const hasTopLevelTags = /^tags\s*:/m.test(frontmatter);

  if (!hasName) violations.push({ file: filePath, message: "Frontmatter missing required field: name" });
  if (!hasDescription) violations.push({ file: filePath, message: "Frontmatter missing required field: description" });
  if (!hasTopLevelTags) {
    violations.push({ file: filePath, message: "Frontmatter missing required field: tags (must be top-level)" });
  }

  // Detect nested metadata.tags pattern: a `metadata:` block that contains `tags:`
  const metadataBlockRe = /^metadata\s*:/m;
  if (metadataBlockRe.test(frontmatter)) {
    // Check if tags appear indented under metadata (nested)
    const lines = frontmatter.split("\n");
    let inMetadata = false;
    for (const line of lines) {
      if (/^metadata\s*:/.test(line)) { inMetadata = true; continue; }
      if (inMetadata) {
        if (/^\S/.test(line)) { inMetadata = false; continue; } // new top-level key
        if (/^\s+tags\s*:/.test(line)) {
          violations.push({ file: filePath, message: "tags must be top-level in frontmatter, not nested under metadata:" });
          break;
        }
      }
    }
  }

  return violations;
}

/** Abbreviated variable name patterns that violate verbose naming convention. */
const ABBREVIATED_VAR_RE = /\bconst\s+(res|val|err|ret|r|v|e)\s*[=:]/;

/** Lint a sensor.ts file for abbreviated variable names. */
function lintSensorTs(filePath: string, content: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ABBREVIATED_VAR_RE.test(line)) {
      const match = line.match(ABBREVIATED_VAR_RE);
      violations.push({
        file: filePath,
        line: i + 1,
        message: `Abbreviated variable name '${match![1]}' — use a descriptive name (e.g. 'response', 'error')`,
      });
    }
  }

  return violations;
}

/** Get staged file paths from git. Returns empty array if not in a git repo or on error. */
function getStagedFiles(): string[] {
  const result = Bun.spawnSync(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: ROOT,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().trim().split("\n").filter(Boolean);
}

function cmdLintSkills(args: string[]): void {
  const { flags, positional: _ } = parseFlags(args);
  const staged = flags["staged"] === true || flags["staged"] === "true";
  const filesFlag = flags["files"] as string | undefined;

  let targetFiles: string[];

  if (filesFlag) {
    targetFiles = filesFlag.split(",").map((f) => f.trim()).filter(Boolean);
  } else if (staged) {
    targetFiles = getStagedFiles();
  } else {
    // Lint all SKILL.md and sensor.ts files under skills/
    const skillMds = Bun.spawnSync(["git", "ls-files", "skills/"], { cwd: ROOT });
    targetFiles = skillMds.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((f) => f.endsWith("/SKILL.md") || f.endsWith("/sensor.ts"));
  }

  const skillMdFiles = targetFiles.filter((f) => /skills\/[^/]+\/SKILL\.md$/.test(f));
  const sensorFiles = targetFiles.filter((f) => /skills\/[^/]+\/sensor\.ts$/.test(f));

  const allViolations: LintViolation[] = [];

  for (const file of skillMdFiles) {
    const fullPath = join(ROOT, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf-8");
    allViolations.push(...lintSkillMd(file, content));
  }

  for (const file of sensorFiles) {
    const fullPath = join(ROOT, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf-8");
    allViolations.push(...lintSensorTs(file, content));
  }

  if (allViolations.length === 0) {
    process.stdout.write(`OK — ${skillMdFiles.length} SKILL.md + ${sensorFiles.length} sensor.ts checked, no violations.\n`);
    return;
  }

  for (const v of allViolations) {
    const loc = v.line !== undefined ? `${v.file}:${v.line}` : v.file;
    process.stderr.write(`LINT: ${loc}: ${v.message}\n`);
  }
  process.stderr.write(`\n${allViolations.length} violation(s) found. Fix before committing.\n`);
  process.exit(1);
}

function cmdInstallHooks(): void {
  const hooksDir = join(ROOT, ".git", "hooks");
  const hookPath = join(hooksDir, "pre-commit");

  const hookScript = `#!/bin/sh
# Arc skill frontmatter + sensor naming lint
# Installed by: arc skills run --name arc-skill-manager -- install-hooks

cd "$(git rev-parse --show-toplevel)"
exec bun skills/arc-skill-manager/cli.ts lint-skills --staged
`;

  Bun.write(hookPath, hookScript);

  // Make executable
  const chmodResult = Bun.spawnSync(["chmod", "+x", hookPath]);
  if (chmodResult.exitCode !== 0) {
    process.stderr.write(`Error: chmod +x ${hookPath} failed\n`);
    process.exit(1);
  }

  process.stdout.write(`Installed pre-commit hook at .git/hooks/pre-commit\n`);
  process.stdout.write(`Hook runs: bun skills/arc-skill-manager/cli.ts lint-skills --staged\n`);
}

function printUsage(): void {
  process.stdout.write(`manage-skills CLI

USAGE
  bun skills/arc-skill-manager/cli.ts <subcommand> [args]

SUBCOMMANDS
  list
    List all discovered skills.

  show <name>
    Print the SKILL.md content for a skill.

  create <name> [--description TEXT]
    Scaffold a new skill directory with a template SKILL.md.

  consolidate-memory [check|commit]
    Memory consolidation. 'check' reports stats (default). 'commit' stages and commits.

  lint-skills [--staged] [--files FILE1,FILE2,...]
    Validate SKILL.md frontmatter and sensor.ts variable naming.
    --staged: lint only git-staged files (used by pre-commit hook)
    --files:  lint specific comma-separated file paths
    (no flags): lint all skills/ SKILL.md and sensor.ts files

  install-hooks
    Install .git/hooks/pre-commit to run lint-skills on every commit.

EXAMPLES
  bun skills/arc-skill-manager/cli.ts list
  bun skills/arc-skill-manager/cli.ts show manage-skills
  bun skills/arc-skill-manager/cli.ts create my-skill --description "Does something useful"
  bun skills/arc-skill-manager/cli.ts consolidate-memory check
  bun skills/arc-skill-manager/cli.ts consolidate-memory commit
  bun skills/arc-skill-manager/cli.ts lint-skills
  bun skills/arc-skill-manager/cli.ts lint-skills --staged
  bun skills/arc-skill-manager/cli.ts install-hooks
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
    case "lint-skills":
      cmdLintSkills(args.slice(1));
      break;
    case "install-hooks":
      await cmdInstallHooks();
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
