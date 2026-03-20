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
  getTodayCostUsd,
  initDatabase,
  insertCycleLog,
  insertTask,
  upsertSkillVersion,
  markTaskActive,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  searchArcMemory,
  updateCycleLog,
  updateTask,
  updateTaskCost,
  tagMemoryCostByTask,
  toSqliteDatetime,
} from "./db.ts";
import { isPidAlive, readFile } from "./utils.ts";
import { getShutdownState } from "./shutdown.ts";
import { getCredential } from "./credentials.ts";
import { type ModelTier, type SdkRoute, MODEL_IDS, MODEL_PRICING, parseTaskSdk } from "./models.ts";
import { dispatchOpenRouter, getOpenRouterApiKey } from "./openrouter.ts";
import { dispatchCodex } from "./codex.ts";
import { captureBaseline, classifyFile, evaluateExperiment, scheduleVerification, type BaselineSnapshot } from "./experiment.ts";
import { type ErrorClass, checkDispatchGate, recordGateSuccess, recordGateFailure } from "./dispatch-gate.ts";
import { safeCommitCycleChanges, getHeadSha, codeChangedSince } from "./safe-commit.ts";
import { createWorktree, validateWorktree, getWorktreeChangedFiles, mergeWorktree, discardWorktree } from "./worktree.ts";
import { resolveMemoryContext, resolveFtsMemoryContext, type FtsMemoryResult } from "./memory-topics.ts";
import { resolveScratchpadContext, clearScratchpad } from "./scratchpad.ts";
import { writeBackLearnings } from "./memory-writeback.ts";

// Re-export for cli.ts
export { resetDispatchGate } from "./dispatch-gate.ts";

// ---- Constants ----

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const SKILLS_DIR = join(ROOT, "skills");

/** Daily cost ceiling (USD). Above this, only P1-2 tasks dispatch. Matches D4 directive. */
const DAILY_BUDGET_USD = 200;

/** Maximum time (ms) a Claude subprocess can run before being killed.
 *  Model-aware: Haiku tasks get 5min (simple execution), Sonnet 15min,
 *  Opus 30min (90min overnight). Prevents simple tasks from blocking the queue.
 *  Note: DISPATCH_STALE_THRESHOLD_MS in constants.ts must exceed the max value here. */
function getDispatchTimeoutMs(model: ModelTier = "opus"): number {
  if (model === "haiku") return 5 * 60 * 1000;
  if (model === "sonnet") return 15 * 60 * 1000;
  const hour = new Date().getHours();
  return (hour >= 0 && hour < 8) ? 90 * 60 * 1000 : 30 * 60 * 1000;
}

// ---- Error classification ----

/** Pre-compiled rate-limit detection pattern — single regex, tested once per error. */
const RATE_LIMIT_RE = /(?:status|HTTP|error|code)[:\s]*429|\brate[_\s-]?limit|\btoo many requests|\b(?:max\s*usage|plan\s*limit|usage\s*limit|token\s*limit)\b|\bplan.*cap|\b(?:limit|quota)\s*(?:reached|exceeded|hit)\b|\bexceeded.*(?:limit|quota)/i;

// Track whether the Claude CLI supports the -n flag. Once detected unsupported,
// all subsequent dispatch calls in this process skip the flag rather than retrying.
let claudeCliSupportsNameFlag = true;

function classifyError(errMsg: string): ErrorClass {
  if (/(?:status|HTTP|error|code)[:\s]*(?:401|403)/i.test(errMsg)
      || /\b(?:unauthorized|forbidden)\b/i.test(errMsg)) {
    return "auth";
  }
  if (RATE_LIMIT_RE.test(errMsg)) {
    return "rate_limited";
  }
  if (/claude subprocess timed out/i.test(errMsg)) {
    return "subprocess_timeout";
  }
  if (/(?:status|HTTP|error|code)[:\s]*5\d{2}/i.test(errMsg)
      || /\b(?:timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND)\b/i.test(errMsg)
      || /stream-JSON incomplete/i.test(errMsg)
      || /timed out/i.test(errMsg)) {
    return "transient";
  }
  // CLI flag changes (e.g. --name removed in a Claude Code update) are transient —
  // dispatch should retry, not permanently stop.
  if (/unknown option/i.test(errMsg)) {
    return "transient";
  }
  return "unknown";
}

