#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  initDatabase,
  insertTask,
  pendingTaskExistsForSubject,
  pendingTaskExistsForSource,
  getPendingTasks,
  getActiveTasks,
  getRecentCycles,
  markTaskCompleted,
  markTaskFailed,
  markTaskBlocked,
  getTaskById,
  updateTask,
  requeueTask,
  insertTaskDep,
  getTaskDeps,
  deleteTaskDep,
  insertArcMemory,
  searchArcMemory,
  listArcMemory,
  deleteArcMemory,
  getArcMemory,
  expireArcMemories,
  countArcMemories,
  checkRecentFailures,
  consolidateMemories,
  getExpensiveMemories,
  getMemoryCostByDomain,
  getMemoryCostBySkill,
  backfillMemoryCostFromTasks,
} from "./db.ts";
import {
  readScratchpad,
  writeScratchpad,
  appendScratchpad,
  clearScratchpad,
  resolveRootTaskId,
} from "./scratchpad.ts";
import type { TaskDepType } from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { parseFlags, pad, truncate } from "./utils.ts";
import { handleCredsCli } from "../skills/credentials/cli.ts";
import { enterShutdown, exitShutdown, getShutdownState } from "./shutdown.ts";
import { writeBackLearnings, extractLearnings } from "./memory-writeback.ts";

// CLI is hand-rolled — intentionally zero-dep. If the surface grows significantly,
// consider citty (https://github.com/unjs/citty) as a lightweight alternative to Commander.

// ---- Usage strings (shared between error messages and cmdHelp) ----

const USAGE = {
  tasksAdd:
    'arc tasks add --subject TEXT [--description TEXT] [--priority N] [--source TEXT]\n' +
    '              [--skills SKILL1,SKILL2|none] [--parent ID] [--model opus|sonnet|haiku|codex|codex:<model>]\n' +
    '              [--defer DURATION | --scheduled-for ISO_DATETIME]',
  tasksUpdate:
    'arc tasks update --id N [--subject TEXT] [--description TEXT] [--priority N] [--skills S1,S2|none] [--model opus|sonnet|haiku|codex|codex:<model>] [--status pending]',
  tasksClose:
    'arc tasks close --id N --status completed|failed|blocked --summary TEXT',
  tasksDeps: 'arc tasks deps --id N',
  tasksLink: 'arc tasks link --from N --to M --type blocks|related|discovered-from',
  tasksUnlink: 'arc tasks unlink --from N --to M --type blocks|related|discovered-from',
  skillsShow: 'arc skills show --name NAME',
  skillsRun:  'arc skills run --name NAME [-- extra-args]',
  memorySearch: 'arc memory search --query TEXT [--domain DOMAIN] [--limit N] [--syntax]',
  memoryAdd: 'arc memory add --key KEY --domain DOMAIN --content TEXT [--tags "t1 t2"] [--ttl DAYS] [--importance N]',
  memoryList: 'arc memory list [--domain DOMAIN] [--limit N]',
  memoryDelete: 'arc memory delete --key KEY',
  memoryExpire: 'arc memory expire',
  memoryConsolidate: 'arc memory consolidate [--domain DOMAIN]',
  memoryCheckDedup: 'arc memory check-dedup --subject TEXT [--hours N] [--threshold N]',
  memorySearchSkills: 'arc memory search-skills --query TEXT [--limit N]',
  scratchpadRead: 'arc scratchpad read --task N',
  scratchpadWrite: 'arc scratchpad write --task N --content TEXT',
  scratchpadAppend: 'arc scratchpad append --task N --content TEXT',
  scratchpadClear: 'arc scratchpad clear --task N',
} as const;

// ---- Commands ----

/** Note: total_cost_usd from Claude Code stream-JSON reflects equivalent API cost,
 *  not direct Max budget consumption. The actual Max throttling mechanism is opaque.
 *  This serves as a relative usage proxy — higher cost = more budget consumed. */

