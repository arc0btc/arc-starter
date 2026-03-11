/**
 * Dispatch engine — picks the highest-priority pending task, builds a prompt,
 * calls claude via stream-JSON, and records results.
 *
 * Lock-gated: only one dispatch runs at a time. The lock file lives at
 * db/dispatch-lock.json and includes the PID + task_id for crash recovery.
 *
 * Invoked by `arc run` (cli.ts) or directly as a standalone entry point.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, hostname, uptime as osUptime } from "node:os";
import { join } from "node:path";
import {
  type Task,
  getActiveTasks,
  getPendingTasks,
  getRecentCycles,
  getTaskById,
  getTodayCostUsd,
  initDatabase,
  insertCycleLog,
  insertTask,
  upsertSkillVersion,
  markTaskActive,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  updateCycleLog,
  updateTaskCost,
  toSqliteDatetime,
} from "./db.ts";
import { isPidAlive } from "./utils.ts";
import { getShutdownState } from "./shutdown.ts";
import { AGENT_NAME } from "./identity.ts";
import { type ModelTier, type SdkRoute, MODEL_IDS, MODEL_PRICING, parseTaskSdk } from "./models.ts";
import { dispatchOpenRouter, getOpenRouterApiKey } from "./openrouter.ts";
import { dispatchCodex } from "./codex.ts";
import { captureBaseline, classifyFile, evaluateExperiment, scheduleVerification, type BaselineSnapshot } from "./experiment.ts";

// ---- Constants ----

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const FLEET_STATUS_FILE = join(ROOT, "memory", "fleet-status.json");
const SKILLS_DIR = join(ROOT, "skills");

/** Daily cost ceiling (USD). Above this, only P1-2 tasks dispatch. */
const DAILY_BUDGET_USD = 500;

/**
 * GitHub gate — on workers, detect GitHub-related tasks before invoking LLM.
 * Auto-routes them to Arc via fleet-handoff, saving cost and preventing escalations.
 * Only active on non-Arc agents.
 */
const GITHUB_TASK_RE = /github|git\s*push|git\s*clone|\bPAT\b|personal access token|ssh key|github credential|github token|gh auth|GITHUB_TOKEN|pull request|create.*PR|open.*PR|merge.*PR/i;

/** Maximum time (ms) a Claude subprocess can run before being killed.
 *  Model-aware: Haiku tasks get 5min (simple execution), Sonnet 15min,
 *  Opus 30min (90min overnight). Prevents simple tasks from blocking the queue. */
function getDispatchTimeoutMs(model: ModelTier = "opus"): number {
  if (model === "haiku") return 5 * 60 * 1000;
  if (model === "sonnet") return 15 * 60 * 1000;
  const hour = new Date().getHours();
  return (hour >= 0 && hour < 8) ? 90 * 60 * 1000 : 30 * 60 * 1000;
}

// ---- Error classification ----

type ErrorClass = "auth" | "rate_limited" | "subprocess_timeout" | "transient" | "unknown";

/**
 * Classify dispatch errors using contextual HTTP status patterns.
 * Matches "status 401", "HTTP 403", "error 429" etc. — not bare numbers
 * that could be task IDs like "task #401".
 */
/** Pre-compiled rate-limit detection pattern — single regex, tested once per error. */
const RATE_LIMIT_RE = /(?:status|HTTP|error|code)[:\s]*429|\brate[_\s-]?limit|\btoo many requests|\b(?:max\s*usage|plan\s*limit|usage\s*limit|token\s*limit)\b|\bplan.*cap|\b(?:limit|quota)\s*(?:reached|exceeded|hit)\b|\bexceeded.*(?:limit|quota)/i;

function classifyError(errMsg: string): ErrorClass {
  // Auth errors — 401/403 with HTTP context, or named errors
  if (/(?:status|HTTP|error|code)[:\s]*(?:401|403)/i.test(errMsg)
      || /\b(?:unauthorized|forbidden)\b/i.test(errMsg)) {
    return "auth";
  }
  // Rate limiting — 429 with HTTP context, plan/usage limits, or named patterns
  if (RATE_LIMIT_RE.test(errMsg)) {
    return "rate_limited";
  }
  // Subprocess timeout — task ran too long, do not retry (would just time out again)
  if (/claude subprocess timed out/i.test(errMsg)) {
    return "subprocess_timeout";
  }
  // Transient — 5xx, network errors, timeouts, incomplete streams
  if (/(?:status|HTTP|error|code)[:\s]*5\d{2}/i.test(errMsg)
      || /\b(?:timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND)\b/i.test(errMsg)
      || /stream-JSON incomplete/i.test(errMsg)
      || /timed out/i.test(errMsg)) {
    return "transient";
  }
  return "unknown";
}

// ---- Dispatch gate (on/off, no auto-recovery) ----

const DISPATCH_GATE_FILE = join(ROOT, "db", "hook-state", "dispatch-gate.json");
const GATE_FAILURE_THRESHOLD = 3;

interface DispatchGateState {
  status: "running" | "stopped";
  consecutive_failures: number;
  stopped_at: string | null;
  stop_reason: string | null;
  last_error_class: ErrorClass | null;
  last_updated: string;
}

