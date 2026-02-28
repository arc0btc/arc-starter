#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initDatabase,
  insertTask,
  getPendingTasks,
  getActiveTasks,
  getRecentCycles,
  markTaskCompleted,
  markTaskFailed,
  markTaskBlocked,
  getTaskById,
  updateTask,
} from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { parseFlags, pad, truncate } from "./utils.ts";
import { handleCredsCli } from "../skills/credentials/cli.ts";

// CLI is hand-rolled — intentionally zero-dep. If the surface grows significantly,
// consider citty (https://github.com/unjs/citty) as a lightweight alternative to Commander.
// Worktree isolation test: task #304 — verify valid changes merge cleanly.

// ---- Commands ----

function cmdStatus(): void {
  const db = initDatabase();

  const pendingCount = getPendingTasks().length;
  const activeCount = getActiveTasks().length;

  const cycles = getRecentCycles(1);
  const lastCycle = cycles.length > 0 ? cycles[0] : null;

  const { total: costToday, api_total: apiCostToday } = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(api_cost_usd), 0) as api_total FROM tasks WHERE date(created_at) = date('now')"
    )
    .get() as { total: number; api_total: number };

  process.stdout.write(`pending: ${pendingCount}  active: ${activeCount}\n`);

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

function cmdTasksAdd(args: string[]): void {
  const { flags } = parseFlags(args);

  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write("Error: --subject is required for 'tasks add'\n");
    process.stderr.write("Usage: arc tasks add --subject \"text\" [--description TEXT] [--priority N] [--source TEXT] [--skills S1,S2] [--parent ID]\n");
    process.exit(1);
  }

  const skillsJson = flags["skills"]
    ? JSON.stringify(flags["skills"].split(",").map((s) => s.trim()))
    : undefined;
  const parentId = flags["parent"] ? parseInt(flags["parent"], 10) : undefined;
  const priority = flags["priority"] ? parseInt(flags["priority"], 10) : undefined;

  initDatabase();
  const id = insertTask({
    subject,
    description: flags["description"],
    skills: skillsJson,
    priority,
    source: flags["source"],
    parent_id: parentId,
  });

  process.stdout.write(`Created task #${id}: ${subject}\n`);
}

function cmdTasksClose(args: string[]): void {
  const { flags } = parseFlags(args);
  const usage = 'Usage: arc tasks close --id N --status completed|failed|blocked --summary "text"\n';

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
  const usage =
    'Usage: arc tasks update --id N [--subject TEXT] [--description TEXT] [--priority N]\n';

  const id = parseInt(flags["id"] ?? "", 10);
  if (isNaN(id)) {
    process.stderr.write("Error: --id must be a number\n" + usage);
    process.exit(1);
  }

  const subject = flags["subject"];
  const description = flags["description"];
  const priority = flags["priority"] ? parseInt(flags["priority"], 10) : undefined;

  if (priority !== undefined && isNaN(priority)) {
    process.stderr.write("Error: --priority must be a number\n" + usage);
    process.exit(1);
  }

  if (subject === undefined && description === undefined && priority === undefined) {
    process.stderr.write(
      "Error: at least one of --subject, --description, or --priority is required\n" + usage
    );
    process.exit(1);
  }

  initDatabase();

  const task = getTaskById(id);
  if (!task) {
    process.stderr.write(`Error: task #${id} not found\n`);
    process.exit(1);
  }

  updateTask(id, { subject, description, priority });

  const updated: string[] = [];
  if (subject !== undefined) updated.push("subject");
  if (description !== undefined) updated.push("description");
  if (priority !== undefined) updated.push("priority");
  process.stdout.write(`Updated task #${id}: ${updated.join(", ")}\n`);
}

function cmdTasks(args: string[]): void {
  const sub = args[0];
  if (sub === "add") {
    cmdTasksAdd(args.slice(1));
  } else if (sub === "close") {
    cmdTasksClose(args.slice(1));
  } else if (sub === "update") {
    cmdTasksUpdate(args.slice(1));
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
  const { flags } = parseFlags(args);
  const name = flags["name"];
  if (!name) {
    process.stderr.write("Error: --name is required\n");
    process.stderr.write("Usage: arc skills show --name <name>\n");
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
    process.stderr.write("Error: --name is required\n");
    process.stderr.write("Usage: arc skills run --name <name> [-- extra-args]\n");
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

  tasks add --subject TEXT [--description TEXT] [--priority N] [--source TEXT]
            [--skills SKILL1,SKILL2] [--parent ID]
    Create a new task.

  tasks update --id N [--subject TEXT] [--description TEXT] [--priority N]
    Update a task's subject, description, or priority.

  tasks close --id N --status completed|failed|blocked --summary TEXT
    Close a task with a result summary.

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

  skills
    List all discovered skills. Columns: name, description, sensor, cli.

  skills show --name NAME
    Print the full SKILL.md content for a skill.

  skills run --name NAME [-- extra-args]
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
  arc creds set --service openrouter --key api_key --value sk-xxxx
  arc creds get --service openrouter --key api_key
  arc creds delete --service openrouter --key api_key
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
    case "skills":
      cmdSkills(argv.slice(1));
      break;
    case "sensors":
      await cmdSensors(argv.slice(1));
      break;
    case "services":
      await cmdServices(argv.slice(1));
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