// ---- Logging ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Model routing ----

function selectModel(task: Task): ModelTier {
  if (task.model) {
    const m = task.model;
    if (m === "opus" || m === "sonnet" || m === "haiku") return m;
    if (!m.startsWith("codex") && !m.startsWith("openrouter:")) {
      log(`dispatch: unrecognized task.model="${m}" for task #${task.id}, falling back to priority routing`);
    }
  }
  if (task.priority <= 4) return "opus";
  if (task.priority <= 7) return "sonnet";
  return "haiku";
}

function selectSdk(task: Task): SdkRoute {
  return parseTaskSdk(task.model);
}

// ---- Cost calculation ----

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

// ---- Skill context resolver ----

function parseSkillNames(skillsJson: string | null): string[] {
  if (!skillsJson) return [];
  try {
    return JSON.parse(skillsJson) as string[];
  } catch {
    return [];
  }
}

interface SkillResolution {
  context: string;
  hashes: Record<string, string>;
}

/** Read each SKILL.md once; return both the prompt context string and content hashes. */
function resolveSkillContextAndHashes(skillNames: string[]): SkillResolution {
  const contextParts: string[] = [];
  const hashes: Record<string, string> = {};

  for (const name of skillNames) {
    const content = readFile(join(SKILLS_DIR, name, "SKILL.md"));
    if (!content) continue;

    contextParts.push(`# Skill: ${name}\n${content}`);

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    hashes[name] = hasher.digest("hex").slice(0, 12);
    try {
      upsertSkillVersion(hashes[name], name, content);
    } catch {
      // non-fatal: tracking is best-effort
    }
  }

  return { context: contextParts.join("\n\n"), hashes };
}

// ---- Skill suggestion (when task has no explicit skills) ----

/** Query arc_memory for skills matching the task subject. Returns up to 3 suggestions. */
function suggestSkills(taskSubject: string): string[] {
  try {
    // Tokenize subject into FTS5-safe words (remove short words and special chars)
    const words = taskSubject
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);
    if (words.length === 0) return [];

    const query = words.join(" OR ");
    const results = searchArcMemory(query, "skills", 10);

    // Filter to capability entries only
    return results
      .filter((r) => r.key.startsWith("skill:") && !r.key.startsWith("skill-failure:"))
      .slice(0, 3)
      .map((r) => r.key.replace("skill:", ""));
  } catch {
    return [];
  }
}

// ---- Parent chain builder ----

function buildParentChain(task: Task): string {
  const chain: string[] = [];
  let current: Task | null = task.parent_id ? getTaskById(task.parent_id) : null;

  while (current !== null) {
    chain.push(`  #${current.id}: ${current.subject} (${current.status})`);
    current = current.parent_id ? getTaskById(current.parent_id) : null;
    if (chain.length >= 10) break;
  }

  return chain.length > 0 ? "Parent chain:\n" + chain.join("\n") : "";
}

// ---- Prompt builder ----

const MST_OFFSET_MS = 7 * 3600_000;

interface BuiltPrompt {
  prompt: string;
  injectedMemoryKeys: string[];
}

