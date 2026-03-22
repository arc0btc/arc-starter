/**
 * Worktree isolation — creates isolated git worktrees for tasks,
 * validates changes, and merges or discards them.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { git } from "./safe-commit.ts";
import { log, runCommand } from "./utils.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKTREE_DIR = join(ROOT, ".worktrees");

/** Create an isolated worktree for a task, symlink shared state into it. */
export async function createWorktree(taskId: number): Promise<string> {
  const name = `task-${taskId}`;
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `dispatch/task-${taskId}`;

  mkdirSync(WORKTREE_DIR, { recursive: true });
  const { exitCode, stderr } = await git("worktree", "add", worktreePath, "-b", branchName);
  if (exitCode !== 0) throw new Error(`git worktree add failed: ${stderr.trim()}`);

  // Symlink shared state into the worktree
  const aibtcDir = join(homedir(), ".aibtc");
  const symlinks: Array<[string, string]> = [
    [join(ROOT, "db"), join(worktreePath, "db")],
    [join(ROOT, "node_modules"), join(worktreePath, "node_modules")],
  ];
  if (existsSync(aibtcDir)) {
    symlinks.push([aibtcDir, join(worktreePath, ".aibtc")]);
  }
  if (existsSync(join(ROOT, ".env"))) {
    symlinks.push([join(ROOT, ".env"), join(worktreePath, ".env")]);
  }

  for (const [target, link] of symlinks) {
    try { unlinkSync(link); } catch { /* doesn't exist */ }
    try {
      const entries = readdirSync(link);
      if (entries.length === 0 || (entries.length === 1 && entries[0] === "arc.db")) {
        const { exitCode: rmExit } = await runCommand("rm", ["-rf", link]);
        if (rmExit !== 0) log(`dispatch: worktree — could not remove ${link}`);
      }
    } catch { /* not a directory */ }
    symlinkSync(target, link);
  }

  log(`dispatch: worktree created at ${worktreePath}`);
  return worktreePath;
}

/** Validate .ts files changed in the worktree branch. Returns errors or empty array. */
export async function validateWorktree(worktreePath: string, taskId: number): Promise<string[]> {
  const branchName = `dispatch/task-${taskId}`;
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", `HEAD...${branchName}`, "--", "*.ts"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const changedFiles = stdout.trim().split("\n").filter(Boolean);
  if (changedFiles.length === 0) return [];

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
  return errors;
}

/** Get all files changed in the worktree branch (not just .ts). */
export async function getWorktreeChangedFiles(worktreePath: string, taskId: number): Promise<string[]> {
  const branchName = `dispatch/task-${taskId}`;
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", `HEAD...${branchName}`],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim().split("\n").filter(Boolean);
}

/** Merge worktree branch into current branch and clean up. */
export async function mergeWorktree(taskId: number): Promise<{ ok: boolean; error?: string }> {
  const name = `task-${taskId}`;
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `dispatch/task-${taskId}`;

  const { exitCode, stderr } = await git("merge", branchName, "--no-edit");
  if (exitCode !== 0) return { ok: false, error: stderr.trim() };

  await git("worktree", "remove", worktreePath, "--force");
  await git("branch", "-d", branchName);
  log(`dispatch: worktree ${name} merged and cleaned up`);
  return { ok: true };
}

/** Remove a worktree and its branch without merging. */
export async function discardWorktree(taskId: number): Promise<void> {
  const name = `task-${taskId}`;
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `dispatch/task-${taskId}`;

  await git("worktree", "remove", worktreePath, "--force");
  await git("branch", "-D", branchName);
  log(`dispatch: worktree ${name} discarded`);
}
