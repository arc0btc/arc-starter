#!/usr/bin/env bun

/**
 * Worktrees skill CLI — manage isolated git worktrees for dispatch tasks.
 *
 * Commands:
 *   create [--name NAME]     Create a new worktree with symlinked shared state
 *   list                      List all worktrees and their status
 *   validate --name NAME      Syntax-check .ts files changed in the worktree
 *   merge --name NAME         Validate, merge into current branch, clean up
 *   remove --name NAME        Discard worktree and its branch
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const WORKTREE_DIR = join(ROOT, ".worktrees");

// ---- Helpers ----

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

async function run(cmd: string, args: string[], cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { cwd: cwd ?? ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function git(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return run("git", args);
}

// ---- Commands ----

async function cmdCreate(name: string): Promise<void> {
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `worktree/${name}`;

  if (existsSync(worktreePath)) {
    console.error(`Worktree "${name}" already exists at ${worktreePath}`);
    process.exit(1);
  }

  mkdirSync(WORKTREE_DIR, { recursive: true });
  const { exitCode, stderr } = await git("worktree", "add", worktreePath, "-b", branchName);
  if (exitCode !== 0) {
    console.error(`git worktree add failed: ${stderr.trim()}`);
    process.exit(1);
  }

  // Symlink shared state
  const symlinks: Array<[string, string]> = [
    [join(ROOT, "db"), join(worktreePath, "db")],
    [join(ROOT, "node_modules"), join(worktreePath, "node_modules")],
  ];
  if (existsSync(join(ROOT, ".env"))) {
    symlinks.push([join(ROOT, ".env"), join(worktreePath, ".env")]);
  }

  for (const [target, link] of symlinks) {
    try { unlinkSync(link); } catch { /* doesn't exist */ }
    try {
      const entries = readdirSync(link);
      if (entries.length === 0 || (entries.length === 1 && entries[0] === "arc.db")) {
        await run("rm", ["-rf", link]);
      }
    } catch { /* not a directory */ }
    symlinkSync(target, link);
  }

  console.log(`Created worktree "${name}" at ${worktreePath}`);
  console.log(`Branch: ${branchName}`);
  console.log(`Symlinked: db/, node_modules/${existsSync(join(ROOT, ".env")) ? ", .env" : ""}`);
}

async function cmdList(): Promise<void> {
  const { stdout } = await git("worktree", "list");
  console.log(stdout.trim() || "No worktrees found.");
}

async function cmdValidate(name: string): Promise<void> {
  const worktreePath = join(WORKTREE_DIR, name);
  if (!existsSync(worktreePath)) {
    console.error(`Worktree "${name}" not found at ${worktreePath}`);
    process.exit(1);
  }

  // Get list of .ts files changed vs HEAD
  const branchName = existsSync(join(worktreePath, ".git"))
    ? name
    : `worktree/${name}`;

  const { stdout } = await git("diff", "--name-only", `HEAD...${branchName}`, "--", "*.ts");
  const changedFiles = stdout.trim().split("\n").filter(Boolean);

  if (changedFiles.length === 0) {
    console.log("No .ts files changed — nothing to validate.");
    return;
  }

  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const errors: string[] = [];
  for (const file of changedFiles) {
    const fullPath = join(worktreePath, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      transpiler.transformSync(content);
    } catch (err) {
      errors.push(`${file}: ${String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Syntax errors in ${errors.length} file(s):`);
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
  }

  console.log(`All ${changedFiles.length} changed .ts file(s) pass syntax check.`);
}

async function cmdMerge(name: string): Promise<void> {
  const worktreePath = join(WORKTREE_DIR, name);
  if (!existsSync(worktreePath)) {
    console.error(`Worktree "${name}" not found at ${worktreePath}`);
    process.exit(1);
  }

  // Validate first
  console.log("Validating...");
  const branchName = `worktree/${name}`;
  const { stdout } = await git("diff", "--name-only", `HEAD...${branchName}`, "--", "*.ts");
  const changedFiles = stdout.trim().split("\n").filter(Boolean);

  if (changedFiles.length > 0) {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const errors: string[] = [];
    for (const file of changedFiles) {
      const fullPath = join(worktreePath, file);
      try {
        const content = readFileSync(fullPath, "utf-8");
        transpiler.transformSync(content);
      } catch (err) {
        errors.push(`${file}: ${String(err)}`);
      }
    }
    if (errors.length > 0) {
      console.error(`Validation failed — ${errors.length} syntax error(s). Not merging.`);
      for (const err of errors) console.error(`  ${err}`);
      process.exit(1);
    }
  }

  // Merge
  const { exitCode, stderr } = await git("merge", branchName, "--no-edit");
  if (exitCode !== 0) {
    console.error(`Merge failed: ${stderr.trim()}`);
    process.exit(1);
  }

  // Clean up
  await git("worktree", "remove", worktreePath, "--force");
  await git("branch", "-d", branchName);
  console.log(`Merged and cleaned up worktree "${name}".`);
}

async function cmdRemove(name: string): Promise<void> {
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `worktree/${name}`;

  // Also try dispatch branch naming convention
  const dispatchBranchName = `dispatch/${name}`;

  await git("worktree", "remove", worktreePath, "--force");

  // Try deleting both possible branch names
  const { exitCode: d1 } = await git("branch", "-D", branchName);
  if (d1 !== 0) {
    await git("branch", "-D", dispatchBranchName);
  }

  console.log(`Removed worktree "${name}".`);
}

// ---- Usage ----

function usage(): void {
  console.log(`worktrees — manage isolated git worktrees

Commands:
  create [--name NAME]     Create a new worktree (default name: random)
  list                      List all worktrees
  validate --name NAME      Syntax-check changed .ts files in worktree
  merge --name NAME         Validate + merge + clean up
  remove --name NAME        Discard worktree and branch

Examples:
  arc skills run --name worktrees -- create --name my-feature
  arc skills run --name worktrees -- validate --name my-feature
  arc skills run --name worktrees -- merge --name my-feature
  arc skills run --name worktrees -- remove --name my-feature`);
}

// ---- Entry point ----

const args = process.argv.slice(2);
const { flags, positional } = parseFlags(args);
const command = positional[0];

switch (command) {
  case "create": {
    const name = flags.name ?? `wt-${Date.now()}`;
    await cmdCreate(name);
    break;
  }
  case "list":
    await cmdList();
    break;
  case "validate": {
    if (!flags.name) { console.error("--name required"); process.exit(1); }
    await cmdValidate(flags.name);
    break;
  }
  case "merge": {
    if (!flags.name) { console.error("--name required"); process.exit(1); }
    await cmdMerge(flags.name);
    break;
  }
  case "remove": {
    if (!flags.name) { console.error("--name required"); process.exit(1); }
    await cmdRemove(flags.name);
    break;
  }
  default:
    usage();
    if (command && command !== "help") process.exit(1);
}