function buildPrompt(task: Task, skillNames: string[], skillContext: string, recentCycles: string, suggestedSkillNames?: string[]): BuiltPrompt {
  const now = new Date();
  const utcIso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const mst = toSqliteDatetime(new Date(now.getTime() - MST_OFFSET_MS)) + " MST";

  const soul = readFile(join(ROOT, "SOUL.md"));
  const memory = resolveMemoryContext(skillNames);
  const ftsResult = resolveFtsMemoryContext(skillNames, task.subject, task.description);
  const parentChain = buildParentChain(task);

  const parts: string[] = [
    "# currentDate",
    `Current time: ${utcIso} (UTC) / ${mst}`,
    "",
  ];

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

  // Inject FTS memory entries (Phase 3e: skill-domain + task keyword search)
  if (ftsResult.context) {
    parts.push(ftsResult.context, "");
  }

  if (skillContext) {
    parts.push(skillContext, "");
  }

  // Skill suggestions for tasks without explicit skills
  if (suggestedSkillNames && suggestedSkillNames.length > 0 && skillNames.length === 0) {
    parts.push(
      "# Suggested Skills",
      `The following skills may be relevant to this task (auto-detected from skill index):`,
      suggestedSkillNames.map((s) => `- ${s}`).join("\n"),
      `Use \`arc skills show --name <name>\` to inspect before loading. Include relevant skills in follow-up tasks via --skills.`,
      "",
    );
  }

  // Project scratchpad — shared context buffer for multi-subtask work
  const scratchpadContext = resolveScratchpadContext(task.id);
  if (scratchpadContext) {
    parts.push(scratchpadContext, "");
  }

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

  parts.push(
    "# Instructions",
    "Use `arc` CLI commands for all actions:",
    `- Close this task: arc tasks close --id ${task.id} --status completed|failed --summary "summary"`,
    `- Create follow-up: arc tasks add --subject "subject" --skills s1,s2 --parent ${task.id}`,
    `- Create a skill: arc skills run --name manage-skills -- create my-skill --description "Does X"`,
    "- Update memory: edit the relevant topic file in memory/topics/ (fleet.md, incidents.md, cost.md, integrations.md, defi.md, publishing.md, identity.md, infrastructure.md). Edit memory/MEMORY.md only for directives, fleet roster, or critical flags.",
    '- Search historical memory: arc memory search --query "keyword" [--domain incidents|cost|fleet|integrations|defi|publishing|identity|infra]',
    '- Add structured memory: arc memory add --key "type:slug" --domain DOMAIN --content "text" [--ttl 90] [--importance 3]',
    `- Project scratchpad (shared across subtasks): arc scratchpad append --task ${task.id} --content "findings..."`,
    `- Read scratchpad: arc scratchpad read --task ${task.id}`,
    "Do NOT use raw SQL, direct DB writes, or ad-hoc scripts.",
  );

  // When memory entries were pre-searched, add explicit debugging guidance
  if (ftsResult.injectedKeys.length > 0) {
    parts.push(
      "",
      "# Pre-Dispatch Memory Context",
      `${ftsResult.injectedKeys.length} memory entries were auto-injected above (see "Memory: Pre-Searched Results").`,
      "If this task involves an error, failure, or unexpected behavior:",
      "1. Check the pre-searched results FIRST — a matching pattern may already document the root cause and fix.",
      "2. If no match, run `arc memory search --query \"<error keyword>\" --domain <domain>` for deeper search before investigating fresh.",
      "3. After resolving a novel failure, record it: `arc memory add --key \"incident:<slug>\" --domain incidents --content \"Symptom: ... Root cause: ... Fix: ...\"`",
    );
  }

  return { prompt: parts.join("\n"), injectedMemoryKeys: ftsResult.injectedKeys };
}

// ---- Stream-JSON dispatch ----