function cmdStatus(): void {
  const db = initDatabase();

  const pendingCount = getPendingTasks().length;
  const activeCount = getActiveTasks().length;

  const cycles = getRecentCycles(1);
  const lastCycle = cycles.length > 0 ? cycles[0] : null;

  // Daily cost from cycle_log (more accurate timing than tasks.created_at)
  const { cost: costToday, api_cost: apiCostToday, tok_in: tokInToday, tok_out: tokOutToday, cycles: cyclesToday } = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost, COALESCE(SUM(tokens_in), 0) as tok_in, COALESCE(SUM(tokens_out), 0) as tok_out, COUNT(*) as cycles FROM cycle_log WHERE date(started_at) = date('now')"
    )
    .get() as { cost: number; api_cost: number; tok_in: number; tok_out: number; cycles: number };

  // Weekly cost from cycle_log (rolling 7-day window)
  const { cost: costWeek, api_cost: apiCostWeek, tok_in: tokInWeek, tok_out: tokOutWeek, cycles: cyclesWeek } = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost, COALESCE(SUM(tokens_in), 0) as tok_in, COALESCE(SUM(tokens_out), 0) as tok_out, COUNT(*) as cycles FROM cycle_log WHERE started_at >= datetime('now', '-7 days')"
    )
    .get() as { cost: number; api_cost: number; tok_in: number; tok_out: number; cycles: number };

  // Task completion stats
  const { completed_today: completedToday } = db
    .query("SELECT COUNT(*) as completed_today FROM tasks WHERE status = 'completed' AND date(completed_at) = date('now')")
    .get() as { completed_today: number };
  const { completed_week: completedWeek } = db
    .query("SELECT COUNT(*) as completed_week FROM tasks WHERE status = 'completed' AND completed_at >= datetime('now', '-7 days')")
    .get() as { completed_week: number };
  const { failed_today: failedToday } = db
    .query("SELECT COUNT(*) as failed_today FROM tasks WHERE status = 'failed' AND date(completed_at) = date('now')")
    .get() as { failed_today: number };

  // Shutdown state indicator
  const shutdown = getShutdownState();
  if (shutdown) {
    process.stdout.write(`** SHUTDOWN ** ${shutdown.reason} (since ${shutdown.since})\n\n`);
  }

  process.stdout.write(`pending: ${pendingCount}  active: ${activeCount}\n`);

  if (lastCycle) {
    const ts = lastCycle.started_at;
    const dur = lastCycle.duration_ms !== null ? `${lastCycle.duration_ms}ms` : "running";
    const cycleCost = lastCycle.cost_usd ? ` cost=$${lastCycle.cost_usd.toFixed(6)}` : "";
    process.stdout.write(`last cycle: ${ts} (${dur})${cycleCost}\n`);
  } else {
    process.stdout.write("last cycle: none\n");
  }

  // Work done
  process.stdout.write(`\ncompleted: ${completedToday} today / ${completedWeek} this week${failedToday > 0 ? ` (${failedToday} failed)` : ""}\n`);

  // Usage (informational — API-equivalent cost, not direct Max plan consumption)
  process.stdout.write(`\nusage (7d): $${costWeek.toFixed(2)} actual / $${apiCostWeek.toFixed(2)} api est (${cyclesWeek} cycles)\n`);
  process.stdout.write(`  today: $${costToday.toFixed(2)} actual / $${apiCostToday.toFixed(2)} api est (${cyclesToday} cycles)\n`);
  process.stdout.write(`  tokens today: ${formatTokens(tokInToday)} in / ${formatTokens(tokOutToday)} out\n`);
  process.stdout.write(`  tokens week:  ${formatTokens(tokInWeek)} in / ${formatTokens(tokOutWeek)} out\n`);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function cmdTasksList(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 20;
  const statusFilter = flags["status"];

  const db = initDatabase();

  let rows: Array<{
    id: number;
    priority: number;
    status: string;
    subject: string;
    source: string | null;
    created_at: string;
  }>;

  if (statusFilter) {
    rows = db
      .query(
        "SELECT id, priority, status, subject, source, created_at FROM tasks WHERE status = ? ORDER BY priority ASC, id ASC LIMIT ?"
      )
      .all(statusFilter, limit) as typeof rows;
  } else {
    rows = db
      .query(
        "SELECT id, priority, status, subject, source, created_at FROM tasks WHERE status IN ('pending', 'active') ORDER BY priority ASC, id ASC LIMIT ?"
      )
      .all(limit) as typeof rows;
  }

  if (rows.length === 0) {
    process.stdout.write("No tasks found.\n");
    return;
  }

  const header = pad("id", 4) + pad("pri", 4) + pad("status", 12) + pad("subject", 34) + pad("source", 14) + "created_at";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const row of rows) {
    const line =
      pad(String(row.id), 4) +
      pad(String(row.priority), 4) +
      pad(row.status, 12) +
      pad(truncate(row.subject, 32), 34) +
      pad(truncate(row.source ?? "", 12), 14) +
      truncate(row.created_at, 16);
    process.stdout.write(line + "\n");
  }
}

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports: "30m", "2h", "1d", "1h30m", "90m", "2d12h"
 */
function parseDuration(s: string): number | null {
  const pattern = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;
  const match = s.trim().match(pattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const days = parseInt(match[1] ?? "0", 10);
  const hours = parseInt(match[2] ?? "0", 10);
  const minutes = parseInt(match[3] ?? "0", 10);
  return (days * 24 * 60 + hours * 60 + minutes) * 60 * 1000;
}

function cmdTasksAdd(args: string[]): void {
  const { flags } = parseFlags(args);

  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write(`Error: --subject is required\nUsage: ${USAGE.tasksAdd}\n`);
    process.exit(1);
  }

  const skillsJson = flags["skills"]
    ? (() => {
        const raw = flags["skills"].trim();
        // --skills none → explicit null (dispatch with no skill context)
        if (raw === "none") return null;
        // Accept both JSON array (e.g. '["a","b"]') and comma-separated (e.g. 'a,b')
        if (raw.startsWith("[")) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String));
          } catch {
            // fall through to comma-split
          }
        }
        return JSON.stringify(raw.split(",").map((s) => s.trim()));
      })()
    : undefined;
  const parentId = flags["parent"] ? parseInt(flags["parent"], 10) : undefined;
  const priority = flags["priority"] ? parseInt(flags["priority"], 10) : undefined;
  const model = flags["model"] ?? undefined;

  // Resolve scheduled_for from --defer or --scheduled-for
  let scheduledFor: string | undefined;
  if (flags["defer"]) {
    const ms = parseDuration(flags["defer"]);
    if (ms === null) {
      process.stderr.write(`Error: --defer "${flags["defer"]}" is not a valid duration. Examples: 30m, 2h, 1d, 1h30m\n`);
      process.exit(1);
    }
    scheduledFor = new Date(Date.now() + ms).toISOString();
  } else if (flags["scheduled-for"]) {
    const d = new Date(flags["scheduled-for"]);
    if (isNaN(d.getTime())) {
      process.stderr.write(`Error: --scheduled-for "${flags["scheduled-for"]}" is not a valid datetime\n`);
      process.exit(1);
    }
    scheduledFor = d.toISOString();
  }

  initDatabase();

  // Dedup: skip if identical pending task exists (unless --force)
  const force = flags["force"] === "true" || flags["force"] === "";
  if (!force) {
    if (pendingTaskExistsForSubject(subject)) {
      process.stdout.write(`Skipped: pending task with same subject already exists: ${subject}\n`);
      return;
    }
    const source = flags["source"];
    if (source && pendingTaskExistsForSource(source)) {
      process.stdout.write(`Skipped: pending task with same source already exists: ${source}\n`);
      return;
    }
  }

  const id = insertTask({
    subject,
    description: flags["description"],
    skills: skillsJson,
    priority,
    source: flags["source"],
    parent_id: parentId,
    model,
    scheduled_for: scheduledFor,
  });

  if (scheduledFor) {
    process.stdout.write(`Created task #${id} (scheduled for ${scheduledFor}): ${subject}\n`);
  } else {
    process.stdout.write(`Created task #${id}: ${subject}\n`);
  }
}

