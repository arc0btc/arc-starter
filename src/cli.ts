#!/usr/bin/env bun

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

// ---- Arg parsing helper ----

interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = "true";
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { flags, positional };
}

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
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE date(created_at) = date('now')"
    )
    .get() as { total: number };
  const costToday = costRow.total;

  const pendingStr = `pending: ${pendingCount}`;
  const activeStr = `active: ${activeCount}`;
  process.stdout.write(`${pendingStr}  ${activeStr}\n`);

  if (lastCycle) {
    const ts = lastCycle.started_at;
    const dur = lastCycle.duration_ms !== null ? `${lastCycle.duration_ms}ms` : "running";
    process.stdout.write(`last cycle: ${ts} (${dur})\n`);
  } else {
    process.stdout.write("last cycle: none\n");
  }

  process.stdout.write(`cost today: $${costToday.toFixed(4)}\n`);
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

function cmdRun(): void {
  process.stdout.write("Dispatch not yet implemented. See Phase 5.\n");
}

function cmdSkills(): void {
  process.stdout.write("Skills not yet implemented. See Phase 4.\n");
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
    Manage skills (not yet implemented).

  help
    Show this help message.

EXAMPLES
  arc status
  arc tasks
  arc tasks --status completed --limit 5
  arc tasks add "research something" --priority 3 --source human
  arc tasks close 7 completed "finished successfully"
  arc run
`);
}

// ---- String helpers ----

function pad(s: string, width: number): string {
  return s.length >= width ? s + " " : s + " ".repeat(width - s.length);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "~" : s;
}

// ---- Entry point ----

function main(): void {
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
      cmdRun();
      break;
    case "skills":
      cmdSkills();
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

main();
