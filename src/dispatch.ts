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
import { homedir } from "node:os";
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

/** Daily cost ceiling (USD). Above this, only P1-2 tasks dispatch. */
const DAILY_BUDGET_USD = 200;

/** Maximum time (ms) a Claude subprocess can run before being killed. 30 minutes. */
const DISPATCH_TIMEOUT_MS = 30 * 60 * 1000;

// ---- Error classification ----

type ErrorClass = "auth" | "rate_limited" | "transient" | "unknown";

/**
 * Classify dispatch errors using contextual HTTP status patterns.
 * Matches "status 401", "HTTP 403", "error 429" etc. — not bare numbers
 * that could be task IDs like "task #401".
 */
function classifyError(errMsg: string): ErrorClass {
  // Auth errors — 401/403 with HTTP context, or named errors
  if (/(?:status|HTTP|error|code)[:\s]*(?:401|403)/i.test(errMsg)
      || /\b(?:unauthorized|forbidden)\b/i.test(errMsg)) {
    return "auth";
  }
  // Rate limiting — 429 with HTTP context, or named patterns
  if (/(?:status|HTTP|error|code)[:\s]*429/i.test(errMsg)
      || /\brate[_\s-]?limit/i.test(errMsg)
      || /\btoo many requests\b/i.test(errMsg)) {
    return "rate_limited";
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

// ---- Circuit breaker ----

const CIRCUIT_STATE_FILE = join(ROOT, "db", "hook-state", "dispatch-circuit.json");
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION_MS = 15 * 60 * 1000;

interface CircuitState {
  consecutive_failures: number;
  circuit_state: "closed" | "open" | "half_open";
  opened_at: string | null;
  last_error: string | null;
  last_updated: string;
}

function readCircuitState(): CircuitState {
  try {
    const data = readFileSync(CIRCUIT_STATE_FILE, "utf-8");
    return JSON.parse(data) as CircuitState;
  } catch {
    return {
      consecutive_failures: 0,
      circuit_state: "closed",
      opened_at: null,
      last_error: null,
      last_updated: new Date().toISOString(),
    };
  }
}

function writeCircuitState(state: CircuitState): void {
  state.last_updated = new Date().toISOString();
  mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
  writeFileSync(CIRCUIT_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Check circuit breaker. Returns true if dispatch should proceed.
 * closed → always proceed. open → skip unless 15min elapsed (→ half_open).
 * half_open → allow one probe.
 */
function checkCircuitBreaker(): boolean {
  const state = readCircuitState();

  if (state.circuit_state === "closed") return true;

  if (state.circuit_state === "open") {
    const elapsed = Date.now() - new Date(state.opened_at!).getTime();
    if (elapsed >= CIRCUIT_OPEN_DURATION_MS) {
      state.circuit_state = "half_open";
      writeCircuitState(state);
      log("dispatch: circuit breaker half-open — allowing probe request");
      return true;
    }
    const remainingMin = Math.ceil((CIRCUIT_OPEN_DURATION_MS - elapsed) / 60_000);
    log(`dispatch: circuit breaker OPEN — skipping (${remainingMin}min remaining, last: ${state.last_error?.slice(0, 100)})`);
    return false;
  }

  // half_open — allow probe
  return true;
}

function recordCircuitSuccess(): void {
  const state = readCircuitState();
  if (state.circuit_state === "closed" && state.consecutive_failures === 0) return;
  state.consecutive_failures = 0;
  state.circuit_state = "closed";
  state.opened_at = null;
  state.last_error = null;
  writeCircuitState(state);
}

function recordCircuitFailure(errMsg: string): void {
  const state = readCircuitState();
  state.consecutive_failures += 1;
  state.last_error = errMsg.slice(0, 500);

  if (state.consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.circuit_state = "open";
    state.opened_at = new Date().toISOString();
    log(`dispatch: circuit breaker OPENED after ${state.consecutive_failures} consecutive failures`);
  }

  writeCircuitState(state);
}

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
 * Route tasks to the appropriate model tier.
 * Explicit task.model takes precedence; falls back to priority-based routing:
 * P1-4 (senior):   Opus  — new skills/sensors, architecture, deep reasoning, complex code.
 * P5-7 (mid):      Sonnet — composition, reviews, moderate complexity, operational tasks.
 * P8+  (junior):   Haiku  — simple execution, mark-as-read, config edits, status checks.
 */
function selectModel(task: Task): ModelTier {
  if (task.model) {
    const m = task.model;
    if (m === "opus" || m === "sonnet" || m === "haiku") return m;
    log(`dispatch: unrecognized task.model="${m}" for task #${task.id}, falling back to priority routing`);
  }
  if (task.priority <= 4) return "opus";
  if (task.priority <= 7) return "sonnet";
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

async function dispatch(prompt: string, model: ModelTier = "opus", cwd?: string): Promise<DispatchResult> {
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

  // Timeout watchdog — kill subprocess if it exceeds DISPATCH_TIMEOUT_MS
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log(`dispatch: subprocess timeout after ${DISPATCH_TIMEOUT_MS / 60_000}min — killing pid ${proc.pid}`);
    proc.kill("SIGTERM");
    // Force kill after 10 seconds if SIGTERM doesn't work
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 10_000);
  }, DISPATCH_TIMEOUT_MS);

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
    throw new Error(`claude subprocess timed out after ${DISPATCH_TIMEOUT_MS / 60_000} minutes`);
  }
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`claude exited ${exitCode}: ${errText.trim()}`);
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

  // 1b. Acquire lock immediately to close the TOCTOU window.
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

  // 2b. Circuit breaker — skip dispatch if API has been failing repeatedly
  if (!checkCircuitBreaker()) {
    clearDispatchLock();
    return;
  }

  // 3. Pick highest-priority pending task (getPendingTasks orders by priority ASC, id ASC)
  const pendingTasks = getPendingTasks();
  if (pendingTasks.length === 0) {
    log("dispatch: No pending tasks. Idle.");
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

  // 4. Build context for prompt
  const skillNames = parseSkillNames(task.skills);
  const model = selectModel(task);
  if (skillNames.length > 0) {
    log(`dispatch: loading skills: ${skillNames.join(", ")}`);
  }
  log(`dispatch: model=${model} (${task.model ? "explicit" : `priority ${task.priority}`})`);

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
  const useWorktree = skillNames.includes("worktrees");
  let worktreePath: string | undefined;
  if (useWorktree) {
    try {
      worktreePath = await createWorktree(task.id);
      log(`dispatch: running in worktree at ${worktreePath}`);
    } catch (err) {
      log(`dispatch: worktree creation failed — falling back to main tree: ${err}`);
    }
  }

  // 6. Record cycle start
  const cycleStartedAt = toSqliteDatetime(new Date());
  const cycleId = insertCycleLog({
    started_at: cycleStartedAt,
    task_id: task.id,
    skills_loaded: skillNames.length > 0 ? JSON.stringify(skillNames) : null,
    model,
  });

  const dispatchStart = Date.now();
  let cycleUpdated = false;

  try {
    // 7. Run dispatch with exponential backoff for transient errors
    const BACKOFF_MS = [1000, 2000, 4000];
    let dispatchResult: DispatchResult | null = null;
    let lastDispatchError: Error | null = null;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        dispatchResult = await dispatch(prompt, model, worktreePath);
        break;
      } catch (retryErr) {
        lastDispatchError = retryErr as Error;
        const errClass = classifyError(String(retryErr));

        // 401/403: never retry — fail immediately
        if (errClass === "auth") {
          log(`dispatch: auth error — failing immediately: ${String(retryErr).slice(0, 200)}`);
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
    const errClass = classifyError(errMsg);

    // Record failure in circuit breaker
    recordCircuitFailure(errMsg);

    if (errClass === "auth") {
      // Auth errors: fail immediately, never requeue
      markTaskFailed(task.id, `Auth error (not retried): ${errMsg.slice(0, 400)}`);
      log(`dispatch: task #${task.id} failed — auth error, not retrying`);
    } else {
      // Transient/rate-limited/unknown: requeue if under max_retries
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

  // 10. Post-dispatch: worktree validate+merge or normal safe commit
  if (worktreePath) {
    try {
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

  // 11. Security scan — only when src/ or skills/ changed this cycle
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
