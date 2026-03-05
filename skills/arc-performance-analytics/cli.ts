#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { parseFlags } from "../../src/utils";

const ROOT = join(import.meta.dir, "../..");
const DB_PATH = join(ROOT, "db/arc.sqlite");

function getDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

type ModelTier = "opus" | "sonnet" | "haiku";

function tierFromPriority(priority: number): ModelTier {
  if (priority <= 4) return "opus";
  if (priority <= 7) return "sonnet";
  return "haiku";
}

function effectiveTier(model: string | null, priority: number): ModelTier {
  if (model === "opus" || model === "sonnet" || model === "haiku") return model;
  return tierFromPriority(priority);
}

function periodClause(period: string): string {
  switch (period) {
    case "today":
      return "date(completed_at) = date('now')";
    case "week":
      return "completed_at >= datetime('now', '-7 days')";
    case "month":
      return "completed_at >= datetime('now', '-30 days')";
    case "all":
      return "1=1";
    default:
      return "date(completed_at) = date('now')";
  }
}

function fmt(n: number, decimals: number = 4): string {
  return n.toFixed(decimals);
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function padLeft(s: string, width: number): string {
  return s.padStart(width);
}

// ---- Subcommands ----

interface TierRow {
  tier: string;
  task_count: number;
  total_cost: number;
  total_api_cost: number;
  total_tokens_in: number;
  total_tokens_out: number;
  avg_cost: number;
  avg_duration_ms: number;
}

function cmdSummary(args: string[]): void {
  const { flags } = parseFlags(args);
  const period = flags["period"] || "today";
  const db = getDb();

  // Query completed tasks with cost data
  const rows = db
    .query(
      `SELECT
        id, priority, model, cost_usd, api_cost_usd,
        tokens_in, tokens_out, status
      FROM tasks
      WHERE status IN ('completed', 'failed')
        AND ${periodClause(period)}`
    )
    .all() as Array<{
      id: number;
      priority: number;
      model: string | null;
      cost_usd: number;
      api_cost_usd: number;
      tokens_in: number;
      tokens_out: number;
      status: string;
    }>;

  // Aggregate by tier
  const tiers: Record<ModelTier, TierRow> = {
    opus: { tier: "Opus (P1-4)", task_count: 0, total_cost: 0, total_api_cost: 0, total_tokens_in: 0, total_tokens_out: 0, avg_cost: 0, avg_duration_ms: 0 },
    sonnet: { tier: "Sonnet (P5-7)", task_count: 0, total_cost: 0, total_api_cost: 0, total_tokens_in: 0, total_tokens_out: 0, avg_cost: 0, avg_duration_ms: 0 },
    haiku: { tier: "Haiku (P8+)", task_count: 0, total_cost: 0, total_api_cost: 0, total_tokens_in: 0, total_tokens_out: 0, avg_cost: 0, avg_duration_ms: 0 },
  };

  for (const row of rows) {
    const tier = effectiveTier(row.model, row.priority);
    tiers[tier].task_count += 1;
    tiers[tier].total_cost += row.cost_usd;
    tiers[tier].total_api_cost += row.api_cost_usd;
    tiers[tier].total_tokens_in += row.tokens_in;
    tiers[tier].total_tokens_out += row.tokens_out;
  }

  // Get duration data from cycle_log
  const cycles = db
    .query(
      `SELECT c.task_id, c.duration_ms, c.model as cycle_model, t.priority
      FROM cycle_log c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE t.status IN ('completed', 'failed')
        AND ${periodClause(period).replace("completed_at", "t.completed_at")}`
    )
    .all() as Array<{
      task_id: number | null;
      duration_ms: number | null;
      cycle_model: string | null;
      priority: number;
    }>;

  const durationSums: Record<ModelTier, { total: number; count: number }> = {
    opus: { total: 0, count: 0 },
    sonnet: { total: 0, count: 0 },
    haiku: { total: 0, count: 0 },
  };

  for (const c of cycles) {
    if (c.duration_ms === null) continue;
    const tier = effectiveTier(c.cycle_model, c.priority);
    durationSums[tier].total += c.duration_ms;
    durationSums[tier].count += 1;
  }

  for (const t of (["opus", "sonnet", "haiku"] as const)) {
    const d = durationSums[t];
    tiers[t].avg_duration_ms = d.count > 0 ? d.total / d.count : 0;
    const r = tiers[t];
    r.avg_cost = r.task_count > 0 ? r.total_cost / r.task_count : 0;
  }

  // Total
  const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0);
  const totalApiCost = rows.reduce((s, r) => s + r.api_cost_usd, 0);
  const totalIn = rows.reduce((s, r) => s + r.tokens_in, 0);
  const totalOut = rows.reduce((s, r) => s + r.tokens_out, 0);

  // Output
  process.stdout.write(`\nPerformance Summary — ${period}\n`);
  process.stdout.write(`${"=".repeat(80)}\n\n`);

  // Header
  process.stdout.write(
    `${pad("Model Tier", 16)} ${padLeft("Tasks", 6)} ${padLeft("Cost ($)", 10)} ${padLeft("API Est ($)", 12)} ${padLeft("Tokens In", 12)} ${padLeft("Tokens Out", 12)} ${padLeft("Avg Cost", 10)} ${padLeft("Avg Dur", 8)}\n`
  );
  process.stdout.write(`${"-".repeat(86)}\n`);

  for (const t of (["opus", "sonnet", "haiku"] as const)) {
    const r = tiers[t];
    const avgDur = r.avg_duration_ms > 0 ? `${Math.round(r.avg_duration_ms / 1000)}s` : "-";
    process.stdout.write(
      `${pad(r.tier, 16)} ${padLeft(String(r.task_count), 6)} ${padLeft(`$${fmt(r.total_cost)}`, 10)} ${padLeft(`$${fmt(r.total_api_cost)}`, 12)} ${padLeft(fmtInt(r.total_tokens_in), 12)} ${padLeft(fmtInt(r.total_tokens_out), 12)} ${padLeft(`$${fmt(r.avg_cost)}`, 10)} ${padLeft(avgDur, 8)}\n`
    );
  }

  process.stdout.write(`${"-".repeat(86)}\n`);
  process.stdout.write(
    `${pad("TOTAL", 16)} ${padLeft(String(rows.length), 6)} ${padLeft(`$${fmt(totalCost)}`, 10)} ${padLeft(`$${fmt(totalApiCost)}`, 12)} ${padLeft(fmtInt(totalIn), 12)} ${padLeft(fmtInt(totalOut), 12)} ${padLeft("", 10)} ${padLeft("", 8)}\n`
  );

  // Budget usage (only show for today)
  if (period === "today") {
    process.stdout.write(`\nDaily budget: $200.00 | Used: $${fmt(totalCost, 2)} (${fmt((totalCost / 200) * 100, 1)}%)\n`);
  }
  process.stdout.write("\n");

  db.close();
}

