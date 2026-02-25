/**
 * Dispatch engine — picks the highest-priority pending task, builds a prompt,
 * calls claude via stream-JSON, and records results.
 *
 * Lock-gated: only one dispatch runs at a time. The lock file lives at
 * db/dispatch-lock.json and includes the PID + task_id for crash recovery.
 *
 * Invoked by `arc run` (cli.ts) or directly as a standalone entry point.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Task,
  getActiveTasks,
  getPendingTasks,
  getRecentCycles,
  getTaskById,
  initDatabase,
  insertCycleLog,
  markTaskActive,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  updateCycleLog,
  updateTaskCost,
  toSqliteDatetime,
} from "./db.ts";

// ---- Constants ----

const ROOT = new URL("..", import.meta.url).pathname;
const DB_DIR = join(ROOT, "db");
const DISPATCH_LOCK_FILE = join(DB_DIR, "dispatch-lock.json");
const SKILLS_DIR = join(ROOT, "skills");

// ---- Logging ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Cost calculation ----

/**
 * Calculate estimated API cost from token counts.
 * Opus pricing: $15/1M input tokens, $75/1M output tokens.
 */
function calculateApiCostUsd(input_tokens: number, output_tokens: number): number {
  return (input_tokens / 1_000_000) * 15 + (output_tokens / 1_000_000) * 75;
}

// ---- Dispatch lock ----

interface DispatchLock {
  pid: number;
  task_id: number | null;
  started_at: string;
}