function cmdTasksClose(args: string[]): void {
  const { flags } = parseFlags(args);
  const usage = `Usage: ${USAGE.tasksClose}\n`;

  const status = flags["status"];
  const summary = flags["summary"];
  const id = parseInt(flags["id"] ?? "", 10);

  if (isNaN(id)) {
    process.stderr.write("Error: --id must be a number\n" + usage);
    process.exit(1);
  }
  if (status !== "completed" && status !== "failed" && status !== "blocked") {
    process.stderr.write("Error: --status must be 'completed', 'failed', or 'blocked'\n" + usage);
    process.exit(1);
  }
  if (!summary) {
    process.stderr.write("Error: --summary is required\n" + usage);
    process.exit(1);
  }

  initDatabase();

  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  if (status === "completed") {
    markTaskCompleted(id, summary);
  } else if (status === "blocked") {
    markTaskBlocked(id, summary);
  } else {
    markTaskFailed(id, summary);
  }

  // Auto-clear scratchpad when a root parent task closes
  if (!task.parent_id && (status === "completed" || status === "failed")) {
    clearScratchpad(id);
  }

  process.stdout.write(`Closed task #${id} as ${status}\n`);
}

function cmdTasksUpdate(args: string[]): void {
  const { flags } = parseFlags(args);
  const usage = `Usage: ${USAGE.tasksUpdate}\n`;

  const id = parseInt(flags["id"] ?? "", 10);
  if (isNaN(id)) {
    process.stderr.write("Error: --id must be a number\n" + usage);
    process.exit(1);
  }

  const subject = flags["subject"];
  const description = flags["description"];
  const priority = flags["priority"] ? parseInt(flags["priority"], 10) : undefined;
  const model = flags["model"] ?? undefined;
  const status = flags["status"] ?? undefined;
  const skillsRaw = flags["skills"];
  // Normalize --skills: comma-separated string → JSON array, "none"/""  → null to clear
  const skills =
    skillsRaw === undefined
      ? undefined
      : skillsRaw === "" || skillsRaw === "none"
        ? null
        : JSON.stringify(skillsRaw.split(",").map((s) => s.trim()).filter(Boolean));

  if (priority !== undefined && isNaN(priority)) {
    process.stderr.write("Error: --priority must be a number\n" + usage);
    process.exit(1);
  }

  if (status !== undefined && status !== "pending") {
    process.stderr.write("Error: --status only supports 'pending' (to requeue blocked/failed tasks)\n" + usage);
    process.exit(1);
  }

  if (subject === undefined && description === undefined && priority === undefined && model === undefined && skills === undefined && status === undefined) {
    process.stderr.write(
      "Error: at least one of --subject, --description, --priority, --skills, --model, or --status is required\n" + usage
    );
    process.exit(1);
  }

  initDatabase();

  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  if (subject !== undefined || description !== undefined || priority !== undefined || model !== undefined || skills !== undefined) {
    updateTask(id, { subject, description, priority, model, skills });
  }
  if (status === "pending") {
    requeueTask(id);
  }

  const updated: string[] = [];
  if (subject !== undefined) updated.push("subject");
  if (description !== undefined) updated.push("description");
  if (priority !== undefined) updated.push("priority");
  if (skills !== undefined) updated.push("skills");
  if (model !== undefined) updated.push("model");
  if (status !== undefined) updated.push("status → pending");
  process.stdout.write(`Updated task #${id}: ${updated.join(", ")}\n`);
}

function cmdTasksDeps(args: string[]): void {
  const { flags } = parseFlags(args);
  const id = parseInt(flags["id"] ?? "", 10);
  if (isNaN(id)) {
    process.stderr.write(`Error: --id must be a number\nUsage: ${USAGE.tasksDeps}\n`);
    process.exit(1);
  }

  initDatabase();
  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  const deps = getTaskDeps(id);
  if (deps.length === 0) {
    process.stdout.write(`No dependencies for task #${id}\n`);
    return;
  }

  const header = pad("from", 8) + pad("to", 8) + pad("type", 20) + "created_at";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const dep of deps) {
    const line =
      pad(`#${dep.from_id}`, 8) +
      pad(`#${dep.to_id}`, 8) +
      pad(dep.dep_type, 20) +
      truncate(dep.created_at, 16);
    process.stdout.write(line + "\n");
  }
}

const VALID_DEP_TYPES_CLI: Set<string> = new Set(["blocks", "related", "discovered-from"]);

function cmdTasksLink(args: string[]): void {
  const { flags } = parseFlags(args);
  const fromId = parseInt(flags["from"] ?? "", 10);
  const toId = parseInt(flags["to"] ?? "", 10);
  const depType = flags["type"];

  if (isNaN(fromId) || isNaN(toId)) {
    process.stderr.write(`Error: --from and --to must be numbers\nUsage: ${USAGE.tasksLink}\n`);
    process.exit(1);
  }
  if (!depType || !VALID_DEP_TYPES_CLI.has(depType)) {
    process.stderr.write(`Error: --type must be one of: blocks, related, discovered-from\nUsage: ${USAGE.tasksLink}\n`);
    process.exit(1);
  }

  initDatabase();

  const fromTask = getTaskById(fromId);
  const toTask = getTaskById(toId);
  if (!fromTask) {
    process.stderr.write(`Error: task #${fromId} not found\n`);
    process.exit(1);
  }
  if (!toTask) {
    process.stderr.write(`Error: task #${toId} not found\n`);
    process.exit(1);
  }

  insertTaskDep(fromId, toId, depType as TaskDepType);
  process.stdout.write(`Linked: #${fromId} --[${depType}]--> #${toId}\n`);
}

function cmdTasksUnlink(args: string[]): void {
  const { flags } = parseFlags(args);
  const fromId = parseInt(flags["from"] ?? "", 10);
  const toId = parseInt(flags["to"] ?? "", 10);
  const depType = flags["type"];

  if (isNaN(fromId) || isNaN(toId)) {
    process.stderr.write(`Error: --from and --to must be numbers\nUsage: ${USAGE.tasksUnlink}\n`);
    process.exit(1);
  }
  if (!depType || !VALID_DEP_TYPES_CLI.has(depType)) {
    process.stderr.write(`Error: --type must be one of: blocks, related, discovered-from\nUsage: ${USAGE.tasksUnlink}\n`);
    process.exit(1);
  }

  initDatabase();
  deleteTaskDep(fromId, toId, depType as TaskDepType);
  process.stdout.write(`Unlinked: #${fromId} --[${depType}]--> #${toId}\n`);
}

function cmdTasks(args: string[]): void {
  const sub = args[0];
  if (sub === "add") {
    cmdTasksAdd(args.slice(1));
  } else if (sub === "close") {
    cmdTasksClose(args.slice(1));
  } else if (sub === "update") {
    cmdTasksUpdate(args.slice(1));
  } else if (sub === "deps") {
    cmdTasksDeps(args.slice(1));
  } else if (sub === "link") {
    cmdTasksLink(args.slice(1));
  } else if (sub === "unlink") {
    cmdTasksUnlink(args.slice(1));
  } else {
    cmdTasksList(args);
  }
}

