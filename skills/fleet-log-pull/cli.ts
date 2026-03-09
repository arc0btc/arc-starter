#!/usr/bin/env bun

/**
 * fleet-log-pull CLI
 *
 * Pull cycle logs and task stats from fleet agent VMs.
 */

import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  resolveAgents,
} from "../../src/ssh.ts";

// ---- Helpers ----

function parseArgs(args: string[]): { agent?: string; limit: number } {
  let agent: string | undefined;
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      agent = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit) || limit < 1) limit = 10;
    }
  }
  return { agent, limit };
}

// ---- Cycles command ----

async function cmdCycles(args: string[]): Promise<void> {
  const { agent, limit } = parseArgs(args);
  const password = await getSshPassword();
  const agents = agent ? resolveAgents(agent) : Object.keys(AGENTS);

  for (const name of agents) {
    const ip = await getAgentIp(name);
    process.stdout.write(`\n${name} (${ip}) — last ${limit} cycles\n`);
    process.stdout.write("-".repeat(60) + "\n");

    const result = await ssh(
      ip,
      password,
      `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
        const { Database } = require('bun:sqlite');
        const db = new Database('db/arc.sqlite', { readonly: true });
        const rows = db.query(\`
          SELECT cl.id, cl.task_id, cl.started_at, cl.completed_at,
                 cl.duration_ms, cl.cost_usd, cl.api_cost_usd,
                 cl.tokens_in, cl.tokens_out, t.subject
          FROM cycle_log cl
          LEFT JOIN tasks t ON t.id = cl.task_id
          ORDER BY cl.id DESC LIMIT ${limit}
        \`).all();
        console.log(JSON.stringify(rows));
        db.close();
      " 2>/dev/null`,
    );

    if (!result.ok || !result.stdout.trim()) {
      process.stdout.write("  (unreachable or query failed)\n");
      continue;
    }

    try {
      const rows = JSON.parse(result.stdout) as Array<{
        id: number;
        task_id: number | null;
        started_at: string | null;
        completed_at: string | null;
        duration_ms: number | null;
        cost_usd: number | null;
        api_cost_usd: number | null;
        tokens_in: number | null;
        tokens_out: number | null;
        subject: string | null;
      }>;

      if (rows.length === 0) {
        process.stdout.write("  (no cycles found)\n");
        continue;
      }

      for (const r of rows) {
        const dur = r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "?";
        const cost = r.cost_usd != null ? `$${r.cost_usd.toFixed(3)}` : "$?";
        const subject = r.subject ? r.subject.slice(0, 50) : "(no task)";
        const completed = r.completed_at
          ? r.completed_at.replace("T", " ").slice(0, 19)
          : "in-progress";
        process.stdout.write(
          `  #${r.task_id ?? "?"} | ${completed} | ${dur} | ${cost} | ${subject}\n`,
        );
      }
    } catch {
      process.stdout.write("  (parse error)\n");
    }
  }
}

// ---- Stats command ----

async function cmdStats(args: string[]): Promise<void> {
  const { agent } = parseArgs(args);
  const password = await getSshPassword();
  const agents = agent ? resolveAgents(agent) : Object.keys(AGENTS);

  process.stdout.write(
    "\n| Agent | Pending | Active | Completed | Failed | Total | Cost 24h |\n",
  );
  process.stdout.write(
    "|-------|---------|--------|-----------|--------|-------|----------|\n",
  );

  for (const name of agents) {
    const ip = await getAgentIp(name);

    const result = await ssh(
      ip,
      password,
      `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
        const { Database } = require('bun:sqlite');
        const db = new Database('db/arc.sqlite', { readonly: true });
        const counts = db.query(\`
          SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status
        \`).all();
        const cost24h = db.query(\`
          SELECT COALESCE(SUM(cost_usd), 0) as total
          FROM cycle_log
          WHERE started_at > datetime('now', '-24 hours')
        \`).get();
        console.log(JSON.stringify({ counts, cost24h: cost24h.total }));
        db.close();
      " 2>/dev/null`,
    );

    if (!result.ok || !result.stdout.trim()) {
      process.stdout.write(`| ${name} | — | — | — | — | — | — |\n`);
      continue;
    }

    try {
      const data = JSON.parse(result.stdout) as {
        counts: Array<{ status: string; cnt: number }>;
        cost24h: number;
      };
      const get = (s: string): number =>
        data.counts.find((c) => c.status === s)?.cnt ?? 0;
      const total = data.counts.reduce((sum, c) => sum + c.cnt, 0);
      process.stdout.write(
        `| ${name} | ${get("pending")} | ${get("active")} | ${get("completed")} | ${get("failed")} | ${total} | $${data.cost24h.toFixed(2)} |\n`,
      );
    } catch {
      process.stdout.write(`| ${name} | — | — | — | — | — | — |\n`);
    }
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-log-pull — Pull cycle logs and task stats from fleet agents

Usage:
  arc skills run --name fleet-log-pull -- <command> [options]

Commands:
  cycles [--agent NAME] [--limit N]   Pull last N cycle_log entries (default 10)
  stats  [--agent NAME]               Pull task completion stats

Options:
  --agent NAME    Target a single agent (default: all)
  --limit N       Number of cycle entries to pull (default: 10)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "cycles":
      await cmdCycles(args.slice(1));
      break;
    case "stats":
      await cmdStats(args.slice(1));
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

main().catch((error: unknown) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