interface DispatchResult {
  result: string;
  cost_usd: number;
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

async function dispatch(prompt: string, model: ModelTier = "opus", cwd?: string, taskId?: number): Promise<DispatchResult> {
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

  if (taskId && claudeCliSupportsNameFlag) {
    // Use short flag -n for session naming — non-essential; if the CLI version drops
    // this flag, claudeCliSupportsNameFlag is set false on first detection and
    // subsequent dispatches skip it without retrying.
    args.push("-n", `arc-task-${taskId}`);
  }

  if (Bun.env.DANGEROUS === "true") {
    args.push("--dangerously-skip-permissions");
  }

  const env = { ...process.env };
  if (process.env.TEST_TOKEN_OPTIMIZATION === "true" || model !== "opus") {
    env.MAX_THINKING_TOKENS = "10000";
  }
  env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS = "30000";

  const proc = Bun.spawn(args, {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    env,
    ...(cwd ? { cwd } : {}),
  });

  // Timeout watchdog
  const dispatchTimeoutMs = getDispatchTimeoutMs(model);
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log(`dispatch: subprocess timeout after ${dispatchTimeoutMs / 60_000}min — killing pid ${proc.pid}`);
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 10_000);
  }, dispatchTimeoutMs);

  // Drain stderr concurrently to prevent pipe buffer deadlock (64KB limit)
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
      return;
    }

    if (parsed["type"] === "stream_event") {
      const event = parsed["event"] as Record<string, unknown> | undefined;
      if (event?.["type"] === "content_block_delta") {
        const delta = event["delta"] as Record<string, unknown> | undefined;
        if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
          result += delta["text"];
        }
      }
    }

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

    if (parsed["type"] === "result") {
      const usage = parsed["usage"] as Record<string, unknown> | undefined;

      const totalCostField = parsed["total_cost_usd"];
      if (typeof totalCostField === "number") {
        cost_usd = totalCostField;
      }

      if (usage) {
        input_tokens = (usage.input_tokens as number) || 0;
        output_tokens = (usage.output_tokens as number) || 0;
        cache_read_tokens = (usage.cache_read_input_tokens as number) || 0;
        cache_creation_tokens = (usage.cache_creation_input_tokens as number) || 0;
      }

      if (!cost_usd && usage) {
        cost_usd = calculateApiCostUsd(model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens);
      }

      if (!result && typeof parsed["result"] === "string") {
        result = parsed["result"];
      }
    }
  }

  for await (const chunk of proc.stdout) {
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop()!;
    for (const line of lines) {
      processLine(line);
    }
  }
  processLine(lineBuffer);

  clearTimeout(timeoutTimer);

  const exitCode = await proc.exited;
  if (timedOut) {
    throw new Error(`claude subprocess timed out after ${dispatchTimeoutMs / 60_000} minutes`);
  }
  if (exitCode !== 0) {
    const errText = (await stderrPromise).trim();
    const errContext = errText || (result ? result.slice(0, 300) : "");
    // If a non-essential CLI flag was rejected, mark it unsupported and let the
    // outer retry loop retry cleanly without it. Preserving "unknown option" in the
    // thrown message keeps classifyError returning "transient" so retries proceed.
    if (/unknown option/i.test(errContext) && args.some(a => a === "-n")) {
      claudeCliSupportsNameFlag = false;
      log(`dispatch: -n flag unsupported — disabling for future calls, retrying via outer loop`);
      throw new Error(`unknown option: -n (flag disabled, retrying): ${errContext}`);
    }
    throw new Error(`claude exited ${exitCode}: ${errContext}`);
  }

  const api_cost_usd = calculateApiCostUsd(model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens);
  const total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens;

  if (!result && cost_usd === 0) {
    throw new Error("stream-JSON incomplete: subprocess exited 0 but produced no result and no cost data (likely crashed mid-stream)");
  }

  return { result, cost_usd, api_cost_usd, input_tokens: total_input_tokens, output_tokens };
}

// ---- Security scan ----

interface SecurityScanResult {
  grade: string;
  numericScore: number;
  totalFindings: number;
  critical: number;
  high: number;
  blocked: boolean;
  raw: string;
}

async function validateSecurity(): Promise<SecurityScanResult> {
  const fnmPath = join(process.env.HOME ?? "/home/dev", ".local", "share", "fnm");
  const fnmBinPath = join(fnmPath, "aliases", "default", "bin");
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

  try {
    const data = JSON.parse(stdout) as {
      score: { grade: string; numericScore: number };
      summary: { totalFindings: number; critical: number; high: number };
    };

    const { grade, numericScore } = data.score;
    const { totalFindings, critical, high } = data.summary;
    const blocked = critical > 0 || exitCode === 2;

    return { grade, numericScore, totalFindings, critical, high, blocked, raw: stdout };
  } catch {
    log(`dispatch: security scan output parse failed — stderr: ${stderr.trim()}`);
    return { grade: "?", numericScore: 0, totalFindings: 0, critical: 0, high: 0, blocked: false, raw: stdout || stderr };
  }
}

async function runSecurityScan(taskId: number, cycleId?: number): Promise<void> {
  try {
    const scan = await validateSecurity();
    log(`dispatch: security scan — grade=${scan.grade} score=${scan.numericScore} findings=${scan.totalFindings} (critical=${scan.critical}, high=${scan.high})`);

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
    log(`dispatch: security scan error (non-blocking) — ${err}`);
  }
}

// ---- Learning retrospective ----