async function cmdRun(): Promise<void> {
  const { runDispatch } = await import("./dispatch.ts");
  initDatabase();
  await runDispatch();
}

async function cmdDispatch(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "reset") {
    const { resetDispatchGate } = await import("./dispatch-gate.ts");
    resetDispatchGate();
    process.stdout.write("Dispatch gate reset to 'running'. Next cycle will proceed normally.\n");
  } else {
    process.stderr.write("Usage: arc dispatch reset\n  Reset the dispatch gate after a rate-limit stop.\n");
    process.exit(1);
  }
}

function cmdSkillsList(): void {
  const skills = discoverSkills();

  if (skills.length === 0) {
    process.stdout.write("No skills found.\n");
    return;
  }

  const header =
    pad("name", 22) +
    pad("description", 42) +
    pad("sensor", 7) +
    "cli";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const skill of skills) {
    const line =
      pad(truncate(skill.name, 20), 22) +
      pad(truncate(skill.description, 40), 42) +
      pad(skill.hasSensor ? "yes" : "no", 7) +
      (skill.hasCli ? "yes" : "no");
    process.stdout.write(line + "\n");
  }
}

function cmdSkillsShow(args: string[]): void {
  const { flags } = parseFlags(args);
  const name = flags["name"];
  if (!name) {
    process.stderr.write(`Error: --name is required\nUsage: ${USAGE.skillsShow}\n`);
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

function cmdSkillsRun(args: string[]): void {
  // Parse flags only up to the first --, so skill args don't override --name
  const dashDashIdx = args.indexOf("--");
  const argsUpToDashDash = dashDashIdx >= 0 ? args.slice(0, dashDashIdx) : args;
  const { flags } = parseFlags(argsUpToDashDash);
  const skillName = flags["name"];
  if (!skillName) {
    process.stderr.write(`Error: --name is required\nUsage: ${USAGE.skillsRun}\n`);
    process.exit(1);
  }

  const skills = discoverSkills();
  const skill = skills.find((s) => s.name === skillName);

  if (!skill) {
    process.stderr.write(`Error: skill '${skillName}' not found\n`);
    process.exit(1);
  }

  if (!skill.hasCli) {
    process.stderr.write(`Error: skill '${skillName}' has no cli.ts\n`);
    process.exit(1);
  }

  const cliPath = join(skill.path, "cli.ts");
  // Pass through everything after -- as skill args
  const skillArgs = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : [];

  const result = Bun.spawnSync(["bun", cliPath, ...skillArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  process.exit(result.exitCode);
}

function cmdSkills(args: string[]): void {
  const sub = args[0];
  if (sub === "show") {
    cmdSkillsShow(args.slice(1));
  } else if (sub === "run") {
    cmdSkillsRun(args.slice(1));
  } else {
    cmdSkillsList();
  }
}

function cmdSensorsList(): void {
  const skills = discoverSkills();
  const sensors = skills.filter((s) => s.hasSensor);

  if (sensors.length === 0) {
    process.stdout.write("No sensors found.\n");
    return;
  }

  const header = pad("name", 22) + pad("description", 42) + "sensor path";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const skill of sensors) {
    const line =
      pad(truncate(skill.name, 20), 22) +
      pad(truncate(skill.description, 40), 42) +
      join(skill.path, "sensor.ts");
    process.stdout.write(line + "\n");
  }
}

async function cmdSensorsRun(): Promise<void> {
  const { runSensors } = await import("./sensors.ts");
  initDatabase();
  await runSensors();
}

async function cmdSensors(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "list") {
    cmdSensorsList();
  } else {
    await cmdSensorsRun();
  }
}

async function cmdServices(args: string[]): Promise<void> {
  const { servicesInstall, servicesUninstall, servicesStatus } = await import("./services.ts");
  const sub = args[0];
  switch (sub) {
    case "install":
      servicesInstall();
      break;
    case "uninstall":
      servicesUninstall();
      break;
    case "status":
      servicesStatus();
      break;
    default:
      process.stderr.write("Usage: arc services install|uninstall|status\n");
      process.exit(sub ? 1 : 0);
  }
}

function cmdShutdown(args: string[]): void {
  const { flags } = parseFlags(args);
  const reason = flags["reason"] ?? "Manual shutdown via CLI";

  // Check current state
  const current = getShutdownState();
  if (current) {
    process.stdout.write(`Already in shutdown state since ${current.since}: ${current.reason}\n`);
    return;
  }

  const state = enterShutdown(reason, "cli");
  process.stdout.write(`Shutdown state enabled.\n  Reason: ${state.reason}\n  Since: ${state.since}\n`);
  process.stdout.write(`\nSensors and dispatch will skip on next cycle.\n`);
  process.stdout.write(`To stop services immediately: arc services uninstall\n`);
  process.stdout.write(`To resume: arc resume\n`);
}

function cmdResume(args: string[]): void {
  const current = getShutdownState();
  if (!current) {
    process.stdout.write("Agent is not in shutdown state. Nothing to do.\n");
    return;
  }

  const downSince = current.since;
  exitShutdown();
  process.stdout.write(`Shutdown state cleared. Agent was down since ${downSince}.\n`);
  process.stdout.write(`Sensors and dispatch will resume on next timer cycle.\n`);
  process.stdout.write(`To restart services if stopped: arc services install\n`);
}

// ---- Memory commands ----

function displayFTS5Syntax(): void {
  process.stdout.write(`FTS5 Query Syntax Guide
================================

Memory search uses SQLite FTS5 (Full-Text Search 5) with Porter stemming.
This guide shows valid query formats and common mistakes.

VALID QUERIES (working examples):
  Single word:
    arc memory search --query "dispatch"
    arc memory search --query "bitcoin"

  Exact phrase (use double quotes):
    arc memory search --query '"dispatch gate"'
    arc memory search --query '"fleet degradation"'

  OR operator (either word):
    arc memory search --query "dispatch OR gate"
    arc memory search --query "bitcoin OR ethereum"

  AND operator (both words):
    arc memory search --query "dispatch AND lock"
    arc memory search --query "cost AND tracking"

  NOT operator (exclude word):
    arc memory search --query "dispatch NOT gate"
    arc memory search --query "memory -stale"

INVALID QUERIES (will fail):
  Regex patterns:
    ✗ arc memory search --query "blog.*cadence"
    ✗ arc memory search --query "dispatch[0-9]+"
  Note: Regex is not supported in FTS5

  Unquoted phrases:
    ✗ arc memory search --query "dispatch gate"
    (should be: arc memory search --query '"dispatch gate"')

QUERY OPERATORS REFERENCE:
  "phrase"        Exact phrase match
  word1 word2     All words (implicit AND)
  word1 OR word2  Either word
  word1 NOT word2 Exclude word2
  word1 AND word2 Both words (explicit)

DOMAIN FILTERING:
  Combine with --domain to search within a specific domain:
    arc memory search --query "dispatch" --domain incidents
    arc memory search --query '"cost report"' --domain cost

TIPS:
  • Single words always work
  • Use quotes for multi-word exact phrases
  • No regex or wildcards — use word-based boolean operators instead
  • Stemming is automatic (e.g., "dispatch" matches "dispatcher", "dispatching")
  • Case insensitive

EXAMPLES THAT WORK:
  arc memory search --query "incident"
  arc memory search --query '"root cause"' --domain incidents
  arc memory search --query "cost OR expense" --domain cost
  arc memory search --query "dispatch AND gate" --limit 10
`);
}

function cmdMemorySearch(args: string[]): void {
  const { flags } = parseFlags(args);

  // Check for --syntax flag
  if (flags["syntax"] === "" || flags["syntax"] === "true") {
    displayFTS5Syntax();
    return;
  }

  const query = flags["query"];
  if (!query) {
    process.stderr.write(`Error: --query is required\nUsage: ${USAGE.memorySearch}\n`);
    process.stderr.write(`\nUse --syntax flag to see FTS5 query syntax examples:\n  arc memory search --syntax\n`);
    process.exit(1);
  }

  initDatabase();
  const domain = flags["domain"];
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 20;

  let results: ReturnType<typeof searchArcMemory>;
  try {
    results = searchArcMemory(query, domain, limit);
  } catch (err) {
    if (err instanceof Error && (err.message.includes("fts5") && err.message.includes("syntax error"))) {
      process.stderr.write(`Error: Invalid FTS5 query syntax: ${query}\n\n`);
      process.stderr.write(`Common issues:\n`);
      process.stderr.write(`  • Regex patterns are not supported (e.g., 'blog.*cadence')\n`);
      process.stderr.write(`  • Multi-word phrases need quotes: "dispatch gate" not dispatch gate\n`);
      process.stderr.write(`  • Use boolean operators: OR, AND, NOT\n\n`);
      process.stderr.write(`Run 'arc memory search --syntax' to see full syntax guide.\n`);
      process.exit(1);
    }
    throw err;
  }

  if (results.length === 0) {
    process.stdout.write("No memories found.\n");
    return;
  }

  for (const mem of results) {
    process.stdout.write(`--- ${mem.key} [${mem.domain}] (importance: ${mem.importance}) ---\n`);
    process.stdout.write(`${mem.content}\n`);
    if (mem.tags) process.stdout.write(`tags: ${mem.tags}\n`);
    process.stdout.write(`created: ${mem.created_at} | updated: ${mem.updated_at}`);
    if (mem.ttl_days !== null) process.stdout.write(` | ttl: ${mem.ttl_days}d`);
    process.stdout.write("\n\n");
  }
}

function cmdMemoryAdd(args: string[]): void {
  const { flags } = parseFlags(args);
  const key = flags["key"];
  const domain = flags["domain"];
  const content = flags["content"];

  if (!key || !domain || !content) {
    process.stderr.write(`Error: --key, --domain, and --content are required\nUsage: ${USAGE.memoryAdd}\n`);
    process.exit(1);
  }

  initDatabase();

  const ttl = flags["ttl"] ? parseInt(flags["ttl"], 10) : undefined;
  const importance = flags["importance"] ? parseInt(flags["importance"], 10) : undefined;
  const tags = flags["tags"] ?? "";
  const sourceTaskId = flags["source-task"] ? parseInt(flags["source-task"], 10) : undefined;
  const costUsd = flags["cost-usd"] ? parseFloat(flags["cost-usd"]) : undefined;
  const apiCostUsd = flags["api-cost-usd"] ? parseFloat(flags["api-cost-usd"]) : undefined;

  insertArcMemory({ key, domain, content, tags, ttl_days: ttl, source_task_id: sourceTaskId, importance, cost_usd: costUsd, api_cost_usd: apiCostUsd });
  process.stdout.write(`Added memory: ${key} [${domain}]\n`);
}

function cmdMemoryList(args: string[]): void {
  const { flags } = parseFlags(args);
  initDatabase();

  const domain = flags["domain"];
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 20;
  const results = listArcMemory(domain, limit);

  if (results.length === 0) {
    process.stdout.write("No memories found.\n");
    return;
  }

  const total = countArcMemories(domain);
  process.stdout.write(`Showing ${results.length} of ${total} memories${domain ? ` in domain '${domain}'` : ""}:\n\n`);

  const header = pad("key", 40) + pad("domain", 16) + pad("imp", 5) + pad("ttl", 6) + "updated_at";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const mem of results) {
    const line =
      pad(truncate(mem.key, 38), 40) +
      pad(mem.domain, 16) +
      pad(String(mem.importance), 5) +
      pad(mem.ttl_days !== null ? `${mem.ttl_days}d` : "-", 6) +
      truncate(mem.updated_at, 16);
    process.stdout.write(line + "\n");
  }
}

function cmdMemoryDelete(args: string[]): void {
  const { flags } = parseFlags(args);
  const key = flags["key"];
  if (!key) {
    process.stderr.write(`Error: --key is required\nUsage: ${USAGE.memoryDelete}\n`);
    process.exit(1);
  }

  initDatabase();
  deleteArcMemory(key);
  process.stdout.write(`Deleted memory: ${key}\n`);
}

function cmdMemoryExpire(): void {
  initDatabase();
  const count = expireArcMemories();
  process.stdout.write(`Expired ${count} memories.\n`);
}

function cmdMemoryConsolidate(args: string[]): void {
  const { flags } = parseFlags(args);
  initDatabase();
  const domain = flags["domain"];
  const result = consolidateMemories(domain);

  process.stdout.write(`TTL assigned:        ${result.ttlAssigned}\n`);
  process.stdout.write(`Importance decayed:  ${result.importanceDecayed}\n`);
  process.stdout.write(`Expired (removed):   ${result.expired}\n`);

  if (result.domainAlerts.length > 0) {
    process.stdout.write("\nDomain budget alerts:\n");
    for (const alert of result.domainAlerts) {
      process.stdout.write(`  ${alert.domain}: ${alert.count} entries (over budget)\n`);
    }
  }

  const remaining = countArcMemories(domain);
  process.stdout.write(`Total remaining:     ${remaining}\n`);
}

function cmdMemoryCheckDedup(args: string[]): void {
  const { flags } = parseFlags(args);
  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write(`Error: --subject is required\nUsage: ${USAGE.memoryCheckDedup}\n`);
    process.exit(1);
  }

  initDatabase();
  const hours = flags["hours"] ? parseInt(flags["hours"], 10) : 24;
  const threshold = flags["threshold"] ? parseInt(flags["threshold"], 10) : 3;

  const result = checkRecentFailures(subject, hours, threshold);

  if (result.exceeded) {
    process.stdout.write(
      `SUPPRESSED: ${result.count} recent failures in last ${hours}h (threshold: ${threshold})\n` +
      `Task "${subject}" would be blocked by failure-aware dedup.\n`,
    );
    process.exit(1);
  } else {
    process.stdout.write(
      `OK: ${result.count} recent failures in last ${hours}h (threshold: ${threshold})\n` +
      `Task "${subject}" would be allowed.\n`,
    );
  }
}