function cmdBySkill(args: string[]): void {
  const { flags } = parseFlags(args);
  const period = flags["period"] || "today";
  const limit = parseInt(flags["limit"] || "20", 10);
  const db = getDb();

  const rows = db
    .query(
      `SELECT
        id, skills, cost_usd, api_cost_usd,
        tokens_in, tokens_out, priority, model
      FROM tasks
      WHERE status IN ('completed', 'failed')
        AND ${periodClause(period)}
        AND skills IS NOT NULL AND skills != '[]'`
    )
    .all() as Array<{
      id: number;
      skills: string;
      cost_usd: number;
      api_cost_usd: number;
      tokens_in: number;
      tokens_out: number;
      priority: number;
      model: string | null;
    }>;

  // Aggregate by skill
  const skillMap: Record<string, {
    task_count: number;
    total_cost: number;
    total_api_cost: number;
    total_tokens_in: number;
    total_tokens_out: number;
  }> = {};

  for (const row of rows) {
    let skillList: string[];
    try {
      skillList = JSON.parse(row.skills);
    } catch {
      continue;
    }
    if (!Array.isArray(skillList)) continue;

    for (const skill of skillList) {
      if (!skillMap[skill]) {
        skillMap[skill] = { task_count: 0, total_cost: 0, total_api_cost: 0, total_tokens_in: 0, total_tokens_out: 0 };
      }
      // Split cost evenly across skills for multi-skill tasks
      const share = 1 / skillList.length;
      skillMap[skill].task_count += 1;
      skillMap[skill].total_cost += row.cost_usd * share;
      skillMap[skill].total_api_cost += row.api_cost_usd * share;
      skillMap[skill].total_tokens_in += Math.round(row.tokens_in * share);
      skillMap[skill].total_tokens_out += Math.round(row.tokens_out * share);
    }
  }

  // Sort by cost descending
  const sorted = Object.entries(skillMap)
    .sort((a, b) => b[1].total_cost - a[1].total_cost)
    .slice(0, limit);

  process.stdout.write(`\nCost by Skill — ${period}\n`);
  process.stdout.write(`${"=".repeat(76)}\n\n`);

  process.stdout.write(
    `${pad("Skill", 28)} ${padLeft("Tasks", 6)} ${padLeft("Cost ($)", 10)} ${padLeft("API Est ($)", 12)} ${padLeft("Tokens In", 12)} ${padLeft("Tokens Out", 12)}\n`
  );
  process.stdout.write(`${"-".repeat(80)}\n`);

  for (const [skill, data] of sorted) {
    process.stdout.write(
      `${pad(skill.length > 27 ? skill.slice(0, 26) + "~" : skill, 28)} ${padLeft(String(data.task_count), 6)} ${padLeft(`$${fmt(data.total_cost)}`, 10)} ${padLeft(`$${fmt(data.total_api_cost)}`, 12)} ${padLeft(fmtInt(data.total_tokens_in), 12)} ${padLeft(fmtInt(data.total_tokens_out), 12)}\n`
    );
  }

  if (sorted.length === 0) {
    process.stdout.write("  (no skill-tagged tasks in this period)\n");
  }

  // Tasks without skills
  const noSkillRows = db
    .query(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as cnt
      FROM tasks
      WHERE status IN ('completed', 'failed')
        AND ${periodClause(period)}
        AND (skills IS NULL OR skills = '[]')`
    )
    .get() as { cost: number; cnt: number };

  if (noSkillRows.cnt > 0) {
    process.stdout.write(`\n  + ${noSkillRows.cnt} task(s) without skills: $${fmt(noSkillRows.cost)}\n`);
  }

  process.stdout.write("\n");
  db.close();
}

function cmdCycles(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = parseInt(flags["limit"] || "15", 10);
  const db = getDb();

  const rows = db
    .query(
      `SELECT
        c.id, c.task_id, c.started_at, c.duration_ms,
        c.cost_usd, c.api_cost_usd, c.tokens_in, c.tokens_out,
        c.model, c.skills_loaded,
        t.subject, t.priority
      FROM cycle_log c
      LEFT JOIN tasks t ON c.task_id = t.id
      ORDER BY c.started_at DESC
      LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      task_id: number | null;
      started_at: string;
      duration_ms: number | null;
      cost_usd: number;
      api_cost_usd: number;
      tokens_in: number;
      tokens_out: number;
      model: string | null;
      skills_loaded: string | null;
      subject: string | null;
      priority: number | null;
    }>;

  process.stdout.write(`\nRecent Cycles (last ${limit})\n`);
  process.stdout.write(`${"=".repeat(100)}\n\n`);

  process.stdout.write(
    `${pad("Time", 20)} ${padLeft("Task", 5)} ${pad("Model", 8)} ${padLeft("Dur", 6)} ${padLeft("Cost", 9)} ${padLeft("Tok In", 10)} ${padLeft("Tok Out", 10)}  Subject\n`
  );
  process.stdout.write(`${"-".repeat(100)}\n`);

  for (const row of rows) {
    const time = row.started_at.replace("T", " ").slice(0, 19);
    const taskId = row.task_id !== null ? `#${row.task_id}` : "-";
    const model = row.model || (row.priority !== null ? effectiveTier(null, row.priority) : "?");
    const dur = row.duration_ms !== null ? `${Math.round(row.duration_ms / 1000)}s` : "-";
    const subject = row.subject ? (row.subject.length > 30 ? row.subject.slice(0, 29) + "~" : row.subject) : "-";

    process.stdout.write(
      `${pad(time, 20)} ${padLeft(taskId, 5)} ${pad(model, 8)} ${padLeft(dur, 6)} ${padLeft(`$${fmt(row.cost_usd)}`, 9)} ${padLeft(fmtInt(row.tokens_in), 10)} ${padLeft(fmtInt(row.tokens_out), 10)}  ${subject}\n`
    );
  }

  process.stdout.write("\n");
  db.close();
}

function printUsage(): void {
  process.stdout.write(`performance-analytics CLI

USAGE
  arc skills run --name performance-analytics -- <subcommand> [flags]

SUBCOMMANDS
  summary [--period today|week|month|all]
    Cost/token totals by model tier for the given period.

  by-skill [--period today|week|month|all] [--limit N]
    Cost/token breakdown per skill. Default limit: 20.

  cycles [--limit N]
    Recent dispatch cycles with model, duration, cost, tokens.

  help
    Print this message.

EXAMPLES
  arc skills run --name performance-analytics -- summary
  arc skills run --name performance-analytics -- summary --period week
  arc skills run --name performance-analytics -- by-skill --period month --limit 10
  arc skills run --name performance-analytics -- cycles --limit 25
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "summary":
      cmdSummary(args.slice(1));
      break;
    case "by-skill":
      cmdBySkill(args.slice(1));
      break;
    case "cycles":
      cmdCycles(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
