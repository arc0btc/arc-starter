#!/usr/bin/env bun

// skills/arc0btc-ask-service/cli.ts
//
// CLI for inspecting Ask Arc service state: pending/completed questions,
// daily rate limit usage (derived from DB), revenue by tier, and
// re-queuing stuck tasks.

import { parseFlags, pad, truncate } from "../../src/utils.ts";
import { initDatabase, getDatabase, updateTask } from "../../src/db.ts";

const ASK_DAILY_LIMIT = 20;

// Priority → tier mapping (mirrors web.ts ASK_TIERS)
const PRIORITY_TO_TIER: Record<number, { name: string; cost_sats: number }> = {
  8: { name: "haiku",  cost_sats: 250 },
  5: { name: "sonnet", cost_sats: 2500 },
  3: { name: "opus",   cost_sats: 10000 },
};

function printHelp(): void {
  process.stdout.write(
    [
      "arc0btc-ask-service CLI",
      "",
      "Usage: arc skills run --name arc0btc-ask-service -- <command> [flags]",
      "",
      "Commands:",
      "  list [--status STATUS] [--limit N]",
      "         List ask tasks (default: all statuses, limit 20)",
      "         STATUS: pending|active|completed|failed",
      "",
      "  stats  Show today's rate limit usage and revenue by tier",
      "",
      "  answer --id N",
      "         Re-queue a stuck/failed ask task back to pending",
      "",
      "  help   Show this help",
      "",
    ].join("\n"),
  );
}

function cmdList(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const status = flags["status"] ?? null;

  initDatabase();
  const db = getDatabase();

  let rows: Array<{
    id: number;
    priority: number;
    status: string;
    subject: string;
    model: string | null;
    created_at: string;
    completed_at: string | null;
    cost_usd: number;
  }>;

  if (status) {
    rows = db
      .query(
        `SELECT id, priority, status, subject, model, created_at, completed_at, cost_usd
         FROM tasks
         WHERE source = 'api:ask-arc' AND status = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(status, limit) as typeof rows;
  } else {
    rows = db
      .query(
        `SELECT id, priority, status, subject, model, created_at, completed_at, cost_usd
         FROM tasks
         WHERE source = 'api:ask-arc'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as typeof rows;
  }

  if (rows.length === 0) {
    process.stdout.write("No ask tasks found.\n");
    return;
  }

  const header =
    pad("id", 6) +
    pad("pri", 4) +
    pad("tier", 8) +
    pad("status", 12) +
    pad("subject", 48) +
    "created_at";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const row of rows) {
    const tierInfo = PRIORITY_TO_TIER[row.priority];
    const tierName = tierInfo?.name ?? `p${row.priority}`;
    const line =
      pad(String(row.id), 6) +
      pad(String(row.priority), 4) +
      pad(tierName, 8) +
      pad(row.status, 12) +
      pad(truncate(row.subject.replace(/^\[ask-arc\]\s*/, ""), 46), 48) +
      truncate(row.created_at, 16);
    process.stdout.write(line + "\n");
  }

  process.stdout.write(`\n${rows.length} ask task(s) shown.\n`);
}

function cmdStats(): void {
  initDatabase();
  const db = getDatabase();

  const today = new Date().toISOString().slice(0, 10);

  // Today's usage (UTC date match)
  const todayCount = (
    db
      .query(
        `SELECT COUNT(*) as count FROM tasks
         WHERE source = 'api:ask-arc'
           AND date(created_at) = date('now')`,
      )
      .get() as { count: number }
  ).count;

  process.stdout.write(
    [
      `Ask Arc — Rate Limit (${today} UTC)`,
      `  Used today:   ${todayCount} / ${ASK_DAILY_LIMIT}`,
      `  Remaining:    ${Math.max(0, ASK_DAILY_LIMIT - todayCount)}`,
      "",
    ].join("\n"),
  );

  // Revenue by tier (all time, estimated from cost_sats per priority)
  const tierRows = db
    .query(
      `SELECT priority, status, COUNT(*) as count
       FROM tasks
       WHERE source = 'api:ask-arc'
       GROUP BY priority, status
       ORDER BY priority ASC, status ASC`,
    )
    .all() as Array<{ priority: number; status: string; count: number }>;

  // Aggregate by tier
  const tierMap = new Map<
    string,
    { cost_sats: number; total: number; completed: number; pending: number; failed: number }
  >();

  for (const row of tierRows) {
    const tierInfo = PRIORITY_TO_TIER[row.priority];
    const name = tierInfo?.name ?? `p${row.priority}`;
    if (!tierMap.has(name)) {
      tierMap.set(name, { cost_sats: tierInfo?.cost_sats ?? 0, total: 0, completed: 0, pending: 0, failed: 0 });
    }
    const entry = tierMap.get(name)!;
    entry.total += row.count;
    if (row.status === "completed") entry.completed += row.count;
    else if (row.status === "pending" || row.status === "active") entry.pending += row.count;
    else if (row.status === "failed") entry.failed += row.count;
  }

  if (tierMap.size === 0) {
    process.stdout.write("No ask tasks recorded.\n");
    return;
  }

  process.stdout.write("Revenue by Tier (all time, estimated):\n");
  const header =
    pad("tier", 8) +
    pad("sats/q", 8) +
    pad("total", 7) +
    pad("done", 6) +
    pad("pend", 6) +
    pad("fail", 6) +
    "est. revenue (sats)";
  process.stdout.write("  " + header + "\n");
  process.stdout.write("  " + "-".repeat(header.length) + "\n");

  let grandTotal = 0;
  for (const [name, data] of tierMap) {
    const revenue = data.completed * data.cost_sats;
    grandTotal += revenue;
    const line =
      pad(name, 8) +
      pad(String(data.cost_sats), 8) +
      pad(String(data.total), 7) +
      pad(String(data.completed), 6) +
      pad(String(data.pending), 6) +
      pad(String(data.failed), 6) +
      `${revenue.toLocaleString()} sats`;
    process.stdout.write("  " + line + "\n");
  }

  process.stdout.write(
    `\n  Total estimated revenue: ${grandTotal.toLocaleString()} sats\n`,
  );
}

function cmdAnswer(args: string[]): void {
  const { flags } = parseFlags(args);
  const idStr = flags["id"];
  if (!idStr) {
    process.stderr.write("Error: --id N is required\n");
    process.exit(1);
  }
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    process.stderr.write(`Error: invalid id '${idStr}'\n`);
    process.exit(1);
  }

  initDatabase();
  const db = getDatabase();

  const task = db
    .query(`SELECT id, status, source, subject FROM tasks WHERE id = ?`)
    .get(id) as { id: number; status: string; source: string | null; subject: string } | null;

  if (!task) {
    process.stderr.write(`Error: task ${id} not found\n`);
    process.exit(1);
  }

  if (task.source !== "api:ask-arc") {
    process.stderr.write(`Error: task ${id} is not an ask task (source: ${task.source ?? "null"})\n`);
    process.exit(1);
  }

  if (task.status === "pending" || task.status === "active") {
    process.stdout.write(`Task ${id} is already ${task.status} — no action needed.\n`);
    return;
  }

  updateTask(id, { status: "pending" });
  process.stdout.write(`Task ${id} re-queued to pending: ${task.subject}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "list":
      cmdList(args.slice(1));
      break;
    case "stats":
      cmdStats();
      break;
    case "answer":
      cmdAnswer(args.slice(1));
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      process.stderr.write(`Error: unknown command '${command}'\n\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err}\n`);
  process.exit(1);
});