function checkDispatchLock(): DispatchLock | null {
  if (!existsSync(DISPATCH_LOCK_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DISPATCH_LOCK_FILE, "utf-8")) as DispatchLock;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeDispatchLock(task_id: number | null): void {
  const lock: DispatchLock = {
    pid: process.pid,
    task_id,
    started_at: new Date().toISOString(),
  };
  writeFileSync(DISPATCH_LOCK_FILE, JSON.stringify(lock, null, 2));
}

function clearDispatchLock(): void {
  try {
    unlinkSync(DISPATCH_LOCK_FILE);
  } catch {
    // file may not exist — that's fine
  }
}

// ---- File helpers ----

function readFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ---- Skill context resolver ----

function parseSkillNames(skillsJson: string | null): string[] {
  if (!skillsJson) return [];
  try {
    return JSON.parse(skillsJson) as string[];
  } catch {
    return [];
  }
}

function resolveSkillContext(skillNames: string[]): string {
  const blocks: string[] = [];
  for (const name of skillNames) {
    const skillMdPath = join(SKILLS_DIR, name, "SKILL.md");
    const content = readFile(skillMdPath);
    if (content) {
      blocks.push(`# Skill: ${name}\n${content}`);
    }
  }
  return blocks.join("\n\n");
}

// ---- Parent chain builder ----

/**
 * Walk up the parent_id chain and return a formatted string of ancestor tasks.
 */
function buildParentChain(task: Task): string {
  const chain: string[] = [];
  let current: Task | null = task.parent_id ? getTaskById(task.parent_id) : null;

  while (current !== null) {
    chain.push(`  #${current.id}: ${current.subject} (${current.status})`);
    current = current.parent_id ? getTaskById(current.parent_id) : null;
    // Safety: cap chain depth to avoid infinite loops
    if (chain.length >= 10) break;
  }

  return chain.length > 0 ? "Parent chain:\n" + chain.join("\n") : "";
}

// ---- Prompt builder ----

function buildPrompt(task: Task, skillNames: string[], recentCycles: string): string {
  const now = new Date();
  const utc = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const mst = new Date(now.getTime() - 7 * 3600_000).toISOString().replace("T", " ").slice(0, 19) + " MST";

  const soul = readFile(join(ROOT, "SOUL.md"));
  const memory = readFile(join(ROOT, "memory", "MEMORY.md"));
  const skillContext = resolveSkillContext(skillNames);
  const parentChain = buildParentChain(task);

  const parts: string[] = [
    "# Current Time",
    `${utc} / ${mst}`,
    "",
  ];

  if (soul) {
    parts.push("# Identity", soul, "");
  }

  if (memory) {
    parts.push("# Memory", memory, "");
  }

  if (recentCycles) {
    parts.push("# Recent Cycles", recentCycles, "");
  }

  if (skillContext) {
    parts.push(skillContext, "");
  }

  // Task details
  const taskLines = [
    "# Task to Execute",
    `Subject: ${task.subject}`,
    `Description: ${task.description ?? "(none)"}`,
    `Priority: ${task.priority}`,
    `Source: ${task.source ?? "(none)"}`,
    `Task ID: ${task.id}`,
  ];
  if (parentChain) {
    taskLines.push(parentChain);
  }
  parts.push(taskLines.join("\n"), "");

  // CLI enforcement instructions
  parts.push(
    "# Instructions",
    "Use `arc` CLI commands for all actions:",
    `- Close this task: arc tasks close ${task.id} completed|failed "summary"`,
    `- Create follow-up: arc tasks add "subject" --skills s1,s2 --parent ${task.id}`,
    "- Create a skill: arc skills run manage-skills create <name>",
    "- Update memory: edit memory/MEMORY.md directly",
    "Do NOT use raw SQL, direct DB writes, or ad-hoc scripts.",
  );

  return parts.join("\n");
}

// ---- Stream-JSON dispatch ----

interface DispatchResult {
  result: string;
  cost_usd: number;
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

async function dispatch(prompt: string): Promise<DispatchResult> {
  const args = [
    "claude",
    "--print",
    "--verbose",
    "--model",
    "opus",
    "--output-format",
    "stream-json",
    "--no-session-persistence",
  ];

  // Allow full permissions when DANGEROUS=true env var is set
  if (Bun.env.DANGEROUS === "true") {
    args.push("--dangerously-skip-permissions");
  }

  const proc = Bun.spawn(args, {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
  });

  let result = "";
  let cost_usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  const decoder = new TextDecoder();
  let lineBuffer = "";

  function processLine(line: string): void {
    if (!line.trim()) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // skip malformed lines
    }

    // Accumulate text deltas from stream events (native Anthropic API)
    if (parsed["type"] === "stream_event") {
      const event = parsed["event"] as Record<string, unknown> | undefined;
      if (event?.["type"] === "content_block_delta") {
        const delta = event["delta"] as Record<string, unknown> | undefined;
        if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
          result += delta["text"];
        }
      }
    }

    // Accumulate text from assistant messages (OpenRouter fallback — returns message blocks)
    if (parsed["type"] === "assistant") {
      const message = parsed["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"] as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block["type"] === "text" && typeof block["text"] === "string") {
            result += block["text"];
          }
        }
      }
    }

    // Extract cost and tokens from the final result message
    if (parsed["type"] === "result") {
      const usage = parsed["usage"] as
        | { input_tokens: number; output_tokens: number }
        | undefined;

      // Prefer total_cost_usd from result (most accurate — includes tool use overhead)
      const totalCostField = parsed["total_cost_usd"];
      if (typeof totalCostField === "number") {
        cost_usd = totalCostField;
      } else if (usage) {
        cost_usd = calculateApiCostUsd(usage.input_tokens || 0, usage.output_tokens || 0);
      }

      // Capture token counts
      if (usage) {
        input_tokens = usage.input_tokens || 0;
        output_tokens = usage.output_tokens || 0;
      }

      // If text delta accumulation produced nothing, fall back to result field
      if (!result && typeof parsed["result"] === "string") {
        result = parsed["result"];
      }
    }
  }

  for await (const chunk of proc.stdout) {
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split("\n");
    // All lines except the last are complete
    for (let i = 0; i < lines.length - 1; i++) {
      processLine(lines[i]);
    }
    lineBuffer = lines[lines.length - 1];
  }
  // Flush any remaining buffer content
  processLine(lineBuffer);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`claude exited ${exitCode}: ${errText.trim()}`);
  }

  // Always calculate api_cost_usd from tokens for dual tracking
  const api_cost_usd = calculateApiCostUsd(input_tokens, output_tokens);

  return { result, cost_usd, api_cost_usd, input_tokens, output_tokens };
}