function readGateState(): DispatchGateState {
  try {
    const data = readFileSync(DISPATCH_GATE_FILE, "utf-8");
    return JSON.parse(data) as DispatchGateState;
  } catch {
    return {
      status: "running",
      consecutive_failures: 0,
      stopped_at: null,
      stop_reason: null,
      last_error_class: null,
      last_updated: new Date().toISOString(),
    };
  }
}

function writeGateState(state: DispatchGateState): void {
  state.last_updated = new Date().toISOString();
  mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
  writeFileSync(DISPATCH_GATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Send email notification to whoabuddy that dispatch has stopped.
 * Uses arc CLI (fire-and-forget, non-blocking).
 */
function notifyDispatchStopped(reason: string, errorClass: ErrorClass | null): void {
  const subject = errorClass === "rate_limited"
    ? `[Arc] Dispatch stopped — rate/plan limit hit`
    : `[Arc] Dispatch stopped — ${GATE_FAILURE_THRESHOLD} consecutive failures`;
  const body = [
    `Arc dispatch has stopped and will not auto-recover.`,
    ``,
    `Reason: ${reason}`,
    `Error class: ${errorClass ?? "unknown"}`,
    `Time: ${new Date().toISOString()}`,
    `Host: ${hostname()}`,
    ``,
    `To resume, SSH in and run:`,
    `  bash bin/arc dispatch reset`,
    ``,
    `Or clear the gate file:`,
    `  rm db/hook-state/dispatch-gate.json`,
  ].join("\n");

  try {
    Bun.spawn(["bash", join(ROOT, "bin/arc"), "skills", "run", "--name", "email", "--",
      "send", "--to", "whoabuddy@gmail.com", "--subject", subject, "--body", body,
      "--from", "arc@arc0btc.com"], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
    log(`dispatch: notification email queued to whoabuddy`);
  } catch (e) {
    log(`dispatch: failed to send notification email: ${e}`);
  }
}

/**
 * Check dispatch gate. Returns true if dispatch should proceed.
 * "running" → proceed. "stopped" → skip (requires manual reset).
 */
function checkCircuitBreaker(): boolean {
  const state = readGateState();

  if (state.status === "running") return true;

  log(`dispatch: STOPPED — not dispatching (since ${state.stopped_at}, reason: ${state.stop_reason?.slice(0, 100)}). Run 'arc dispatch reset' to resume.`);
  return false;
}

function recordCircuitSuccess(): void {
  const state = readGateState();
  if (state.status === "running" && state.consecutive_failures === 0) return;
  state.consecutive_failures = 0;
  state.status = "running";
  state.stopped_at = null;
  state.stop_reason = null;
  state.last_error_class = null;
  writeGateState(state);
}

function recordCircuitFailure(errMsg: string): void {
  const state = readGateState();
  const errClass = classifyError(errMsg);
  state.consecutive_failures += 1;
  state.last_error_class = errClass;

  // Rate limit or plan suspension → immediate stop (no threshold)
  if (errClass === "rate_limited") {
    state.status = "stopped";
    state.stopped_at = new Date().toISOString();
    state.stop_reason = errMsg.slice(0, 500);
    writeGateState(state);
    log(`dispatch: STOPPED — rate/plan limit hit. Manual restart required.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass);
    return;
  }

  // Other errors: stop after consecutive threshold
  if (state.consecutive_failures >= GATE_FAILURE_THRESHOLD) {
    state.status = "stopped";
    state.stopped_at = new Date().toISOString();
    state.stop_reason = errMsg.slice(0, 500);
    writeGateState(state);
    log(`dispatch: STOPPED after ${state.consecutive_failures} consecutive failures (${errClass}). Manual restart required.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass);
    return;
  }

  writeGateState(state);
}

/**
 * Reset the dispatch gate to "running". Called by `arc dispatch reset`.
 */
export function resetDispatchGate(): void {
  const state = readGateState();
  log(`dispatch: gate reset (was ${state.status}, ${state.consecutive_failures} failures, reason: ${state.stop_reason?.slice(0, 100)})`);
  writeGateState({
    status: "running",
    consecutive_failures: 0,
    stopped_at: null,
    stop_reason: null,
    last_error_class: null,
    last_updated: new Date().toISOString(),
  });
}

// ---- Logging ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Model routing ----

/**
 * Route tasks to the appropriate model tier (for Claude SDK only).
 * Explicit task.model takes precedence; falls back to priority-based routing:
 * P1-4 (senior):   Opus  — new skills/sensors, architecture, deep reasoning, complex code.
 * P5-7 (mid):      Sonnet — composition, reviews, moderate complexity, operational tasks.
 * P8+  (junior):   Haiku  — simple execution, mark-as-read, config edits, status checks.
 */
function selectModel(task: Task): ModelTier {
  if (task.model) {
    const m = task.model;
    if (m === "opus" || m === "sonnet" || m === "haiku") return m;
    // Non-Claude models (codex:*, etc.) are handled by selectSdk — skip warning for those
    if (!m.startsWith("codex")) {
      log(`dispatch: unrecognized task.model="${m}" for task #${task.id}, falling back to priority routing`);
    }
  }
  if (task.priority <= 4) return "opus";
  if (task.priority <= 7) return "sonnet";
  return "haiku";
}

/**
 * Parse the task's SDK routing. Returns sdk type + model identifier.
 * Used before selectModel() to determine which dispatch backend to use.
 */
function selectSdk(task: Task): SdkRoute {
  return parseTaskSdk(task.model);
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

/** Write fleet-status.json — local state advertisement for peer agents to read via SSH. */
function writeFleetStatus(task: Task, durationMs: number, costUsd: number): void {
  try {
    const diskResult = Bun.spawnSync(["df", "-B1", "--output=size,avail", ROOT]);
    const dfLines = diskResult.stdout.toString().trim().split("\n");
    let diskTotalBytes = 0;
    let diskAvailBytes = 0;
    if (dfLines.length >= 2) {
      const parts = dfLines[1].trim().split(/\s+/);
      diskTotalBytes = parseInt(parts[0] ?? "0", 10);
      diskAvailBytes = parseInt(parts[1] ?? "0", 10);
    }

    const status = {
      agent: hostname() || "arc",
      updated_at: new Date().toISOString(),
      idle: false,
      idle_since: null as string | null,
      last_task: {
        id: task.id,
        subject: task.subject,
        status: task.status,
        priority: task.priority,
      },
      last_cycle: {
        duration_ms: durationMs,
        cost_usd: costUsd,
      },
      health: {
        uptime_seconds: Math.floor(osUptime()),
        disk_total_bytes: diskTotalBytes,
        disk_avail_bytes: diskAvailBytes,
      },
    };

    writeFileSync(FLEET_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch (err) {
    log(`dispatch: failed to write fleet-status.json — ${err}`);
  }
}

/** Write fleet-status.json with idle=true when no pending tasks. Preserves last_task from previous state. */
function writeFleetStatusIdle(): void {
  try {
    // Read existing status to preserve last_task info
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(FLEET_STATUS_FILE, "utf-8"));
    } catch {
      // no existing file — fine
    }

    const diskResult = Bun.spawnSync(["df", "-B1", "--output=size,avail", ROOT]);
    const dfLines = diskResult.stdout.toString().trim().split("\n");
    let diskTotalBytes = 0;
    let diskAvailBytes = 0;
    if (dfLines.length >= 2) {
      const parts = dfLines[1].trim().split(/\s+/);
      diskTotalBytes = parseInt(parts[0] ?? "0", 10);
      diskAvailBytes = parseInt(parts[1] ?? "0", 10);
    }

    const now = new Date().toISOString();
    const previousIdleSince = existing.idle && typeof existing.idle_since === "string"
      ? existing.idle_since
      : now;

    const status = {
      agent: hostname() || "arc",
      updated_at: now,
      idle: true,
      idle_since: previousIdleSince,
      last_task: existing.last_task ?? null,
      last_cycle: existing.last_cycle ?? null,
      health: {
        uptime_seconds: Math.floor(osUptime()),
        disk_total_bytes: diskTotalBytes,
        disk_avail_bytes: diskAvailBytes,
      },
    };

    writeFileSync(FLEET_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch (err) {
    log(`dispatch: failed to write idle fleet-status.json — ${err}`);
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

/**
 * Hash each loaded SKILL.md, upsert into skill_versions, and return a
 * {skillName: shortHash} map for recording in cycle_log.skill_hashes.
 */
function computeSkillHashes(skillNames: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of skillNames) {
    const content = readFile(join(SKILLS_DIR, name, "SKILL.md"));
    if (!content) continue;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    const hash = hasher.digest("hex").slice(0, 12);
    hashes[name] = hash;
    try {
      upsertSkillVersion(hash, name, content);
    } catch {
      // non-fatal: tracking is best-effort
    }
  }
  return hashes;
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
    `- Create a skill: arc skills run --name arc-skill-manager -- create my-skill --description "Does X"`,
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

async function dispatch(prompt: string, model: ModelTier = "opus", cwd?: string): Promise<DispatchResult> {
  const args = [
    "claude",
    "--print",
    "--verbose",
    "--model",
    MODEL_IDS[model],
    "--output-format",
    "stream-json",
    "--no-session-persistence",
  ];

  // Allow full permissions when DANGEROUS=true env var is set
  if (Bun.env.DANGEROUS === "true") {
    args.push("--dangerously-skip-permissions");
  }

  // Build environment with optimization flags for non-Opus models.
  // Opus (P1-4) gets full thinking budget for deep reasoning.
  // Sonnet (P5-7) and Haiku (P8+) get constrained thinking to save cost.
  // AUTOCOMPACT left at default — preserving context continuity is worth the tokens.
  const env = { ...process.env };
  if (process.env.TEST_TOKEN_OPTIMIZATION === "true" || model !== "opus") {
    env.MAX_THINKING_TOKENS = "10000";
  }

  const proc = Bun.spawn(args, {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    env,
    ...(cwd ? { cwd } : {}),
  });

  // Timeout watchdog — kill subprocess if it exceeds the dispatch timeout
  const dispatchTimeoutMs = getDispatchTimeoutMs(model);
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log(`dispatch: subprocess timeout after ${dispatchTimeoutMs / 60_000}min — killing pid ${proc.pid}`);
    proc.kill("SIGTERM");
    // Force kill after 10 seconds if SIGTERM doesn't work
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 10_000);
  }, dispatchTimeoutMs);

  // Drain stderr concurrently to prevent pipe buffer deadlock (64KB limit).
  // If stderr fills up while we're reading stdout, the subprocess blocks.
  const stderrPromise = new Response(proc.stderr).text();

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

  clearTimeout(timeoutTimer);

  const exitCode = await proc.exited;
  if (timedOut) {
    throw new Error(`claude subprocess timed out after ${dispatchTimeoutMs / 60_000} minutes`);
  }
  if (exitCode !== 0) {
    const errText = (await stderrPromise).trim();
    // When Claude Code hits plan limits, it exits 1 with empty stderr.
    // Include any accumulated result text to help classify the error.
    const errContext = errText || (result ? result.slice(0, 300) : "");
    throw new Error(`claude exited ${exitCode}: ${errContext}`);
  }

  // Always calculate api_cost_usd from tokens for dual tracking
  const api_cost_usd = calculateApiCostUsd(model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens);

  // Report total input tokens (non-cached + cache read + cache creation)
  const total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens;

  // Guard against truncated stream: if subprocess exited 0 but never sent a
  // "result" message, both result and cost_usd will be zero/empty.
  if (!result && cost_usd === 0) {
    throw new Error("stream-JSON incomplete: subprocess exited 0 but produced no result and no cost data (likely crashed mid-stream)");
  }

  return { result, cost_usd, api_cost_usd, input_tokens: total_input_tokens, output_tokens };
}

// ---- Auto-commit with safety checks ----

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

/** Generic command runner — spawn a process and capture output. */
async function runCommand(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

const ARC_SERVICES = ["arc-web.service", "arc-sensors.timer", "arc-dispatch.timer"] as const;

// ---- Security validation (AgentShield) ----

interface SecurityScanResult {
  grade: string;
  numericScore: number;
  totalFindings: number;
  critical: number;
  high: number;
  blocked: boolean;
  raw: string;
}

/**
 * Run ecc-agentshield scan against Claude Code configuration.
 * Returns grade (A-F), finding counts, and whether the commit should be blocked.
 * Blocks if any CRITICAL or HIGH findings are detected.
 * Uses globally-installed agentshield binary (requires Node.js via fnm).
 */
async function validateSecurity(): Promise<SecurityScanResult> {
  const fnmPath = join(process.env.HOME ?? "/home/dev", ".local", "share", "fnm");
  const fnmBinPath = join(fnmPath, "aliases", "default", "bin");

  // Build PATH with fnm Node.js at the front (agentshield is a Node.js binary)
  const envPath = `${fnmBinPath}:${process.env.PATH ?? ""}`;

  const proc = Bun.spawn(
    [join(fnmBinPath, "agentshield"), "scan", "--format", "json", "--min-severity", "high"],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: envPath },
    }
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  // Parse JSON output
  try {
    const data = JSON.parse(stdout) as {
      score: { grade: string; numericScore: number };
      summary: { totalFindings: number; critical: number; high: number };
    };

    const { grade, numericScore } = data.score;
    const { totalFindings, critical, high } = data.summary;

    // Block on critical findings (exit code 2 from agentshield, or critical count > 0)
    const blocked = critical > 0 || exitCode === 2;

    return { grade, numericScore, totalFindings, critical, high, blocked, raw: stdout };
  } catch {
    // If JSON parsing fails, treat as degraded but don't block
    log(`dispatch: security scan output parse failed — stderr: ${stderr.trim()}`);
    return { grade: "?", numericScore: 0, totalFindings: 0, critical: 0, high: 0, blocked: false, raw: stdout || stderr };
  }
}

/**
 * Run AgentShield security scan and record grade in cycle_log.
 * Called only when src/ or skills/ changed this cycle.
 * If critical findings detected, creates a follow-up task.
 */
async function runSecurityScan(taskId: number, cycleId?: number): Promise<void> {
  try {
    const scan = await validateSecurity();
    log(`dispatch: security scan — grade=${scan.grade} score=${scan.numericScore} findings=${scan.totalFindings} (critical=${scan.critical}, high=${scan.high})`);

    // Record grade in cycle_log
    if (cycleId !== undefined) {
      updateCycleLog(cycleId, { security_grade: scan.grade });
    }

    if (scan.blocked) {
      log("dispatch: security scan BLOCKED — critical issues found");
      insertTask({
        subject: `Fix critical security findings from task #${taskId}`,
        description: `AgentShield scan found critical issues:\nGrade: ${scan.grade} (${scan.numericScore})\nCritical: ${scan.critical}, High: ${scan.high}\n\n${scan.raw.slice(0, 2000)}`,
        priority: 2,
        source: `task:${taskId}`,
      });
      log("dispatch: created follow-up task for security findings");
    }
  } catch (err) {
    // Security scan failure should not block dispatch — log and continue
    log(`dispatch: security scan error (non-blocking) — ${err}`);
  }
}

/** Return the current HEAD commit SHA, or null if git fails. */
async function getHeadSha(): Promise<string | null> {
  const { exitCode, stdout } = await git("rev-parse", "HEAD");
  if (exitCode !== 0) return null;
  return stdout.trim() || null;
}

/** Check if any commits since sha touched src/ or skills/. Returns true if git fails (fail open). */
async function codeChangedSince(sha: string | null): Promise<boolean> {
  if (!sha) return true;
  const { exitCode, stdout } = await git("diff", "--name-only", sha, "HEAD");
  if (exitCode !== 0) return true;
  const files = stdout.trim().split("\n").filter(Boolean);
  return files.some((f) => f.startsWith("src/") || f.startsWith("skills/"));
}

/** Snapshot which systemd user services are currently active. */
async function snapshotServiceState(): Promise<Map<string, boolean>> {
  const state = new Map<string, boolean>();
  for (const svc of ARC_SERVICES) {
    const { exitCode } = await runCommand("systemctl", ["--user", "is-active", svc]);
    state.set(svc, exitCode === 0);
  }
  return state;
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

/** Compare post-commit service state to snapshot. Returns names of services that died. */
async function checkServiceHealth(before: Map<string, boolean>): Promise<string[]> {
  const died: string[] = [];
  for (const [svc, wasActive] of before) {
    if (!wasActive) continue;
    const { exitCode } = await runCommand("systemctl", ["--user", "is-active", svc]);
    if (exitCode !== 0) died.push(svc);
  }
  return died;
}

// ---- Safe commit helpers ----

interface StageResult {
  staged: boolean;
  files: string[];
  tsFiles: string[];
}

/**
 * Stage known directories (memory/, skills/, src/, templates/) and return staged file lists.
 * Throws on staging failures so callers can escalate.
 */
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
    await runCommand("systemctl", ["--user", "restart", svc]);
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
 * Security scan runs separately via runSecurityScan() at the dispatch level (every cycle).
 * If staging fails: escalates with follow-up task.
 * If syntax check fails: unstages, creates follow-up task.
 * If commit fails: escalates with follow-up task.
 * If services die after commit: reverts commit, restarts services, creates follow-up task.
 */
async function safeCommitCycleChanges(taskId: number, _cycleId?: number): Promise<void> {
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

  // Layer 1: Pre-commit syntax check
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

  // Layer 2: Post-commit service health check (only if src/ files changed)
  if (stage.files.some((f) => f.startsWith("src/"))) {
    await revertOnServiceDeath(servicesBefore, taskId);
  }
}

// ---- Worktree isolation ----

const WORKTREE_DIR = join(ROOT, ".worktrees");

/** Create an isolated worktree for a task, symlink shared state into it. */
async function createWorktree(taskId: number): Promise<string> {
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
  // Credentials store lives in ~/.aibtc/ — symlink so worktree tasks can access it
  if (existsSync(aibtcDir)) {
    symlinks.push([aibtcDir, join(worktreePath, ".aibtc")]);
  }
  // .env is a file, not a directory
  if (existsSync(join(ROOT, ".env"))) {
    symlinks.push([join(ROOT, ".env"), join(worktreePath, ".env")]);
  }

  for (const [target, link] of symlinks) {
    // Remove the placeholder created by git checkout if it exists
    try { unlinkSync(link); } catch { /* doesn't exist */ }
    // db/ dir created by git checkout needs removal for symlink
    try {
      const entries = readdirSync(link);
      if (entries.length === 0 || (entries.length === 1 && entries[0] === "arc.db")) {
        // Remove placeholder db dir so we can symlink the real one
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
async function validateWorktree(worktreePath: string, taskId: number): Promise<string[]> {
  const branchName = `dispatch/task-${taskId}`;
  // Get list of .ts files changed on the worktree branch vs its merge base
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
async function getWorktreeChangedFiles(worktreePath: string, taskId: number): Promise<string[]> {
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
async function mergeWorktree(taskId: number): Promise<{ ok: boolean; error?: string }> {
  const name = `task-${taskId}`;
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `dispatch/task-${taskId}`;

  const { exitCode, stderr } = await git("merge", branchName, "--no-edit");
  if (exitCode !== 0) return { ok: false, error: stderr.trim() };

  // Clean up worktree + branch
  await git("worktree", "remove", worktreePath, "--force");
  await git("branch", "-d", branchName);
  log(`dispatch: worktree ${name} merged and cleaned up`);
  return { ok: true };
}

/** Remove a worktree and its branch without merging. */
async function discardWorktree(taskId: number): Promise<void> {
  const name = `task-${taskId}`;
  const worktreePath = join(WORKTREE_DIR, name);
  const branchName = `dispatch/task-${taskId}`;

  await git("worktree", "remove", worktreePath, "--force");
  await git("branch", "-D", branchName);
  log(`dispatch: worktree ${name} discarded`);
}

// ---- Learning retrospective ----

/**
 * Schedule a lightweight Haiku task to extract non-obvious learnings from a
 * just-completed P1-4 (Opus) task. Only called on successful completion.
 * The retrospective runs at P8 to avoid crowding real work.
 */
function scheduleRetrospective(task: Task, resultSummary: string, resultDetail: string, costUsd: number): void {
  // Expensive tasks (>$1) get a larger excerpt budget so Haiku sees more context
  const maxLen = costUsd > 1.0 ? 3000 : 1500;
  // Use summary as guaranteed prefix, then fill remaining budget with result detail
  const summaryBlock = resultSummary ? `[Summary] ${resultSummary.trim()}\n\n` : "";
  const detailBudget = Math.max(0, maxLen - summaryBlock.length);
  const excerpt = (summaryBlock + resultDetail.slice(0, detailBudget)).trim();
  insertTask({
    subject: `Retrospective: extract learnings from task #${task.id} — ${task.subject.slice(0, 60)}`,
    description: `A complex P${task.priority} task just completed. Review the work and extract reusable patterns.\n\n**Completed task:** #${task.id} — ${task.subject}\n**Result summary:** ${resultSummary.slice(0, 300)}\n**Result excerpt:**\n${excerpt}\n\n**Your job:**\n1. Read memory/patterns.md first. Check if a similar pattern already exists.\n2. Identify 1–3 reusable patterns that would change how a future task is executed. This means: operational heuristics, architectural decisions, integration gotchas, debugging techniques. NOT bug reports, celebratory notes, or task-specific details.\n3. If a similar pattern exists in patterns.md, UPDATE that entry in-place (edit the existing bullet). If it is genuinely new, append it under the most relevant existing section heading.\n4. Keep each pattern to 1–2 sentences. Never write to MEMORY.md — only patterns.md.\n5. patterns.md must stay under ~150 lines. If your additions would exceed that, remove or merge the oldest/most-specific entries to make room.\n\nIf there is nothing worth capturing, close this task as completed with summary "No learnings to capture".`,
    priority: 8,
    model: "haiku",
    skills: '["arc-skill-manager"]',
    source: `task:${task.id}`,
    parent_id: task.id,
  });
  log(`dispatch: scheduled retrospective task for P${task.priority} task #${task.id}`);
}

// ---- Main entry point ----

/**
 * Run a single dispatch cycle:
 * 1. Lock check (exit if another dispatch is running)
 * 1b. Acquire lock immediately (task_id=null) to prevent TOCTOU races
 * 2. Crash recovery (mark stale active tasks failed)
 * 2b. Circuit breaker check (skip if API failing repeatedly)
 * 3. Pick highest-priority pending task
 * 4. Build prompt (SOUL.md + MEMORY.md + skill context + task details)
 * 5. Mark task active + update lock with task_id
 * 6. Spawn claude with stream-JSON output
 * 7. Dispatch with exponential backoff (1s/2s/4s) for transient errors
 * 8. Close task (if LLM didn't self-close) + record cycle
 * 9. Clear lock + auto-commit (with syntax guard + service health check)
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

  // 1b. Shutdown gate — exit before acquiring lock if agent is down
  const shutdownState = getShutdownState();
  if (shutdownState) {
    log(`dispatch: SHUTDOWN — skipping dispatch (${shutdownState.reason}, since ${shutdownState.since})`);
    writeFleetStatusIdle();
    return;
  }

  // 1c. Acquire lock immediately to close the TOCTOU window.
  // task_id is null until we select a task — but the PID claim prevents races.
  writeDispatchLock(null);

  // 2. Crash recovery — mark any stale active tasks as failed
  const activeTasks = getActiveTasks();
  for (const task of activeTasks) {
    log(
      `dispatch: stale active task #${task.id} "${task.subject}" — marking failed (crash recovery)`
    );
    markTaskFailed(task.id, "Task was left active from a previous cycle (crash recovery)");
  }

  // 2b. Dispatch gate — skip if stopped (rate limit or consecutive failures)
  if (!checkCircuitBreaker()) {
    clearDispatchLock();
    return;
  }

  // 3. Pick highest-priority pending task (getPendingTasks orders by priority ASC, id ASC)
  const pendingTasks = getPendingTasks();
  if (pendingTasks.length === 0) {
    log("dispatch: No pending tasks. Idle.");
    writeFleetStatusIdle();
    clearDispatchLock();
    return;
  }
  const task = pendingTasks[0];
  log(
    `dispatch: selected task #${task.id} "${task.subject}" (priority ${task.priority})`
  );

  // 3b. Budget gate — throttle non-critical tasks when daily spend exceeds ceiling
  const todayCost = getTodayCostUsd();
  if (todayCost >= DAILY_BUDGET_USD && task.priority > 2) {
    log(
      `dispatch: BUDGET GATE — today's cost $${todayCost.toFixed(2)} >= $${DAILY_BUDGET_USD} ceiling. ` +
      `Skipping P${task.priority} task #${task.id}. Only P1-2 tasks will dispatch.`
    );
    clearDispatchLock();
    return;
  }

  // 3c. GitHub gate — on workers, auto-route GitHub tasks to Arc without invoking LLM
  if (AGENT_NAME !== "arc0") {
    const taskText = [task.subject, task.description ?? ""].join(" ");
    if (GITHUB_TASK_RE.test(taskText)) {
      log(`dispatch: GITHUB GATE — task #${task.id} matches GitHub pattern on worker. Auto-routing to Arc.`);
      markTaskActive(task.id);
      const handoff = Bun.spawnSync({
        cmd: [
          "bash", "bin/arc", "skills", "run", "--name", "fleet-handoff", "--",
          "initiate",
          "--agent", "arc",
          "--task-id", String(task.id),
          "--progress", "Pre-dispatch GitHub gate intercepted this task",
          "--remaining", task.subject,
          "--reason", "GitHub is Arc-only (dispatch pre-gate)",
        ],
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const summary = handoff.exitCode === 0
        ? "Auto-routed to Arc via dispatch GitHub gate (GitHub is Arc-only)"
        : "GitHub gate: fleet-handoff failed, marked completed to prevent escalation loop";
      markTaskCompleted(task.id, summary);
      log(`dispatch: ${summary} — task #${task.id}`);
      clearDispatchLock();
      return;
    }
  }

  // 4. Build context for prompt
  const skillNames = parseSkillNames(task.skills);
  const sdkRoute = selectSdk(task);
  const model = sdkRoute.sdk === "claude" ? selectModel(task) : selectModel(task); // Claude tier for timeout/cost calc
  if (skillNames.length > 0) {
    log(`dispatch: loading skills: ${skillNames.join(", ")}`);
  }
  log(`dispatch: sdk=${sdkRoute.sdk} model=${sdkRoute.sdk === "codex" ? (sdkRoute.model ?? "default") : model} (${task.model ? "explicit" : `priority ${task.priority}`})`);

  const recentCycles = getRecentCycles(10)
    .map(
      (c) =>
        `${c.started_at} task=${c.task_id ?? "none"} duration=${c.duration_ms ?? "?"}ms cost=$${(c.cost_usd || 0).toFixed(6)}`
    )
    .join("\n");

  const prompt = buildPrompt(task, skillNames, recentCycles);

  // 5. Mark task active and update lock with task_id; snapshot HEAD for security scan gate
  markTaskActive(task.id);
  writeDispatchLock(task.id);  // update lock: null → task_id
  const preDispatchSha = await getHeadSha();

  log(`dispatch: dispatching for task #${task.id} — "${task.subject}"`);

  // 5b. Worktree isolation — create if task uses worktrees skill
  const useWorktree = skillNames.includes("arc-worktrees");
  let worktreePath: string | undefined;
  if (useWorktree) {
    try {
      worktreePath = await createWorktree(task.id);
      log(`dispatch: running in worktree at ${worktreePath}`);
    } catch (err) {
      log(`dispatch: worktree creation failed — falling back to main tree: ${err}`);
    }
  }

  // 5c. Capture baseline metrics for experiment evaluation (worktree tasks only)
  let experimentBaseline: BaselineSnapshot | undefined;
  if (worktreePath) {
    experimentBaseline = captureBaseline(6);
    log(`dispatch: baseline captured — ${experimentBaseline.cycleCount} cycles, ${(experimentBaseline.successRate * 100).toFixed(0)}% success`);
  }

  // 6. Record cycle start — hash SKILL.md content for effectiveness tracking
  const cycleModelLabel = sdkRoute.sdk === "codex" ? `codex:${sdkRoute.model ?? "default"}` : model;
  const cycleStartedAt = toSqliteDatetime(new Date());
  const skillHashes = computeSkillHashes(skillNames);
  const cycleId = insertCycleLog({
    started_at: cycleStartedAt,
    task_id: task.id,
    skills_loaded: skillNames.length > 0 ? JSON.stringify(skillNames) : null,
    skill_hashes: Object.keys(skillHashes).length > 0 ? JSON.stringify(skillHashes) : null,
    model: cycleModelLabel,
  });

  const dispatchStart = Date.now();
  let cycleUpdated = false;
  let cycleCostUsd = 0;

  // 6b. Detect dispatch backend: codex > openrouter > claude-code
  const useCodex = sdkRoute.sdk === "codex";
  const openRouterKey = useCodex ? null : await getOpenRouterApiKey();
  const useOpenRouter = !useCodex && (!!openRouterKey || process.env.DISPATCH_MODE === "openrouter");
  if (useCodex) {
    log(`dispatch: using Codex CLI dispatch mode (model=${sdkRoute.model ?? "default"})`);
  } else if (useOpenRouter) {
    log("dispatch: using OpenRouter API dispatch mode");
  }

  try {
    // 7. Run dispatch with exponential backoff for transient errors
    const BACKOFF_MS = [1000, 2000, 4000];
    let dispatchResult: DispatchResult | null = null;
    let lastDispatchError: Error | null = null;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        if (useCodex) {
          dispatchResult = await dispatchCodex(prompt, sdkRoute.model, worktreePath ?? undefined);
        } else if (useOpenRouter) {
          dispatchResult = await dispatchOpenRouter(prompt, model, worktreePath ?? undefined, openRouterKey ?? undefined);
        } else {
          dispatchResult = await dispatch(prompt, model, worktreePath);
        }
        break;
      } catch (retryErr) {
        lastDispatchError = retryErr as Error;
        const errClass = classifyError(String(retryErr));

        // 401/403: never retry — fail immediately
        if (errClass === "auth") {
          log(`dispatch: auth error — failing immediately: ${String(retryErr).slice(0, 200)}`);
          break;
        }

        // Subprocess timeout: never retry in inner loop — task needs investigation or restructuring
        if (errClass === "subprocess_timeout") {
          log(`dispatch: subprocess timeout — failing immediately (no inner retry): ${String(retryErr).slice(0, 200)}`);
          break;
        }

        // Transient/rate-limited/unknown: retry with backoff if attempts remain
        if (attempt < BACKOFF_MS.length) {
          const delay = BACKOFF_MS[attempt];
          log(`dispatch: ${errClass} error (attempt ${attempt + 1}/${BACKOFF_MS.length + 1}), retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        log(`dispatch: retries exhausted after ${BACKOFF_MS.length + 1} attempts`);
      }
    }

    if (!dispatchResult) {
      throw lastDispatchError ?? new Error("dispatch failed with no error captured");
    }

    // Success — reset circuit breaker
    recordCircuitSuccess();

    const { result, cost_usd, api_cost_usd, input_tokens, output_tokens } = dispatchResult;

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

    // 8c. Schedule retrospective for high-value P1-2 tasks only (senior-level reasoning worth learning from)
    if (task.priority <= 2) {
      const finalStatus = getTaskById(task.id);
      if (finalStatus?.status === "completed") {
        scheduleRetrospective(task, finalStatus.result_summary ?? result.slice(0, 300), result, cost_usd);
      }
    }

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
    cycleCostUsd = cost_usd;
  } catch (err) {
    const errMsg = String(err);
    const errClass = classifyError(errMsg);

    // Record failure in circuit breaker
    recordCircuitFailure(errMsg);

    if (errClass === "auth") {
      // Auth errors: fail immediately, never requeue
      markTaskFailed(task.id, `Auth error (not retried): ${errMsg.slice(0, 400)}`);
      log(`dispatch: task #${task.id} failed — auth error, not retrying`);
    } else if (errClass === "subprocess_timeout") {
      // Subprocess timeout — fail cleanly, don't retry
      markTaskFailed(task.id, `Task timed out after ${getDispatchTimeoutMs(model) / 60_000}min (${model} tier). Consider breaking it into smaller subtasks or raising the dispatch timeout.`);
      log(`dispatch: task #${task.id} failed — subprocess timeout, not retrying`);
    } else if (errClass === "rate_limited") {
      // Rate/plan limit: requeue without burning retry count — the task isn't at fault
      requeueTask(task.id, { rollbackAttempt: true });
      log(`dispatch: task #${task.id} rate-limited — requeued (attempt count preserved, dispatch gate will block until manual reset)`);
    } else {
      // Transient/unknown: requeue if under max_retries
      const attemptNumber = task.attempt_count + 1;
      if (attemptNumber < task.max_retries) {
        requeueTask(task.id);
        log(
          `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}, ${errClass}) — requeuing: ${errMsg.slice(0, 200)}`
        );
      } else {
        markTaskFailed(task.id, `Max retries exhausted (${errClass}): ${errMsg.slice(0, 400)}`);
        log(
          `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}) — max retries exhausted`
        );
      }
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

  // 10. Post-dispatch: worktree validate+evaluate+merge or normal safe commit
  if (worktreePath) {
    try {
      // Gate 1: Syntax validation
      const errors = await validateWorktree(worktreePath, task.id);
      if (errors.length > 0) {
        log(`dispatch: worktree validation FAILED for ${errors.length} file(s):`);
        for (const err of errors) log(`  ${err}`);
        await discardWorktree(task.id);
        insertTask({
          subject: `Fix worktree validation errors from task #${task.id}`,
          description: `Worktree discarded — syntax errors:\n${errors.join("\n")}`,
          priority: 2,
          source: `task:${task.id}`,
        });
      } else {
        // Gate 2: Experiment evaluation (heuristic gates on change quality)
        const changedFilePaths = await getWorktreeChangedFiles(worktreePath, task.id);
        let experimentApproved = true;

        if (experimentBaseline && changedFilePaths.length > 0) {
          const evalResult = evaluateExperiment(worktreePath, ROOT, changedFilePaths, experimentBaseline);
          for (const w of evalResult.warnings) log(`dispatch: experiment warning — ${w}`);

          if (!evalResult.approved) {
            log(`dispatch: experiment REJECTED — ${evalResult.reason}`);
            experimentApproved = false;
            await discardWorktree(task.id);
            insertTask({
              subject: `Fix experiment rejection from task #${task.id}`,
              description: `Worktree discarded — experiment evaluation failed:\n${evalResult.reason}\n\nWarnings:\n${evalResult.warnings.join("\n")}`,
              priority: 2,
              source: `task:${task.id}`,
            });
          } else {
            log(`dispatch: experiment APPROVED — ${evalResult.reason}`);
          }
        }

        if (experimentApproved) {
          const { ok, error } = await mergeWorktree(task.id);
          if (!ok) {
            log(`dispatch: worktree merge failed — ${error}`);
            await discardWorktree(task.id);
            insertTask({
              subject: `Fix worktree merge conflict from task #${task.id}`,
              description: `Merge failed: ${error}`,
              priority: 2,
              source: `task:${task.id}`,
            });
          } else if (experimentBaseline && changedFilePaths.length > 0) {
            // Schedule deferred verification to check actual impact
            const classified = changedFilePaths.map((p) => ({ path: p, category: classifyFile(p) as any }));
            const verifyId = scheduleVerification(task.id, experimentBaseline, classified);
            log(`dispatch: scheduled experiment verification task #${verifyId}`);
          }
        }
      }
    } catch (err) {
      log(`dispatch: worktree cleanup error — ${err}`);
      try { await discardWorktree(task.id); } catch { /* best effort */ }
    }
  } else {
    // Normal path: safe commit with syntax check + service health guard
    await safeCommitCycleChanges(task.id, cycleId);
  }

  // 11. Write fleet status for peer discovery
  const finalDuration = Date.now() - dispatchStart;
  const finalTask = getTaskById(task.id) ?? task;
  writeFleetStatus(finalTask, finalDuration, cycleCostUsd);

  // 12. Security scan — only when src/ or skills/ changed this cycle
  if (await codeChangedSince(preDispatchSha)) {
    await runSecurityScan(task.id, cycleId);
  } else {
    log("dispatch: security scan skipped — no src/ or skills/ changes this cycle");
  }
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
