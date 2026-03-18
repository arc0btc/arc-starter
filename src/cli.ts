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
  getServiceLogs,
} from "./db.ts";
import type { TaskDepType } from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { parseFlags, pad, truncate } from "./utils.ts";
import { handleCredsCli } from "../skills/arc-credentials/cli.ts";
import { enterShutdown, exitShutdown, getShutdownState } from "./shutdown.ts";

// CLI is hand-rolled — intentionally zero-dep. If the surface grows significantly,
// consider citty (https://github.com/unjs/citty) as a lightweight alternative to Commander.

// ---- Usage strings (shared between error messages and cmdHelp) ----

const USAGE = {
  tasksAdd:
    'arc tasks add --subject TEXT [--description TEXT] [--priority N] [--source TEXT]\n' +
    '              [--skills SKILL1,SKILL2] [--parent ID] [--model opus|sonnet|haiku|codex|codex:<model>]\n' +
    '              [--defer DURATION | --scheduled-for ISO_DATETIME]',
  tasksUpdate:
    'arc tasks update --id N [--subject TEXT] [--description TEXT] [--priority N] [--model opus|sonnet|haiku|codex|codex:<model>] [--status pending]',
  tasksClose:
    'arc tasks close --id N --status completed|failed|blocked --summary TEXT',
  tasksDeps: 'arc tasks deps --id N',
  tasksLink: 'arc tasks link --from N --to M --type blocks|related|discovered-from',
  tasksUnlink: 'arc tasks unlink --from N --to M --type blocks|related|discovered-from',
  skillsShow: 'arc skills show --name NAME',
  skillsRun:  'arc skills run --name NAME [-- extra-args]',
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

  if (priority !== undefined && isNaN(priority)) {
    process.stderr.write("Error: --priority must be a number\n" + usage);
    process.exit(1);
  }

  if (status !== undefined && status !== "pending") {
    process.stderr.write("Error: --status only supports 'pending' (to requeue blocked/failed tasks)\n" + usage);
    process.exit(1);
  }

  if (subject === undefined && description === undefined && priority === undefined && model === undefined && status === undefined) {
    process.stderr.write(
      "Error: at least one of --subject, --description, --priority, --model, or --status is required\n" + usage
    );
    process.exit(1);
  }

  initDatabase();

  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  if (subject !== undefined || description !== undefined || priority !== undefined || model !== undefined) {
    updateTask(id, { subject, description, priority, model });
  }
  if (status === "pending") {
    requeueTask(id);
  }

  const updated: string[] = [];
  if (subject !== undefined) updated.push("subject");
  if (description !== undefined) updated.push("description");
  if (priority !== undefined) updated.push("priority");
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

function cmdLogs(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 50;
  const level = flags["level"];
  const service = flags["service"];
  const taskId = flags["task"] ? parseInt(flags["task"], 10) : undefined;

  initDatabase();

  const rows = getServiceLogs({ limit, level, service, task_id: taskId });

  if (rows.length === 0) {
    process.stdout.write("No log entries found.\n");
    return;
  }

  for (const row of rows) {
    const task = row.task_id != null ? ` task=#${row.task_id}` : "";
    process.stdout.write(`${row.created_at} [${row.level.toUpperCase()}] ${row.service}${task}: ${row.message}\n`);
  }
}

function cmdHelp(): void {
  process.stdout.write(`arc - Bitcoin agent (arc0.btc) | native to L1 + Stacks

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

  shutdown [--reason TEXT]
    Enter shutdown state. Sensors and dispatch skip while shutdown is active.
    Idempotent — safe to call multiple times.

  resume
    Exit shutdown state. Sensors and dispatch resume on next timer cycle.

  logs [--limit N] [--level info|warn|error] [--service NAME] [--task ID]
    Show structured service log events (dispatch task lifecycle, errors, retries).

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
  arc run
  arc skills
  arc skills show --name arc-skill-manager
  arc skills run --name arc-skill-manager -- create my-skill --description "Does X"
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
    case "skills":
      cmdSkills(argv.slice(1));
      break;
    case "sensors":
      await cmdSensors(argv.slice(1));
      break;
    case "services":
      await cmdServices(argv.slice(1));
      break;
    case "logs":
      cmdLogs(argv.slice(1));
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