// ---- Auto-commit ----

async function commitCycleChanges(): Promise<void> {
  try {
    // Stage specific directories — never .env or db/*.sqlite
    const stageDirs = ["memory/", "skills/", "src/", "templates/"];
    for (const dir of stageDirs) {
      if (existsSync(join(ROOT, dir))) {
        const addProc = Bun.spawn(["git", "add", dir], {
          cwd: ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });
        await addProc.exited;
      }
    }

    // Check if there's anything staged
    const diffProc = Bun.spawn(["git", "diff", "--cached", "--quiet"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const diffExit = await diffProc.exited;
    if (diffExit === 0) return; // nothing to commit

    // Count staged files for the commit message
    const statProc = Bun.spawn(["git", "diff", "--cached", "--name-only"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const statOut = await new Response(statProc.stdout).text();
    const fileCount = statOut.trim().split("\n").filter(Boolean).length;

    // Commit with conventional message
    const msg = `chore(loop): auto-commit after dispatch cycle [${fileCount} file(s)]`;
    const commitProc = Bun.spawn(["git", "commit", "-m", msg], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const commitExit = await commitProc.exited;
    if (commitExit === 0) {
      log(`dispatch: auto-committed ${fileCount} file(s)`);
    } else {
      const errText = await new Response(commitProc.stderr).text();
      log(`dispatch: auto-commit failed — ${errText.trim()}`);
    }
  } catch (err) {
    log(`dispatch: auto-commit error — ${err}`);
  }
}

// ---- Main entry point ----

/**
 * Run a single dispatch cycle:
 * 1. Lock check (exit if another dispatch is running)
 * 2. Crash recovery (mark stale active tasks failed)
 * 3. Pick highest-priority pending task
 * 4. Build prompt (SOUL.md + MEMORY.md + skill context + task details)
 * 5. Mark task active + write lock
 * 6. Spawn claude with stream-JSON output
 * 7. Parse result, track cost
 * 8. Close task (if LLM didn't self-close) + record cycle
 * 9. Clear lock + auto-commit
 */
export async function runDispatch(): Promise<void> {
  // 1. Lock check
  const lock = checkDispatchLock();
  if (lock && isPidAlive(lock.pid)) {
    log(
      `dispatch: in progress (pid=${lock.pid}, task=${lock.task_id}, started=${lock.started_at}) — exiting`
    );
    return;
  }
  if (lock) {
    log(`dispatch: clearing stale dispatch lock (pid=${lock.pid} is dead)`);
    clearDispatchLock();
  }

  // 2. Crash recovery — mark any stale active tasks as failed
  const activeTasks = getActiveTasks();
  for (const task of activeTasks) {
    log(
      `dispatch: stale active task #${task.id} "${task.subject}" — marking failed (crash recovery)`
    );
    markTaskFailed(task.id, "Task was left active from a previous cycle (crash recovery)");
  }

  // 3. Pick highest-priority pending task (getPendingTasks orders by priority ASC, id ASC)
  const pendingTasks = getPendingTasks();
  if (pendingTasks.length === 0) {
    log("dispatch: No pending tasks. Idle.");
    return;
  }
  const task = pendingTasks[0];
  log(
    `dispatch: selected task #${task.id} "${task.subject}" (priority ${task.priority})`
  );

  // 4. Build context for prompt
  const skillNames = parseSkillNames(task.skills);
  if (skillNames.length > 0) {
    log(`dispatch: loading skills: ${skillNames.join(", ")}`);
  }

  const recentCycles = getRecentCycles(10)
    .map(
      (c) =>
        `${c.started_at} task=${c.task_id ?? "none"} duration=${c.duration_ms ?? "?"}ms cost=$${(c.cost_usd || 0).toFixed(6)}`
    )
    .join("\n");

  const prompt = buildPrompt(task, skillNames, recentCycles);

  // 5. Mark task active and write lock
  markTaskActive(task.id);
  writeDispatchLock(task.id);

  log(`dispatch: dispatching for task #${task.id} — "${task.subject}"`);

  // 6. Record cycle start
  const cycleStartedAt = toSqliteDatetime(new Date());
  const cycleId = insertCycleLog({
    started_at: cycleStartedAt,
    task_id: task.id,
    skills_loaded: skillNames.length > 0 ? JSON.stringify(skillNames) : null,
  });

  const dispatchStart = Date.now();
  let cycleUpdated = false;

  try {
    // 7. Run dispatch (LLM call)
    const { result, cost_usd, api_cost_usd, input_tokens, output_tokens } =
      await dispatch(prompt);

    log(
      `dispatch: task #${task.id} returned — cost_usd=$${cost_usd.toFixed(6)} api_cost=$${api_cost_usd.toFixed(6)} tokens=${input_tokens}in/${output_tokens}out`
    );

    // 8a. Check if LLM self-closed the task via arc tasks close
    const postStatus = getTaskById(task.id);
    if (postStatus && postStatus.status !== "active") {
      log(
        `dispatch: task #${task.id} was closed by LLM (status=${postStatus.status})`
      );
    } else {
      // 8b. Fallback: LLM did not call arc tasks close — loop closes it
      log(
        `dispatch: task #${task.id} still active after dispatch — fallback close as completed`
      );
      const summary = result.slice(0, 500) || "Completed — no output";
      markTaskCompleted(task.id, summary, result || undefined);
    }
    updateTaskCost(task.id, cost_usd, api_cost_usd, input_tokens, output_tokens);

    // Update cycle log with cost/token data
    const duration_ms = Date.now() - dispatchStart;
    updateCycleLog(cycleId, {
      completed_at: toSqliteDatetime(new Date()),
      duration_ms,
      cost_usd,
      api_cost_usd,
      tokens_in: input_tokens,
      tokens_out: output_tokens,
    });
    cycleUpdated = true;
  } catch (err) {
    const errMsg = String(err);

    // Detect auth errors — never retry 401/403
    const isAuthError = errMsg.includes("401") || errMsg.includes("403");

    const attemptNumber = task.attempt_count + 1;
    if (!isAuthError && attemptNumber < task.max_retries) {
      requeueTask(task.id);
      log(
        `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}) — requeuing for retry: ${errMsg}`
      );
    } else {
      const reason = isAuthError
        ? `Auth error (not retried): ${errMsg.slice(0, 400)}`
        : `Max retries exhausted: ${errMsg.slice(0, 400)}`;
      markTaskFailed(task.id, reason);
      log(
        `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}) — ${isAuthError ? "auth error, not retrying" : "max retries exhausted"}`
      );
    }

    if (!cycleUpdated) {
      updateCycleLog(cycleId, {
        completed_at: toSqliteDatetime(new Date()),
        duration_ms: Date.now() - dispatchStart,
      });
    }
  } finally {
    // 9. Clear lock regardless of outcome
    clearDispatchLock();
  }

  // Auto-commit any changes made during dispatch
  await commitCycleChanges();
}

// ---- Standalone entry point ----

if (import.meta.main) {
  const criticalFiles = ["SOUL.md", "CLAUDE.md"];
  for (const file of criticalFiles) {
    if (!existsSync(join(ROOT, file))) {
      console.error(`[${new Date().toISOString()}] dispatch: preflight failed — missing ${file}`);
      process.exit(1);
    }
  }
  initDatabase();
  runDispatch()
    .then(() => log("dispatch: complete"))
    .catch((err) => {
      console.error(`[${new Date().toISOString()}] dispatch: fatal — ${err}`);
      process.exit(1);
    });
}