function scheduleRetrospective(task: Task, resultSummary: string, resultDetail: string, costUsd: number): void {
  const maxLen = costUsd > 1.0 ? 3000 : 1500;
  const summaryBlock = resultSummary ? `[Summary] ${resultSummary.trim()}\n\n` : "";
  const detailBudget = Math.max(0, maxLen - summaryBlock.length);
  const excerpt = (summaryBlock + resultDetail.slice(0, detailBudget)).trim();
  insertTask({
    subject: `Retrospective: extract learnings from task #${task.id} — ${task.subject.slice(0, 60)}`,
    description: `A complex P${task.priority} task just completed. Review the work and extract reusable patterns.\n\n**Completed task:** #${task.id} — ${task.subject}\n**Result summary:** ${resultSummary.slice(0, 300)}\n**Result excerpt:**\n${excerpt}\n\n**Your job:**\n1. Read memory/patterns.md first. Check if a similar pattern already exists.\n2. Identify 1–3 reusable patterns that would change how a future task is executed. This means: operational heuristics, architectural decisions, integration gotchas, debugging techniques. NOT bug reports, celebratory notes, or task-specific details.\n3. If a similar pattern exists in patterns.md, UPDATE that entry in-place (edit the existing bullet). If it is genuinely new, append it under the most relevant existing section heading.\n4. Keep each pattern to 1–2 sentences. Never write to MEMORY.md — only patterns.md.\n5. patterns.md must stay under ~150 lines. If your additions would exceed that, remove or merge the oldest/most-specific entries to make room.\n6. For each pattern worth capturing, ALSO store it in FTS memory for future dispatch lookup:\n   arc memory add --key "pattern:<short-slug>" --domain <domain> --content "<the pattern text>" --importance 3\n   Use the most relevant domain (incidents, cost, fleet, integrations, defi, publishing, identity, infra). This ensures high-importance learnings are surfaced in future dispatch prompts.\n\nIf there is nothing worth capturing, close this task as completed with summary "No learnings to capture".`,
    priority: 8,
    model: "haiku",
    skills: '["manage-skills"]',
    source: `task:${task.id}`,
    parent_id: task.id,
  });
  log(`dispatch: scheduled retrospective task for P${task.priority} task #${task.id}`);
}

// ---- Main entry point ----

/**
 * Run a single dispatch cycle:
 *
 * Phase 1 — Pre-flight: lock, shutdown gate, crash recovery, dispatch gate
 * Phase 2 — Task selection: pick task, budget gate, GitHub gate
 * Phase 3 — Execute: build prompt, dispatch with retry
 * Phase 4 — Post-dispatch: close task, commit, fleet status, security scan
 */