function cmdMemorySearchSkills(args: string[]): void {
  const { flags } = parseFlags(args);
  const query = flags["query"];
  if (!query) {
    process.stderr.write(`Error: --query is required\nUsage: ${USAGE.memorySearchSkills}\n`);
    process.exit(1);
  }

  initDatabase();
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 10;

  // Search skill capabilities in arc_memory domain='skills', excluding failure entries
  let results = searchArcMemory(query, "skills", limit * 2);
  results = results.filter((r) => r.key.startsWith("skill:") && !r.key.startsWith("skill-failure:"));
  results = results.slice(0, limit);

  if (results.length === 0) {
    process.stdout.write("No matching skills found.\n");
    return;
  }

  process.stdout.write(`Found ${results.length} matching skill(s):\n\n`);
  for (const mem of results) {
    const skillName = mem.key.replace("skill:", "");
    process.stdout.write(`  ${pad(skillName, 30)} ${mem.content.split(".").slice(1, 3).join(".").trim()}\n`);
    if (mem.tags) {
      process.stdout.write(`  ${pad("", 30)} tags: ${mem.tags}\n`);
    }
  }
}

function cmdMemoryExpensive(args: string[]): void {
  const { flags } = parseFlags(args);
  initDatabase();

  const domain = flags["domain"];
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 10;

  // Backfill cost from tasks table for entries that are missing it
  const backfilled = backfillMemoryCostFromTasks();
  if (backfilled > 0) {
    process.stdout.write(`Backfilled cost data for ${backfilled} entries.\n\n`);
  }

  const results = getExpensiveMemories(domain, limit);

  if (results.length === 0) {
    process.stdout.write("No memory entries with cost data found.\n");
    return;
  }

  process.stdout.write(`Top ${results.length} most expensive memory entries${domain ? ` in '${domain}'` : ""}:\n\n`);

  const header = pad("key", 40) + pad("domain", 14) + pad("cost_usd", 10) + pad("api_cost", 10) + "task";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const mem of results) {
    const line =
      pad(truncate(mem.key, 38), 40) +
      pad(mem.domain, 14) +
      pad(mem.cost_usd !== null ? `$${mem.cost_usd.toFixed(4)}` : "-", 10) +
      pad(mem.api_cost_usd !== null ? `$${mem.api_cost_usd.toFixed(4)}` : "-", 10) +
      (mem.source_task_id ? `#${mem.source_task_id}` : "-");
    process.stdout.write(line + "\n");
  }
}

