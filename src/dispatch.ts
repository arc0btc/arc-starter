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
  insertServiceLog,
  insertTask,
  upsertSkillVersion,
  markTaskActive,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  updateCycleLog,
  updateTask,
  updateTaskCost,
  toSqliteDatetime,
} from "./db.ts";
import { isPidAlive, log } from "./utils.ts";
import { getShutdownState } from "./shutdown.ts";
import { getCredential } from "./credentials.ts";

import { type ModelTier, type SdkRoute, MODEL_IDS, MODEL_PRICING, parseTaskSdk } from "./models.ts";
import { dispatchOpenRouter, getOpenRouterApiKey } from "./openrouter.ts";
import { dispatchCodex } from "./codex.ts";
import { captureBaseline, classifyFile, evaluateExperiment, scheduleVerification, type BaselineSnapshot } from "./experiment.ts";
import { type ErrorClass, checkDispatchGate, recordGateSuccess, recordGateFailure } from "./dispatch-gate.ts";

import { safeCommitCycleChanges, getHeadSha, codeChangedSince } from "./safe-commit.ts";
import { createWorktree, validateWorktree, getWorktreeChangedFiles, mergeWorktree, discardWorktree } from "./worktree.ts";
import { extractContributionTagFromText, insertContributionTag } from "./contribution-tags.ts";

// Re-export for cli.ts
export { resetDispatchGate } from "./dispatch-gate.ts";

// ---- Constants ----

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const SKILLS_DIR = join(ROOT, "skills");

/** Daily cost ceiling (USD). Above this, only P1-2 tasks dispatch. D4 directive: $200/day cap. */
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
  return "unknown";
}

// ---- Model routing ----

function selectModel(task: Task): ModelTier | null {
  if (task.model) {
    const m = task.model;
    if (m === "opus" || m === "sonnet" || m === "haiku") return m;
    if (!m.startsWith("codex") && !m.startsWith("openrouter:")) {
      log(`dispatch: unrecognized task.model="${m}" for task #${task.id}, no model resolved`);
    }
  }
  // No implicit priority→model routing — model must be set explicitly
  return null;
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

// ---- Memory filter ----

/** Section letters always included regardless of skill context */
const MEMORY_ALWAYS_LETTERS = new Set(["A", "F", "P", "L"]);

/**
 * Filter the [S] Services section: keep entries whose [SKILLS: ...] tag overlaps
 * relevantSkills, entries with no tag (cross-cutting), and any [FLAG] entries.
 * Expired entries ([EXPIRES: date] in the past) are dropped.
 */
function filterServicesSection(block: string, relevantSkills: Set<string>): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = block.split("\n");

  const preamble: string[] = []; // section header + HTML comment
  const entries: Array<string[]> = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^\*\*/.test(line)) {
      if (current) entries.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) entries.push(current);

  const filtered = entries.filter((entry) => {
    const firstLine = entry[0];
    // Always keep [FLAG] entries
    if (/\[FLAG\]/i.test(firstLine)) return true;
    // Drop expired entries
    const expiresMatch = firstLine.match(/\[EXPIRES:\s*([^\]]+)\]/);
    if (expiresMatch && expiresMatch[1].trim() < now) return false;
    // No [SKILLS] tag → cross-cutting, always include
    const skillsMatch = firstLine.match(/\[SKILLS:\s*([^\]]+)\]/);
    if (!skillsMatch) return true;
    // Include if any tagged skill appears in relevantSkills
    const tagged = skillsMatch[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return tagged.some((s) => relevantSkills.has(s));
  });

  if (filtered.length === 0) return "";

  const resultLines = [...preamble];
  for (const entry of filtered) resultLines.push(...entry);
  return resultLines.join("\n").trimEnd();
}

/**
 * Selectively filter MEMORY.md (ASMR v1) by task skill context.
 *
 * Always loads:  [A] Operational State, [P] Patterns, [L] Learnings
 * Filtered:      [S] Services — only entries matching task skills (or untagged)
 * Skipped:       [T] Temporal Events — incident audit trail, not needed per-task
 *
 * Falls back to full content when skillNames is empty.
 */