export async function runDispatch(): Promise<void> {
  // ---- Phase 1: Pre-flight ----

  const lock = checkDispatchLock();
  if (lock && isPidAlive(lock.pid)) {
    log(`dispatch: in progress (pid=${lock.pid}, task=${lock.task_id}, started=${lock.started_at}) — exiting`);
    return;
  }
  if (lock) {
    log(`dispatch: clearing stale dispatch lock (pid=${lock.pid} is dead)`);
    clearDispatchLock();
  }

  const shutdownState = getShutdownState();
  if (shutdownState) {
    log(`dispatch: SHUTDOWN — skipping dispatch (${shutdownState.reason}, since ${shutdownState.since})`);
    return;
  }

  writeDispatchLock(null);

  const activeTasks = getActiveTasks();
  for (const task of activeTasks) {
    log(`dispatch: stale active task #${task.id} "${task.subject}" — marking failed (crash recovery)`);
    markTaskFailed(task.id, "Task was left active from a previous cycle (crash recovery)");
  }

  if (!checkDispatchGate()) {
    clearDispatchLock();
    return;
  }

  // ---- Phase 2: Task selection ----

  const pendingTasks = getPendingTasks();
  if (pendingTasks.length === 0) {
    log("dispatch: No pending tasks. Idle.");
    clearDispatchLock();
    return;
  }
  const task = pendingTasks[0];
  log(`dispatch: selected task #${task.id} "${task.subject}" (priority ${task.priority})`);

  const todayCost = getTodayCostUsd();
  if (todayCost >= DAILY_BUDGET_USD && task.priority > 2) {
    log(
      `dispatch: BUDGET GATE — today's cost $${todayCost.toFixed(2)} >= $${DAILY_BUDGET_USD} ceiling. ` +
      `Skipping P${task.priority} task #${task.id}. Only P1-2 tasks will dispatch.`
    );
    clearDispatchLock();
    return;
  }

  // ---- Phase 3: Execute ----

  // Load ANTHROPIC_API_KEY from credentials store as OAuth fallback
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const apiKey = await getCredential("anthropic", "api_key");
      if (apiKey) {
        process.env.ANTHROPIC_API_KEY = apiKey;
        log("dispatch: loaded ANTHROPIC_API_KEY from credentials store (OAuth fallback)");
      }
    } catch (err) {
      log(`dispatch: could not load ANTHROPIC_API_KEY from credentials store: ${err}`);
    }
  }

  const skillNames = parseSkillNames(task.skills);
  const sdkRoute = selectSdk(task);
  const model = selectModel(task);
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

  const { context: skillContext, hashes: skillHashes } = resolveSkillContextAndHashes(skillNames);

  // Suggest skills for tasks without explicit skills
  let suggestedSkillNames: string[] | undefined;
  if (skillNames.length === 0) {
    suggestedSkillNames = suggestSkills(task.subject);
    if (suggestedSkillNames.length > 0) {
      log(`dispatch: suggested skills for task #${task.id}: ${suggestedSkillNames.join(", ")}`);
    }
  }

  const { prompt, injectedMemoryKeys } = buildPrompt(task, skillNames, skillContext, recentCycles, suggestedSkillNames);

  if (injectedMemoryKeys.length > 0) {
    log(`dispatch: injected ${injectedMemoryKeys.length} memory entries for task #${task.id}`);
  }

  markTaskActive(task.id);
  writeDispatchLock(task.id);
  const preDispatchSha = await getHeadSha();

  log(`dispatch: dispatching for task #${task.id} — "${task.subject}"`);

  // Worktree isolation
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

  // Capture baseline metrics for experiment evaluation (worktree tasks only)
  let experimentBaseline: BaselineSnapshot | undefined;
  if (worktreePath) {
    experimentBaseline = captureBaseline(6);
    log(`dispatch: baseline captured — ${experimentBaseline.cycleCount} cycles, ${(experimentBaseline.successRate * 100).toFixed(0)}% success`);
  }

  // Record cycle start
  const cycleModelLabel = sdkRoute.sdk === "codex"
    ? `codex:${sdkRoute.model ?? "default"}`
    : sdkRoute.sdk === "openrouter"
      ? `openrouter:${sdkRoute.model ?? "default"}`
      : model;
  const cycleStartedAt = toSqliteDatetime(new Date());
  const memoriesLoaded = injectedMemoryKeys.length > 0 ? JSON.stringify(injectedMemoryKeys) : null;
  const cycleId = insertCycleLog({
    started_at: cycleStartedAt,
    task_id: task.id,
    skills_loaded: skillNames.length > 0 ? JSON.stringify(skillNames) : null,
    skill_hashes: Object.keys(skillHashes).length > 0 ? JSON.stringify(skillHashes) : null,
    model: cycleModelLabel,
  });
  // Log injected memories separately (memories_loaded is a migration column)
  if (memoriesLoaded) {
    updateCycleLog(cycleId, { memories_loaded: memoriesLoaded });
  }
  updateTask(task.id, { model: cycleModelLabel });

  const dispatchStart = Date.now();
  let cycleUpdated = false;
  let cycleCostUsd = 0;

  // Detect dispatch backend
  const useCodex = sdkRoute.sdk === "codex";
  const explicitOpenRouter = sdkRoute.sdk === "openrouter";
  const openRouterKey = (useCodex && !explicitOpenRouter) ? null : await getOpenRouterApiKey();
  const useOpenRouter = explicitOpenRouter || (!useCodex && (!!openRouterKey || process.env.DISPATCH_MODE === "openrouter"));
  if (useCodex) {
    log(`dispatch: using Codex CLI dispatch mode (model=${sdkRoute.model ?? "default"})`);
  } else if (explicitOpenRouter) {
    log(`dispatch: using OpenRouter API dispatch mode (explicit model=${sdkRoute.model ?? "default"})`);
  } else if (useOpenRouter) {
    log("dispatch: using OpenRouter API dispatch mode (Claude fallback)");
  }

  try {
    // Dispatch with exponential backoff for transient errors
    const BACKOFF_MS = [1000, 2000, 4000];
    let dispatchResult: DispatchResult | null = null;
    let lastDispatchError: Error | null = null;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        if (useCodex) {
          dispatchResult = await dispatchCodex(prompt, sdkRoute.model, worktreePath ?? undefined);
        } else if (useOpenRouter) {
          dispatchResult = await dispatchOpenRouter(
            prompt, model, worktreePath ?? undefined, openRouterKey ?? undefined,
            explicitOpenRouter ? sdkRoute.model : undefined,
          );
        } else {
          dispatchResult = await dispatch(prompt, model, worktreePath, task.id);
        }
        break;
      } catch (retryErr) {
        lastDispatchError = retryErr as Error;
        const errClass = classifyError(String(retryErr));

        if (errClass === "auth") {
          log(`dispatch: auth error — failing immediately: ${String(retryErr).slice(0, 200)}`);
          break;
        }
        if (errClass === "subprocess_timeout") {
          log(`dispatch: subprocess timeout — failing immediately (no inner retry): ${String(retryErr).slice(0, 200)}`);
          break;
        }
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

    recordGateSuccess();

    const { result, cost_usd, api_cost_usd, input_tokens, output_tokens } = dispatchResult;

    log(
      `dispatch: task #${task.id} returned — cost_usd=$${cost_usd.toFixed(6)} api_cost=$${api_cost_usd.toFixed(6)} tokens=${input_tokens}in/${output_tokens}out`
    );

    // Check if LLM self-closed the task
    const postStatus = getTaskById(task.id);
    if (postStatus && postStatus.status !== "active") {
      log(`dispatch: task #${task.id} was closed by LLM (status=${postStatus.status})`);
    } else {
      log(`dispatch: task #${task.id} still active after dispatch — fallback close as completed`);
      const summary = result.slice(0, 500) || "Completed — no output";
      markTaskCompleted(task.id, summary, result || undefined);
    }
    updateTaskCost(task.id, cost_usd, api_cost_usd, input_tokens, output_tokens);

    // Tag memory entries created by this task with its cost
    tagMemoryCostByTask(task.id, cost_usd, api_cost_usd);

    // Auto-extract and store learnings from P1-4 task results
    try {
      const wb = writeBackLearnings(task, cost_usd, api_cost_usd);
      if (wb.stored > 0) {
        log(`dispatch: write-back stored ${wb.stored} learning(s) from task #${task.id} (${wb.duplicates} deduped, consolidated=${wb.consolidated})`);
      }
    } catch (wbErr) {
      log(`dispatch: write-back failed (non-fatal): ${String(wbErr).slice(0, 200)}`);
    }

    // Schedule retrospective for P1-2 tasks
    if (task.priority <= 2) {
      const finalStatus = getTaskById(task.id);
      if (finalStatus?.status === "completed") {
        scheduleRetrospective(task, finalStatus.result_summary ?? result.slice(0, 300), result, cost_usd);
      }
    }

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

    recordGateFailure(errMsg, errClass);

    if (errClass === "auth") {
      markTaskFailed(task.id, `Auth error (not retried): ${errMsg.slice(0, 400)}`);
      log(`dispatch: task #${task.id} failed — auth error, not retrying`);
    } else if (errClass === "subprocess_timeout") {
      markTaskFailed(task.id, `Task timed out after ${getDispatchTimeoutMs(model) / 60_000}min (${model} tier). Consider breaking it into smaller subtasks or raising the dispatch timeout.`);
      log(`dispatch: task #${task.id} failed — subprocess timeout, not retrying`);
    } else if (errClass === "rate_limited") {
      requeueTask(task.id, { rollbackAttempt: true });
      log(`dispatch: task #${task.id} rate-limited — requeued (attempt count preserved, dispatch gate will block until manual reset)`);
    } else {
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
    clearDispatchLock();
  }

  // ---- Phase 4: Post-dispatch ----

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
    await safeCommitCycleChanges(task.id);
  }

  // Security scan — only when src/ or skills/ changed
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