function cmdMemoryCostByDomain(): void {
  initDatabase();

  // Backfill cost from tasks table for entries that are missing it
  const backfilled = backfillMemoryCostFromTasks();
  if (backfilled > 0) {
    process.stdout.write(`Backfilled cost data for ${backfilled} entries.\n\n`);
  }

  const results = getMemoryCostByDomain();

  if (results.length === 0) {
    process.stdout.write("No memory entries found.\n");
    return;
  }

  process.stdout.write("Memory cost by domain:\n\n");

  const header = pad("domain", 18) + pad("entries", 10) + pad("total_cost", 12) + pad("api_cost", 12) + "avg_cost";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  let grandTotal = 0;
  let grandApiTotal = 0;
  let grandEntries = 0;

  for (const row of results) {
    grandTotal += row.total_cost_usd;
    grandApiTotal += row.total_api_cost_usd;
    grandEntries += row.entry_count;
    const line =
      pad(row.domain, 18) +
      pad(String(row.entry_count), 10) +
      pad(`$${row.total_cost_usd.toFixed(4)}`, 12) +
      pad(`$${row.total_api_cost_usd.toFixed(4)}`, 12) +
      `$${row.avg_cost_usd.toFixed(4)}`;
    process.stdout.write(line + "\n");
  }

  process.stdout.write("-".repeat(header.length) + "\n");
  process.stdout.write(
    pad("TOTAL", 18) +
    pad(String(grandEntries), 10) +
    pad(`$${grandTotal.toFixed(4)}`, 12) +
    pad(`$${grandApiTotal.toFixed(4)}`, 12) +
    "\n"
  );
}

function cmdMemoryCostBySkill(): void {
  initDatabase();

  // Backfill cost from tasks table for entries that are missing it
  backfillMemoryCostFromTasks();

  const results = getMemoryCostBySkill();

  if (results.length === 0) {
    process.stdout.write("No skill-correlated cost data found.\n");
    return;
  }

  process.stdout.write("Memory cost by skill (via task correlation):\n\n");

  const header = pad("skill", 30) + pad("entries", 10) + pad("total_cost", 12) + "avg_cost";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const row of results) {
    const line =
      pad(truncate(row.skill_name, 28), 30) +
      pad(String(row.entry_count), 10) +
      pad(`$${row.total_cost_usd.toFixed(4)}`, 12) +
      `$${row.avg_cost_usd.toFixed(4)}`;
    process.stdout.write(line + "\n");
  }
}

