/**
 * Safe commit pipeline — stages files, syntax-checks .ts, commits,
 * then health-checks services. Reverts on service death.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { insertTask } from "./db.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ARC_SERVICES = ["arc-web.service", "arc-sensors.timer", "arc-dispatch.timer"] as const;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Spawn a command in the repo root, capturing output. */
async function spawnCapture(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/** Spawn a git command in the repo root, capturing output. */
export async function git(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnCapture("git", args);
}

/** Return the current HEAD commit SHA, or null if git fails. */
export async function getHeadSha(): Promise<string | null> {
  const { exitCode, stdout } = await git("rev-parse", "HEAD");
  if (exitCode !== 0) return null;
  return stdout.trim() || null;
}

/** Check if any commits since sha touched src/ or skills/. Returns true if git fails (fail open). */
export async function codeChangedSince(sha: string | null): Promise<boolean> {
  if (!sha) return true;
  const { exitCode, stdout } = await git("diff", "--name-only", sha, "HEAD");
  if (exitCode !== 0) return true;
  const files = stdout.trim().split("\n").filter(Boolean);
  return files.some((f) => f.startsWith("src/") || f.startsWith("skills/"));
}

/** Syntax-check .ts files using Bun.Transpiler. Returns errors or empty array. */
function validateSyntax(files: string[]): string[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const errors: string[] = [];
  for (const file of files) {
    const fullPath = join(ROOT, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      transpiler.transformSync(content);
    } catch (err) {
      errors.push(`${file}: ${String(err)}`);
    }
  }
  return errors;
}

/** Snapshot which systemd user services are currently active. */
async function snapshotServiceState(): Promise<Map<string, boolean>> {
  const state = new Map<string, boolean>();
  for (const svc of ARC_SERVICES) {
    const { exitCode } = await spawnCapture("systemctl", ["--user", "is-active", svc]);
    state.set(svc, exitCode === 0);
  }
  return state;
}

/** Compare post-commit service state to snapshot. Returns names of services that died. */
async function checkServiceHealth(before: Map<string, boolean>): Promise<string[]> {
  const died: string[] = [];
  for (const [svc, wasActive] of before) {
    if (!wasActive) continue;
    const { exitCode } = await spawnCapture("systemctl", ["--user", "is-active", svc]);
    if (exitCode !== 0) died.push(svc);
  }
  return died;
}

interface StageResult {
  staged: boolean;
  files: string[];
  tsFiles: string[];
}

/** Stage known directories and return staged file lists. */
async function stageChanges(): Promise<StageResult> {
  const stageDirs = ["memory/", "skills/", "src/", "templates/"];
  for (const dir of stageDirs) {
    if (existsSync(join(ROOT, dir))) {
      const { exitCode, stderr } = await git("add", dir);
      if (exitCode !== 0) {
        throw new Error(`git add ${dir} failed: ${stderr.trim()}`);
      }
    }
  }

  const { exitCode: diffExit } = await git("diff", "--cached", "--quiet");
  if (diffExit === 0) return { staged: false, files: [], tsFiles: [] };

  const { stdout } = await git("diff", "--cached", "--name-only");
  const files = stdout.trim().split("\n").filter(Boolean);
  const tsFiles = files.filter((f) => f.endsWith(".ts"));

  return { staged: true, files, tsFiles };
}

interface CommitResult {
  ok: boolean;
  error?: string;
}

/** Run git commit with the given message. Returns ok=false on failure. */
async function commitWithMessage(message: string): Promise<CommitResult> {
  const { exitCode, stderr } = await git("commit", "-m", message);
  if (exitCode !== 0) return { ok: false, error: stderr.trim() };
  return { ok: true };
}

/**
 * After a commit touching src/ files, verify services are still alive.
 * If any died: revert the commit, restart them, and create a follow-up task.
 */
async function revertOnServiceDeath(
  servicesBefore: Map<string, boolean>,
  taskId: number,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const diedServices = await checkServiceHealth(servicesBefore);
  if (diedServices.length === 0) return;

  log(`dispatch: services DIED after commit: ${diedServices.join(", ")}`);

  const { exitCode: revertExit } = await git("revert", "--no-edit", "HEAD");
  if (revertExit === 0) {
    log("dispatch: reverted HEAD commit");
  } else {
    log("dispatch: WARNING — git revert failed, manual intervention needed");
  }

  for (const svc of diedServices) {
    await spawnCapture("systemctl", ["--user", "restart", svc]);
    log(`dispatch: restarted ${svc}`);
  }

  insertTask({
    subject: `Fix service crash from task #${taskId}`,
    description: `Services died after commit: ${diedServices.join(", ")}. Commit was reverted.`,
    priority: 2,
    source: `task:${taskId}`,
  });
  log("dispatch: created follow-up task for service crash");
}

/**
 * Safe commit: stages files, syntax-checks .ts, commits, then health-checks services.
 * If syntax check fails: unstages, creates follow-up task.
 * If services die after commit: reverts commit, restarts services, creates follow-up task.
 */
export async function safeCommitCycleChanges(taskId: number): Promise<void> {
  const servicesBefore = await snapshotServiceState();

  let stage: StageResult;
  try {
    stage = await stageChanges();
  } catch (err) {
    log(`dispatch: staging failed — ${err}`);
    insertTask({
      subject: `Fix staging failure from task #${taskId}`,
      description: `git add failed during auto-commit:\n${String(err)}`,
      priority: 2,
      source: `task:${taskId}`,
    });
    return;
  }

  if (!stage.staged) return;

  // Pre-commit syntax check
  if (stage.tsFiles.length > 0) {
    const syntaxErrors = validateSyntax(stage.tsFiles);
    if (syntaxErrors.length > 0) {
      log(`dispatch: syntax check FAILED for ${syntaxErrors.length} file(s):`);
      for (const err of syntaxErrors) log(`  ${err}`);
      await git("reset", "HEAD");
      insertTask({
        subject: `Fix syntax errors from task #${taskId}`,
        description: `Syntax check failed after dispatch:\n${syntaxErrors.join("\n")}`,
        priority: 2,
        source: `task:${taskId}`,
      });
      log("dispatch: created follow-up task for syntax errors");
      return;
    }
  }

  // Commit
  const msg = `chore(loop): auto-commit after dispatch cycle [${stage.files.length} file(s)]`;
  const commit = await commitWithMessage(msg);
  if (!commit.ok) {
    log(`dispatch: auto-commit failed — ${commit.error}`);
    insertTask({
      subject: `Fix commit failure from task #${taskId}`,
      description: `Auto-commit failed during dispatch:\n${commit.error}`,
      priority: 3,
      source: `task:${taskId}`,
    });
    return;
  }
  log(`dispatch: auto-committed ${stage.files.length} file(s)`);

  // Post-commit service health check (only if src/ files changed)
  if (stage.files.some((f) => f.startsWith("src/"))) {
    await revertOnServiceDeath(servicesBefore, taskId);
  }
}
