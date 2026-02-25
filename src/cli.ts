#!/usr/bin/env bun

import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  initDatabase,
  getDatabase,
  insertTask,
  getPendingTasks,
  getActiveTasks,
  getRecentCycles,
  markTaskCompleted,
  markTaskFailed,
  getTaskById,
} from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { parseFlags, pad, truncate } from "./utils.ts";

// ---- Commands ----

function cmdStatus(): void {
  initDatabase();
  const db = getDatabase();

  const pendingCount = getPendingTasks().length;
  const activeCount = getActiveTasks().length;

  const cycles = getRecentCycles(1);
  const lastCycle = cycles.length > 0 ? cycles[0] : null;

  const costRow = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(api_cost_usd), 0) as api_total FROM tasks WHERE date(created_at) = date('now')"
    )
    .get() as { total: number; api_total: number };
  const costToday = costRow.total;
  const apiCostToday = costRow.api_total;

  const pendingStr = `pending: ${pendingCount}`;
  const activeStr = `active: ${activeCount}`;
  process.stdout.write(`${pendingStr}  ${activeStr}\n`);

  if (lastCycle) {
    const ts = lastCycle.started_at;
    const dur = lastCycle.duration_ms !== null ? `${lastCycle.duration_ms}ms` : "running";
    const cycleCost = lastCycle.cost_usd ? ` cost=$${lastCycle.cost_usd.toFixed(6)}` : "";
    process.stdout.write(`last cycle: ${ts} (${dur})${cycleCost}\n`);
  } else {
    process.stdout.write("last cycle: none\n");
  }

  process.stdout.write(
    `cost today: $${costToday.toFixed(4)} (actual) / $${apiCostToday.toFixed(4)} (api est)\n`
  );
  process.stdout.write("sensors: unknown\n");
}

function cmdTasksList(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 20;
  const statusFilter = flags["status"];

  initDatabase();
  const db = getDatabase();

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

function cmdTasksAdd(args: string[]): void {
  const { flags, positional } = parseFlags(args);

  const subject = positional[0];
  if (!subject) {
    process.stderr.write("Error: subject is required for 'tasks add'\n");
    process.exit(1);
  }

  const skillsRaw = flags["skills"];
  const skillsJson = skillsRaw
    ? JSON.stringify(skillsRaw.split(",").map((s) => s.trim()))
    : undefined;

  const parentRaw = flags["parent"];
  const parentId = parentRaw ? parseInt(parentRaw, 10) : undefined;

  const priorityRaw = flags["priority"];
  const priority = priorityRaw ? parseInt(priorityRaw, 10) : undefined;

  initDatabase();
  const id = insertTask({
    subject,
    description: flags["description"] ?? undefined,
    skills: skillsJson,
    priority,
    source: flags["source"] ?? undefined,
    parent_id: parentId,
  });

  process.stdout.write(`Created task #${id}: ${subject}\n`);
}

function cmdTasksClose(args: string[]): void {
  const { positional } = parseFlags(args);

  const rawId = positional[0];
  const status = positional[1];
  const summary = positional[2];

  if (!rawId || isNaN(parseInt(rawId, 10))) {
    process.stderr.write("Error: ID must be a number\n");
    process.exit(1);
  }
  if (status !== "completed" && status !== "failed") {
    process.stderr.write("Error: status must be 'completed' or 'failed'\n");
    process.exit(1);
  }
  if (!summary) {
    process.stderr.write("Error: summary is required\n");
    process.exit(1);
  }

  const id = parseInt(rawId, 10);
  initDatabase();

  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  if (status === "completed") {
    markTaskCompleted(id, summary);
  } else {
    markTaskFailed(id, summary);
  }

  process.stdout.write(`Closed task #${id} as ${status}\n`);
}

function cmdTasks(args: string[]): void {
  const sub = args[0];
  if (sub === "add") {
    cmdTasksAdd(args.slice(1));
  } else if (sub === "close") {
    cmdTasksClose(args.slice(1));
  } else {
    cmdTasksList(args);
  }
}

async function cmdRun(): Promise<void> {
  const { runDispatch } = await import("./dispatch.ts");
  initDatabase();
  await runDispatch();
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
  const name = args[0];
  if (!name) {
    process.stderr.write("Error: skill name is required\n");
    process.stderr.write("Usage: arc skills show <name>\n");
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
  const skillName = args[0];
  if (!skillName) {
    process.stderr.write("Error: skill name is required\n");
    process.stderr.write("Usage: arc skills run <name> [args]\n");
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
  const skillArgs = args.slice(1);

  const result = spawnSync("bun", [cliPath, ...skillArgs], {
    stdio: "inherit",
  });

  if (result.error) {
    process.stderr.write(`Error: failed to run skill CLI: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
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

function cmdHelp(): void {
  process.stdout.write(`arc - autonomous agent CLI

USAGE
  arc <command> [options]

COMMANDS
  status
    Show pending/active task counts, last cycle, cost today, sensor state.

  tasks [--status STATUS] [--limit N]
    List tasks. Default: pending + active. --status filters to a single status.
    Valid statuses: pending, active, completed, failed, blocked.
    --limit defaults to 20.

  tasks add "subject" [--description TEXT] [--priority N] [--source TEXT]
                      [--skills SKILL1,SKILL2] [--parent ID]
    Create a new task.

  tasks close ID completed|failed "summary"
    Close a task with a result summary.

  run
    Start the dispatch loop (not yet implemented).

  skills
    List all discovered skills. Columns: name, description, sensor, cli.

  skills show <name>
    Print the full SKILL.md content for a skill.

  skills run <name> [args]
    Run a skill's cli.ts with the given args.

  sensors
    Run all sensors once and exit.

  sensors list
    List discovered sensors (skills with sensor.ts).

  help
    Show this help message.

EXAMPLES
  arc status
  arc tasks
  arc tasks --status completed --limit 5
  arc tasks add "research something" --priority 3 --source human
  arc tasks close 7 completed "finished successfully"
  arc run
  arc skills
  arc skills show manage-skills
  arc skills run manage-skills create my-skill --description "Does X"
  arc sensors list
  arc sensors
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
    case "run":
      await cmdRun();
      break;
    case "skills":
      cmdSkills(argv.slice(1));
      break;
    case "sensors":
      await cmdSensors(argv.slice(1));
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