function cmdMemoryFleetStatus(): void {
  initDatabase();

  const entry = getArcMemory("fleet-state:loom");
  if (!entry) {
    process.stdout.write("No fleet-state memory entry found for loom.\n");
    return;
  }

  process.stdout.write("=== Loom Status (from memory) ===\n\n");
  const lines = entry.content.split("\n");
  for (const line of lines) {
    process.stdout.write(`  ${line}\n`);
  }
  const age = Math.floor((Date.now() - new Date(entry.updated_at).getTime()) / 60000);
  process.stdout.write(`\nMemory updated: ${age}m ago (importance=${entry.importance})\n`);
}

function cmdMemoryWriteBack(args: string[]): void {
  initDatabase();
  const flags = parseFlags(args);
  const taskId = Number(flags["task"]);
  const dryRun = flags["dry-run"] === "true" || flags["dry-run"] === "";

  if (!taskId || isNaN(taskId)) {
    process.stderr.write("Usage: arc memory write-back --task ID [--dry-run]\n");
    process.exit(1);
  }

  const task = getTaskById(taskId);
  if (!task) {
    process.stderr.write(`Task #${taskId} not found.\n`);
    process.exit(1);
  }

  const learnings = extractLearnings(task);

  if (learnings.length === 0) {
    process.stdout.write(`No learnings extracted from task #${taskId}.\n`);
    return;
  }

  process.stdout.write(`Extracted ${learnings.length} learning(s) from task #${taskId}:\n\n`);
  for (const l of learnings) {
    process.stdout.write(`  [${l.domain}] ${l.key}\n    ${l.content.slice(0, 120)}...\n    importance=${l.importance} ttl=${l.ttl_days}d tags=${l.tags}\n\n`);
  }

  if (dryRun) {
    process.stdout.write("Dry run — nothing stored.\n");
    return;
  }

  const result = writeBackLearnings(task, task.cost_usd ?? 0, task.api_cost_usd ?? 0);
  process.stdout.write(`Stored: ${result.stored}, Duplicates skipped: ${result.duplicates}, Consolidated: ${result.consolidated}\n`);
}

function cmdMemory(args: string[]): void {
  const sub = args[0];
  if (sub === "search") {
    cmdMemorySearch(args.slice(1));
  } else if (sub === "search-skills") {
    cmdMemorySearchSkills(args.slice(1));
  } else if (sub === "add") {
    cmdMemoryAdd(args.slice(1));
  } else if (sub === "list") {
    cmdMemoryList(args.slice(1));
  } else if (sub === "delete") {
    cmdMemoryDelete(args.slice(1));
  } else if (sub === "expire") {
    cmdMemoryExpire();
  } else if (sub === "consolidate") {
    cmdMemoryConsolidate(args.slice(1));
  } else if (sub === "check-dedup") {
    cmdMemoryCheckDedup(args.slice(1));
  } else if (sub === "expensive") {
    cmdMemoryExpensive(args.slice(1));
  } else if (sub === "cost-by-domain") {
    cmdMemoryCostByDomain();
  } else if (sub === "cost-by-skill") {
    cmdMemoryCostBySkill();
  } else if (sub === "fleet-status") {
    cmdMemoryFleetStatus();
  } else if (sub === "write-back") {
    cmdMemoryWriteBack(args.slice(1));
  } else {
    process.stderr.write(`Usage: arc memory <search|search-skills|add|list|delete|expire|consolidate|check-dedup|expensive|cost-by-domain|cost-by-skill|fleet-status|write-back>\n`);
    process.exit(sub ? 1 : 0);
  }
}

// ---- Scratchpad commands ----

function cmdScratchpadRead(args: string[]): void {
  const { flags } = parseFlags(args);
  const taskId = parseInt(flags["task"] ?? "", 10);
  if (isNaN(taskId)) {
    process.stderr.write(`Error: --task is required\nUsage: ${USAGE.scratchpadRead}\n`);
    process.exit(1);
  }

  initDatabase();

  const task = getTaskById(taskId);
  if (!task) {
    process.stderr.write(`Error: task #${taskId} not found\n`);
    process.exit(1);
  }

  const rootId = resolveRootTaskId(taskId);
  const content = readScratchpad(taskId);
  if (!content) {
    process.stdout.write(`No scratchpad for task family #${rootId}\n`);
    return;
  }

  process.stdout.write(`--- Scratchpad for task family #${rootId} ---\n`);
  process.stdout.write(content);
  process.stdout.write("\n");
}

function cmdScratchpadWrite(args: string[]): void {
  const { flags } = parseFlags(args);
  const taskId = parseInt(flags["task"] ?? "", 10);
  const content = flags["content"];

  if (isNaN(taskId)) {
    process.stderr.write(`Error: --task is required\nUsage: ${USAGE.scratchpadWrite}\n`);
    process.exit(1);
  }
  if (!content) {
    process.stderr.write(`Error: --content is required\nUsage: ${USAGE.scratchpadWrite}\n`);
    process.exit(1);
  }

  initDatabase();
  const rootId = resolveRootTaskId(taskId);
  writeScratchpad(taskId, content);
  process.stdout.write(`Wrote scratchpad for task family #${rootId}\n`);
}

function cmdScratchpadAppend(args: string[]): void {
  const { flags } = parseFlags(args);
  const taskId = parseInt(flags["task"] ?? "", 10);
  const content = flags["content"];

  if (isNaN(taskId)) {
    process.stderr.write(`Error: --task is required\nUsage: ${USAGE.scratchpadAppend}\n`);
    process.exit(1);
  }
  if (!content) {
    process.stderr.write(`Error: --content is required\nUsage: ${USAGE.scratchpadAppend}\n`);
    process.exit(1);
  }

  initDatabase();
  const rootId = resolveRootTaskId(taskId);
  appendScratchpad(taskId, content);
  process.stdout.write(`Appended to scratchpad for task family #${rootId}\n`);
}