function filterMemoryBySkills(memoryContent: string, skillNames: string[]): string {
  if (!memoryContent) return "";
  if (skillNames.length === 0) return memoryContent;

  const relevantSkills = new Set<string>(skillNames);

  // Split before each "## [X]" section header, preserving the header in each block
  const parts = memoryContent.split(/(?=^## \[[A-Z]\])/m);
  const header = parts[0];
  const sectionBlocks = parts.slice(1);

  const output: string[] = [header.trimEnd()];

  for (const block of sectionBlocks) {
    const letter = block.match(/^## \[([A-Z])\]/)?.[1];
    if (!letter) continue;

    if (MEMORY_ALWAYS_LETTERS.has(letter)) {
      // Always include: A (Operational State), P (Patterns), L (Learnings)
      output.push("", block.trimEnd());
    } else if (letter === "S") {
      // Filter Services entries by skill tags
      const filtered = filterServicesSection(block, relevantSkills);
      if (filtered) output.push("", filtered);
    }
    // [T] Temporal Events: skip — incident audit trail not needed per-task
  }

  return output.join("\n");
}

// ---- Prompt builder ----

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Format date as Mountain Time with DST-aware abbreviation (MST/MDT). */
function formatMountainTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of parts) p[type] = value;
  // hour12:false may return "24" at midnight; normalize
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}

/** Human-readable duration: "3m ago", "2h ago", "5d ago". */
function humanAgo(fromMs: number, toMs: number): string {
  const diffMs = toMs - fromMs;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

function buildPrompt(task: Task, skillNames: string[], recentCycles: string): string {
  const now = new Date();
  const utc = toSqliteDatetime(now) + " UTC";
  const mountain = formatMountainTime(now);
  const dayOfWeek = DAY_NAMES[now.getUTCDay()];

  const soul = readFile(join(ROOT, "SOUL.md"));
  const rawMemory = readFile(join(ROOT, "memory", "MEMORY.md"));
  const memory = filterMemoryBySkills(rawMemory, skillNames);
  const skillContext = resolveSkillContext(skillNames);
  const parentChain = buildParentChain(task);

  // Time since last dispatch cycle
  let lastCycleNote = "";
  if (recentCycles) {
    const firstLine = recentCycles.split("\n")[0];
    const tsMatch = firstLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (tsMatch) {
      const lastCycleMs = new Date(tsMatch[1] + "Z").getTime();
      if (!Number.isNaN(lastCycleMs)) {
        lastCycleNote = ` (last cycle: ${humanAgo(lastCycleMs, now.getTime())})`;
      }
    }
  }

  // Memory staleness warning (check raw to avoid false negatives from filtering)
  let memoryNote = "";
  const memLastUpdatedMatch = rawMemory.match(/Last (?:updated|consolidated):\s*([^*\n]+)/);
  if (memLastUpdatedMatch) {
    const memAgeMs = now.getTime() - new Date(memLastUpdatedMatch[1].trim()).getTime();
    const memAgeDays = Math.floor(memAgeMs / 86_400_000);
    if (memAgeDays >= 3) {
      memoryNote = ` [STALE: last updated ${memAgeDays}d ago — consolidate soon]`;
    }
  }

  const parts: string[] = [
    "# Current Time",
    `${dayOfWeek}, ${utc} / ${mountain}${lastCycleNote}`,
    "",
  ];

  const optionalSections: Array<[string, string]> = [
    ["# Identity", soul],
    [`# Memory${memoryNote}`, memory],
    ["# Recent Cycles", recentCycles],
  ];
  for (const [heading, content] of optionalSections) {
    if (content) {
      if (heading) {
        parts.push(heading, content, "");
      } else {
        parts.push(content, "");
      }
    }
  }

  if (skillContext) {
    parts.push(skillContext, "");
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
    `- Create a skill: arc skills run --name arc-skill-manager -- create my-skill --description "Does X"`,
    "- Update memory: edit memory/MEMORY.md directly",
    "- Write learnings: if you discovered a reusable pattern, write it to memory/shared/entries/<slug>.md with frontmatter (id, topics[], source, created) — check for duplicates first",
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

async function dispatch(prompt: string, model: ModelTier = "opus", cwd?: string, taskId?: number, taskSubject?: string): Promise<DispatchResult> {
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

  if (Bun.env.DANGEROUS === "true") {
    args.push("--dangerously-skip-permissions");
  }

  const env = { ...process.env };
  // Effort level: set explicitly for all models to prevent silent cost inflation from upstream
  // default changes (v2.1.94 changed default medium→high for API-key users).
  // MAX_THINKING_TOKENS: hard cap on thinking tokens, overrides effort target.
  // Opus: high effort for deep work, capped at 30K thinking tokens (3× non-opus cap).
  // Non-opus + test mode: medium effort, capped at 10K thinking tokens.
  if (process.env.TEST_TOKEN_OPTIMIZATION === "true" || model !== "opus") {
    env.MAX_THINKING_TOKENS = "10000";
    args.push("--effort", "medium");
  } else {
    env.MAX_THINKING_TOKENS = "30000";
    args.push("--effort", "high");
  }
  env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS = "30000";
  env.ARC_DISPATCH_MODEL = MODEL_IDS[model];
  // Idle watchdog: match dispatch outer timeout so long tool calls (Bash, network) don't trigger
  // premature stream termination. Arc's outer watchdog is the controlling kill mechanism.
  env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = String(getDispatchTimeoutMs(model));
  // API request timeout: v2.1.101+ respects this env var (previously hardcoded to 5min).
  // Set to match dispatch timeout so individual API calls don't abort before the outer kill fires.
  env.API_TIMEOUT_MS = String(getDispatchTimeoutMs(model));
  // Strip Anthropic/cloud-provider credentials from Bash tool subprocesses, hooks, and MCP stdio.
  // Arc's CLI calls (arc tasks add/close, arc creds) only need ARC_CREDS_PASSWORD which survives.
  // Arc's hooks (session-start.sh, memory-save.sh) use only git/jq — no API keys needed.
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";
  // Task context for session-start.sh hook
  if (taskId !== undefined) {
    env.ARC_TASK_ID = String(taskId);
  }
  if (taskSubject !== undefined) {
    env.ARC_TASK_SUBJECT = taskSubject;
  }

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
        model: "sonnet",
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
 *
 * Phase 1 — Pre-flight: lock, shutdown gate, crash recovery, dispatch gate
 * Phase 2 — Task selection: pick task, budget gate, GitHub gate
 * Phase 3 — Execute: build prompt, dispatch with retry
 * Phase 4 — Post-dispatch: close task, commit, security scan
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
  insertServiceLog("info", "dispatch", `selected task #${task.id} "${task.subject}" (priority ${task.priority})`, task.id);

  const todayCost = getTodayCostUsd();
  if (todayCost >= DAILY_BUDGET_USD && task.priority > 2) {
    log(
      `dispatch: BUDGET GATE — today's cost $${todayCost.toFixed(2)} >= $${DAILY_BUDGET_USD} ceiling. ` +
      `Skipping P${task.priority} task #${task.id}. Only P1-2 tasks will dispatch.`
    );
    insertServiceLog("warn", "dispatch", `budget gate: $${todayCost.toFixed(2)} >= $${DAILY_BUDGET_USD} ceiling, skipping P${task.priority} task #${task.id}`, task.id);
    clearDispatchLock();
    return;
  }

  // Landing-page gate — auto-close tasks that are handled interactively by humans.
  // Matches "[landing-page]" or "[org/landing-page]" prefixes (any form from sensor or human).
  // Analysis tasks also dropped — they require human context and consistently fail without it.
  const LANDING_PAGE_RE = /\[[^\]]*\/landing-page\]|^\[landing-page\]/i;
  if (LANDING_PAGE_RE.test(task.subject)) {
    const summary = "Auto-closed by landing-page gate — handled interactively by human";
    log(`dispatch: LANDING-PAGE GATE — task #${task.id} "${task.subject}" matches pattern. Closing without dispatch.`);
    insertServiceLog("info", "dispatch", `landing-page gate: auto-closed task #${task.id}`, task.id);
    markTaskCompleted(task.id, summary);
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

  // Guard: Claude SDK tasks require an explicit model — no implicit defaults
  if (sdkRoute.sdk === "claude" && model === null) {
    const msg = `task #${task.id} has no model set — every task must specify an explicit model (opus/sonnet/haiku)`;
    log(`dispatch: MODEL GATE — ${msg}`);
    insertServiceLog("warn", "dispatch", msg, task.id);
    markTaskFailed(task.id, "No model set — task requires explicit model column (opus/sonnet/haiku)");
    clearDispatchLock();
    return;
  }

  // For non-Claude SDKs (codex/openrouter), model is used only for cost/timeout estimation
  const effectiveModel: ModelTier = model ?? "sonnet";

  if (skillNames.length > 0) {
    log(`dispatch: loading skills: ${skillNames.join(", ")}`);
  }
  log(`dispatch: sdk=${sdkRoute.sdk} model=${sdkRoute.sdk === "codex" ? (sdkRoute.model ?? "default") : effectiveModel} (${task.model ? "explicit" : "no model"})`);

  const recentCycles = getRecentCycles(10)
    .map(
      (c) =>
        `${c.started_at} task=${c.task_id ?? "none"} duration=${c.duration_ms ?? "?"}ms cost=$${(c.cost_usd || 0).toFixed(6)}`
    )
    .join("\n");

  const prompt = buildPrompt(task, skillNames, recentCycles);

  markTaskActive(task.id);
  writeDispatchLock(task.id);
  const preDispatchSha = await getHeadSha();

  log(`dispatch: dispatching for task #${task.id} — "${task.subject}"`);

  // Worktree isolation
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
      : effectiveModel;
  const cycleStartedAt = toSqliteDatetime(new Date());
  const skillHashes = computeSkillHashes(skillNames);
  const cycleId = insertCycleLog({
    started_at: cycleStartedAt,
    task_id: task.id,
    skills_loaded: skillNames.length > 0 ? JSON.stringify(skillNames) : null,
    skill_hashes: Object.keys(skillHashes).length > 0 ? JSON.stringify(skillHashes) : null,
    model: cycleModelLabel,
  });
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
            prompt, effectiveModel, worktreePath ?? undefined, openRouterKey ?? undefined,
            explicitOpenRouter ? sdkRoute.model : undefined,
          );
        } else {
          dispatchResult = await dispatch(prompt, effectiveModel, worktreePath, task.id, task.subject);
        }
        break;
      } catch (retryErr) {
        lastDispatchError = retryErr as Error;
        const errClass = classifyError(String(retryErr));

        if (errClass === "auth") {
          log(`dispatch: auth error — failing immediately: ${String(retryErr).slice(0, 200)}`);
          insertServiceLog("error", "dispatch", `auth error: ${String(retryErr).slice(0, 200)}`, task.id);
          break;
        }
        if (errClass === "subprocess_timeout") {
          log(`dispatch: subprocess timeout — failing immediately (no inner retry): ${String(retryErr).slice(0, 200)}`);
          insertServiceLog("error", "dispatch", `subprocess timeout (no retry)`, task.id);
          break;
        }
        if (attempt < BACKOFF_MS.length) {
          const delay = BACKOFF_MS[attempt];
          log(`dispatch: ${errClass} error (attempt ${attempt + 1}/${BACKOFF_MS.length + 1}), retrying in ${delay}ms`);
          insertServiceLog("warn", "dispatch", `${errClass} error, retry ${attempt + 1}/${BACKOFF_MS.length + 1} in ${delay}ms`, task.id);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        log(`dispatch: retries exhausted after ${BACKOFF_MS.length + 1} attempts`);
        insertServiceLog("error", "dispatch", `retries exhausted (${errClass}) after ${BACKOFF_MS.length + 1} attempts`, task.id);
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

    // Sandbox-failure guard: if the subagent reported it couldn't run tools, force failure.
    // Why: v2.1.108 Bash sandbox can block every command; LLM still produces clean prose and
    // may self-close as completed. Without this guard, PR reviews silently no-op.
    // Anchor to multi-command denial phrases — the LLM narrates these when every tool call
    // is blocked. Single-instance "requires approval" false-positives on review prose.
    const sandboxFailurePattern = /(sandbox failed to initialize|sandbox is (?:completely )?(?:non-functional|down|unavailable|blocking)|bash sandbox has (?:completely )?failed|all bash (?:commands|execution) (?:are|is) blocked|unable to execute any bash commands|every (?:bash )?command (?:is |being )?blocked)/i;
    if (sandboxFailurePattern.test(result)) {
      log(`dispatch: task #${task.id} sandbox-failure detected — forcing status=failed`);
      insertServiceLog("error", "dispatch", `task #${task.id} sandbox-failure detected`, task.id);
      markTaskFailed(task.id, "Sandbox blocked tool execution — no real work performed. Check .claude/settings.json sandbox.enabled.");
      updateTaskCost(task.id, cost_usd, api_cost_usd, input_tokens, output_tokens);
      return;
    }

    // Check if LLM self-closed the task
    const postStatus = getTaskById(task.id);
    if (postStatus && postStatus.status !== "active") {
      log(`dispatch: task #${task.id} was closed by LLM (status=${postStatus.status})`);
      insertServiceLog("info", "dispatch", `task #${task.id} closed by LLM (${postStatus.status})`, task.id);
    } else {
      log(`dispatch: task #${task.id} still active after dispatch — fallback close as completed`);
      const summary = result.slice(0, 500) || "Completed — no output";
      markTaskCompleted(task.id, summary, result || undefined);
      insertServiceLog("info", "dispatch", `task #${task.id} fallback-closed as completed`, task.id);
    }
    updateTaskCost(task.id, cost_usd, api_cost_usd, input_tokens, output_tokens);

    // Extract contribution tag if present in result_detail
    const finalStatus = getTaskById(task.id);
    if (finalStatus?.result_detail) {
      const ctag = extractContributionTagFromText(finalStatus.result_detail);
      if (ctag) {
        try {
          // Backfill actual cost now that updateTaskCost has run
          ctag.agent.review_cost_usd = cost_usd;
          insertContributionTag(ctag);
          log(`dispatch: contribution tag extracted and stored for task #${task.id} (${ctag.company.repo})`);
        } catch (tagErr) {
          log(`dispatch: contribution tag insert failed for task #${task.id}: ${String(tagErr).slice(0, 200)}`);
        }
      } else if (/review pr #?\d+/i.test(task.subject)) {
        log(`dispatch: no contribution tag emitted for review task #${task.id} — "${task.subject}"`);
      }
    }

    // Schedule retrospective for complex/expensive tasks; lightweight learning extraction for others
    if ((task.priority <= 1 || cost_usd > 1.0) && finalStatus?.status === "completed") {
      // Full retrospective: patterns.md update for high-value work
      scheduleRetrospective(task, finalStatus.result_summary ?? result.slice(0, 300), result, cost_usd);
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
      insertServiceLog("error", "dispatch", `task #${task.id} failed: auth error`, task.id);
    } else if (errClass === "subprocess_timeout") {
      markTaskFailed(task.id, `Task timed out after ${getDispatchTimeoutMs(effectiveModel) / 60_000}min (${effectiveModel} tier). Consider breaking it into smaller subtasks or raising the dispatch timeout.`);
      log(`dispatch: task #${task.id} failed — subprocess timeout, not retrying`);
      insertServiceLog("error", "dispatch", `task #${task.id} failed: subprocess timeout (${effectiveModel}, ${getDispatchTimeoutMs(effectiveModel) / 60_000}min)`, task.id);
    } else if (errClass === "rate_limited") {
      requeueTask(task.id, { rollbackAttempt: true });
      log(`dispatch: task #${task.id} rate-limited — requeued (attempt count preserved, dispatch gate will block until manual reset)`);
      insertServiceLog("warn", "dispatch", `task #${task.id} rate-limited, requeued`, task.id);
    } else {
      const attemptNumber = task.attempt_count + 1;
      if (attemptNumber < task.max_retries) {
        requeueTask(task.id);
        log(
          `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}, ${errClass}) — requeuing: ${errMsg.slice(0, 200)}`
        );
        insertServiceLog("warn", "dispatch", `task #${task.id} failed attempt ${attemptNumber}/${task.max_retries} (${errClass}), requeued`, task.id);
      } else {
        markTaskFailed(task.id, `Max retries exhausted (${errClass}): ${errMsg.slice(0, 400)}`);
        log(
          `dispatch: task #${task.id} failed (attempt ${attemptNumber}/${task.max_retries}) — max retries exhausted`
        );
        insertServiceLog("error", "dispatch", `task #${task.id} max retries exhausted (${errClass})`, task.id);
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
          model: "sonnet",
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
              model: "sonnet",
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
              model: "sonnet",
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
