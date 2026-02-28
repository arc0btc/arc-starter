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
  insertTask,
  markTaskActive,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  updateCycleLog,
  updateTaskCost,
  toSqliteDatetime,
} from "./db.ts";
import { isPidAlive } from "./utils.ts";

// ---- Constants ----

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const SKILLS_DIR = join(ROOT, "skills");

// ---- Logging ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Model routing ----

type ModelTier = "opus" | "sonnet" | "haiku";

interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  cache_read_per_million: number;
  cache_write_per_million: number;
}

const MODEL_PRICING: Record<ModelTier, ModelPricing> = {
  opus: {
    input_per_million: 15,
    output_per_million: 75,
    cache_read_per_million: 1.875,
    cache_write_per_million: 18.75,
  },
  sonnet: {
    input_per_million: 3,
    output_per_million: 15,
    cache_read_per_million: 0.30,
    cache_write_per_million: 3.75,
  },
  haiku: {
    input_per_million: 1,
    output_per_million: 5,
    cache_read_per_million: 0.10,
    cache_write_per_million: 1.25,
  },
};

/**
 * Route tasks to the appropriate model tier based on priority.
 * Priority 1-3 (strategic): Opus — deep reasoning, complex decisions.
 * Priority 4+  (routine):   Haiku — fast, cheap, good enough for standard work.
 */
function selectModel(task: Task): ModelTier {
  if (task.priority <= 3) return "opus";
  return "haiku";
}

// ---- Cost calculation ----

/**
 * Calculate estimated API cost from token counts using model-specific pricing.
 */
function calculateApiCostUsd(
  model: ModelTier,
  input_tokens: number,
  output_tokens: number,
  cache_read_tokens: number = 0,
  cache_creation_tokens: number = 0
): number {
  const p = MODEL_PRICING[model];
  return (
    (input_tokens / 1_000_000) * p.input_per_million +
    (output_tokens / 1_000_000) * p.output_per_million +
    (cache_read_tokens / 1_000_000) * p.cache_read_per_million +
    (cache_creation_tokens / 1_000_000) * p.cache_write_per_million
  );
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
  return skillNames
    .map((name) => {
      const content = readFile(join(SKILLS_DIR, name, "SKILL.md"));
      return content ? `# Skill: ${name}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
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

const MST_OFFSET_MS = 7 * 3600_000;

function buildPrompt(task: Task, skillNames: string[], recentCycles: string): string {
  const now = new Date();
  const utc = toSqliteDatetime(now) + " UTC";
  const mst = toSqliteDatetime(new Date(now.getTime() - MST_OFFSET_MS)) + " MST";

  const soul = readFile(join(ROOT, "SOUL.md"));
  const memory = readFile(join(ROOT, "memory", "MEMORY.md"));
  const skillContext = resolveSkillContext(skillNames);
  const parentChain = buildParentChain(task);

  const parts: string[] = [
    "# Current Time",
    `${utc} / ${mst}`,
    "",
  ];

  // Add optional sections — each guarded by content presence
  const optionalSections: Array<[string, string]> = [
    ["# Identity", soul],
    ["# Memory", memory],
    ["# Recent Cycles", recentCycles],
  ];
  for (const [heading, content] of optionalSections) {
    if (content) {
      parts.push(heading, content, "");
    }
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
    `- Close this task: arc tasks close --id ${task.id} --status completed|failed --summary "summary"`,
    `- Create follow-up: arc tasks add --subject "subject" --skills s1,s2 --parent ${task.id}`,
    `- Create a skill: arc skills run --name manage-skills -- create my-skill --description "Does X"`,
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

async function dispatch(prompt: string, model: ModelTier = "opus"): Promise<DispatchResult> {
  const args = [
    "claude",
    "--print",
    "--verbose",
    "--model",
    model,
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
  let cache_read_tokens = 0;
  let cache_creation_tokens = 0;
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
      const usage = parsed["usage"] as Record<string, unknown> | undefined;

      // Prefer total_cost_usd from result (most accurate — includes tool use overhead)
      const totalCostField = parsed["total_cost_usd"];
      if (typeof totalCostField === "number") {
        cost_usd = totalCostField;
      }

      // Capture token counts (including cache tokens)
      if (usage) {
        input_tokens = (usage.input_tokens as number) || 0;
        output_tokens = (usage.output_tokens as number) || 0;
        cache_read_tokens = (usage.cache_read_input_tokens as number) || 0;
        cache_creation_tokens = (usage.cache_creation_input_tokens as number) || 0;
      }

      // Fallback cost estimate from tokens if total_cost_usd not available
      if (!cost_usd && usage) {
        cost_usd = calculateApiCostUsd(model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens);
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
    // Process all complete lines; keep the last (possibly incomplete) segment
    lineBuffer = lines.pop()!;
    for (const line of lines) {
      processLine(line);
    }
  }
  // Flush any remaining buffer content
  processLine(lineBuffer);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`claude exited ${exitCode}: ${errText.trim()}`);
  }

  // Always calculate api_cost_usd from tokens for dual tracking
  const api_cost_usd = calculateApiCostUsd(model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens);

  // Report total input tokens (non-cached + cache read + cache creation)
  const total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens;

  return { result, cost_usd, api_cost_usd, input_tokens: total_input_tokens, output_tokens };
}

// ---- Auto-commit ----

/** Spawn a git command in the repo root, capturing output. */
async function git(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function commitCycleChanges(): Promise<void> {
  try {
    // Stage specific directories — never .env or db/*.sqlite
    const stageDirs = ["memory/", "skills/", "src/", "templates/"];
    for (const dir of stageDirs) {
      if (existsSync(join(ROOT, dir))) {
        await git("add", dir);
      }
    }

    // Check if there's anything staged
    const { exitCode: diffExit } = await git("diff", "--cached", "--quiet");
    if (diffExit === 0) return; // nothing to commit

    // Count staged files for the commit message
    const { stdout: stagedFiles } = await git("diff", "--cached", "--name-only");
    const fileCount = stagedFiles.trim().split("\n").filter(Boolean).length;

    // Commit with conventional message
    const msg = `chore(loop): auto-commit after dispatch cycle [${fileCount} file(s)]`;
    const { exitCode: commitExit, stderr } = await git("commit", "-m", msg);
    if (commitExit === 0) {
      log(`dispatch: auto-committed ${fileCount} file(s)`);
    } else {
      log(`dispatch: auto-commit failed — ${stderr.trim()}`);
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
  const model = selectModel(task);
  if (skillNames.length > 0) {
    log(`dispatch: loading skills: ${skillNames.join(", ")}`);
  }
  log(`dispatch: model=${model} (priority ${task.priority})`);

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
      await dispatch(prompt, model);

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