function cmdScratchpadClear(args: string[]): void {
  const { flags } = parseFlags(args);
  const taskId = parseInt(flags["task"] ?? "", 10);

  if (isNaN(taskId)) {
    process.stderr.write(`Error: --task is required\nUsage: ${USAGE.scratchpadClear}\n`);
    process.exit(1);
  }

  initDatabase();
  const rootId = resolveRootTaskId(taskId);
  clearScratchpad(taskId);
  process.stdout.write(`Cleared scratchpad for task family #${rootId}\n`);
}

function cmdScratchpad(args: string[]): void {
  const sub = args[0];
  if (sub === "read") {
    cmdScratchpadRead(args.slice(1));
  } else if (sub === "write") {
    cmdScratchpadWrite(args.slice(1));
  } else if (sub === "append") {
    cmdScratchpadAppend(args.slice(1));
  } else if (sub === "clear") {
    cmdScratchpadClear(args.slice(1));
  } else {
    process.stderr.write("Usage: arc scratchpad <read|write|append|clear>\n");
    process.exit(sub ? 1 : 0);
  }
}

function cmdHelp(): void {
  process.stdout.write(`arc - Loom (loom0) | Publisher agent | native to L1 + Stacks

USAGE
  arc <command> [options]

COMMANDS
  status
    Show task counts, completions, last cycle, usage stats (API-equivalent costs and tokens).

  tasks [--status STATUS] [--limit N]
    List tasks. Default: pending + active. --status filters to a single status.
    Valid statuses: pending, active, completed, failed, blocked.
    --limit defaults to 20.

  ${USAGE.tasksAdd}
    Create a new task. --model overrides priority-based model routing.
    --defer accepts durations like 30m, 2h, 1d, 1h30m. Past-due scheduled
    tasks automatically receive a +2 priority boost when dispatched.

  ${USAGE.tasksUpdate}
    Update a task's subject, description, priority, or model.

  ${USAGE.tasksClose}
    Close a task with a result summary.

  ${USAGE.tasksDeps}
    List all dependencies for a task (both directions).

  ${USAGE.tasksLink}
    Create a dependency link between two tasks.

  ${USAGE.tasksUnlink}
    Remove a dependency link between two tasks.

  creds list
    List stored credentials (service/key names only, no values).

  creds get --service NAME --key NAME
    Retrieve a credential value.

  creds set --service NAME --key NAME --value VALUE
    Add or update a credential.

  creds delete --service NAME --key NAME
    Remove a credential.

  creds unlock
    Verify password and show store path and credential count.

  run
    Trigger a single dispatch cycle.

  dispatch reset
    Reset the dispatch gate after a rate-limit or failure stop.
    Dispatch stops permanently on rate limits and emails whoabuddy.
    This command clears the stop and allows dispatch to resume.

  skills
    List all discovered skills. Columns: name, description, sensor, cli.

  ${USAGE.skillsShow}
    Print the full SKILL.md content for a skill.

  ${USAGE.skillsRun}
    Run a skill's cli.ts. Pass extra args after --.

  sensors
    Run all sensors once and exit.

  sensors list
    List discovered sensors (skills with sensor.ts).

  services install
    Install platform services (systemd on Linux, launchd on macOS).

  services uninstall
    Stop and remove platform services.

  services status
    Show service status.

  ${USAGE.memorySearch}
    Full-text search across arc_memory (FTS5 with Porter stemming).
    Query syntax: single words work directly; multi-word phrases need quotes: "dispatch gate"
    Boolean operators supported: OR, AND, NOT. Regex not supported.
    Use --syntax flag to display full FTS5 syntax guide with examples.

  ${USAGE.memoryAdd}
    Add a memory entry. --ttl sets auto-expiry in days. --importance 1-10 (1=critical).

  ${USAGE.memoryList}
    List memories, optionally filtered by domain.

  ${USAGE.memoryDelete}
    Delete a memory by key.

  ${USAGE.memorySearchSkills}
    Search indexed skill capabilities by keyword. Returns matching skills from arc_memory.

  ${USAGE.memoryExpire}
    Run TTL cleanup — removes memories past their expiry.

  ${USAGE.memoryConsolidate}
    Run full pruning pass — assign default TTLs, decay importance, expire, check domain budgets.

  ${USAGE.scratchpadRead}
    Read the project scratchpad for a task family.

  ${USAGE.scratchpadWrite}
    Overwrite the project scratchpad for a task family.

  ${USAGE.scratchpadAppend}
    Append to the project scratchpad for a task family.

  ${USAGE.scratchpadClear}
    Clear the project scratchpad for a task family.

  shutdown [--reason TEXT]
    Enter shutdown state. Sensors and dispatch skip while shutdown is active.
    Idempotent — safe to call multiple times.

  resume
    Exit shutdown state. Sensors and dispatch resume on next timer cycle.

  help
    Show this help message.

EXAMPLES
  arc status
  arc tasks
  arc tasks --status completed --limit 5
  arc tasks add --subject "research something" --priority 3 --source human
  arc tasks update --id 7 --priority 3 --subject "revised subject"
  arc tasks close --id 7 --status completed --summary "finished successfully"
  arc creds list
  arc creds set --service openrouter --key api-key --value sk-xxxx
  arc creds get --service openrouter --key api-key
  arc creds delete --service openrouter --key api-key
  arc memory search --query "dispatch"
  arc memory search --query '"dispatch gate"' --domain incidents
  arc memory search --query "cost OR expense" --limit 10
  arc memory search --syntax
  arc run
  arc skills
  arc skills show --name manage-skills
  arc skills run --name manage-skills -- create my-skill --description "Does X"
  arc sensors list
  arc sensors
  arc services install
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case "status":
      cmdStatus();
      break;
    case "tasks":
      cmdTasks(argv.slice(1));
      break;
    case "creds":
      await handleCredsCli(argv.slice(1));
      break;
    case "run":
      await cmdRun();
      break;
    case "dispatch":
      await cmdDispatch(argv.slice(1));
      break;
    case "memory":
      cmdMemory(argv.slice(1));
      break;
    case "skills":
      cmdSkills(argv.slice(1));
      break;
    case "sensors":
      await cmdSensors(argv.slice(1));
      break;
    case "services":
      await cmdServices(argv.slice(1));
      break;
    case "scratchpad":
      cmdScratchpad(argv.slice(1));
      break;
    case "shutdown":
      cmdShutdown(argv.slice(1));
      break;
    case "resume":
      cmdResume(argv.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      cmdHelp();
      break;
    default:
      process.stderr.write(`Error: unknown command '${cmd}'\n\n`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
