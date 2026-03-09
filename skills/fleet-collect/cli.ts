#!/usr/bin/env bun

/**
 * fleet-collect CLI
 *
 * Gather completed task results from all fleet agents for a topic.
 * Queries remote SQLite databases via SSH in parallel.
 */

import { parseFlags } from "../../src/utils.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  resolveAgents,
} from "../../src/ssh.ts";

// ---- Types ----

interface RemoteTask {
  id: number;
  subject: string;
  status: string;
  priority: number;
  result_summary: string | null;
  result_detail: string | null;
  cost_usd: number | null;
  completed_at: string | null;
}

interface CollectResult {
  agent: string;
  ok: boolean;
  tasks: RemoteTask[];
  error?: string;
}

// ---- Core: query one agent ----

async function queryAgent(
  agent: string,
  password: string,
  topic: string,
  status: string,
  limit: number,
  includeDetail: boolean
): Promise<CollectResult> {
  try {
    const ip = await getAgentIp(agent);
    const escTopic = topic.replace(/'/g, "'\\''");

    const columns = includeDetail
      ? "id, subject, status, priority, result_summary, result_detail, cost_usd, completed_at"
      : "id, subject, status, priority, result_summary, cost_usd, completed_at";

    // Build WHERE clause: topic match + optional status filter
    let whereClause = `subject LIKE '%' || ?1 || '%'`;
    if (status !== "any") {
      const escStatus = status.replace(/'/g, "'\\''");
      whereClause += ` AND status = '${escStatus}'`;
    }

    const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      import { Database } from 'bun:sqlite';
      const db = new Database('db/arc.sqlite', { readonly: true });
      const rows = db.query('SELECT ${columns} FROM tasks WHERE ${whereClause} ORDER BY id DESC LIMIT ${limit}').all('${escTopic}');
      console.log(JSON.stringify(rows));
    "`;

    const result = await ssh(ip, password, remoteCmd);
    if (!result.ok) {
      return {
        agent,
        ok: false,
        tasks: [],
        error: result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`,
      };
    }

    const tasks: RemoteTask[] = JSON.parse(result.stdout.trim());
    return { agent, ok: true, tasks };
  } catch (error) {
    return {
      agent,
      ok: false,
      tasks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- Output ----

function printSearchResults(results: CollectResult[]): void {
  let totalTasks = 0;

  for (const r of results) {
    process.stdout.write(`\n--- ${r.agent} ---\n`);

    if (!r.ok) {
      process.stdout.write(`  ERROR: ${r.error}\n`);
      continue;
    }

    if (r.tasks.length === 0) {
      process.stdout.write(`  No matching tasks\n`);
      continue;
    }

    totalTasks += r.tasks.length;
    for (const t of r.tasks) {
      const cost = t.cost_usd ? ` ($${t.cost_usd.toFixed(3)})` : "";
      const completed = t.completed_at ? ` [${t.completed_at}]` : "";
      process.stdout.write(
        `  #${t.id} [${t.status}] P${t.priority}: ${t.subject}${cost}${completed}\n`
      );
      if (t.result_summary) {
        process.stdout.write(`    Summary: ${t.result_summary}\n`);
      }
    }
  }

  const ok = results.filter((r) => r.ok).length;
  process.stdout.write(
    `\n${totalTasks} task(s) found across ${ok}/${results.length} agent(s)\n`
  );
}

function printDetailResults(results: CollectResult[]): void {
  let totalTasks = 0;

  for (const r of results) {
    process.stdout.write(`\n${"=".repeat(60)}\n`);
    process.stdout.write(`  AGENT: ${r.agent}\n`);
    process.stdout.write(`${"=".repeat(60)}\n`);

    if (!r.ok) {
      process.stdout.write(`  ERROR: ${r.error}\n`);
      continue;
    }

    if (r.tasks.length === 0) {
      process.stdout.write(`  No matching tasks\n`);
      continue;
    }

    totalTasks += r.tasks.length;
    for (const t of r.tasks) {
      const cost = t.cost_usd ? ` ($${t.cost_usd.toFixed(3)})` : "";
      process.stdout.write(`\n  #${t.id} [${t.status}] P${t.priority}: ${t.subject}${cost}\n`);
      if (t.completed_at) process.stdout.write(`  Completed: ${t.completed_at}\n`);
      process.stdout.write(`\n  --- Summary ---\n`);
      process.stdout.write(`  ${t.result_summary ?? "(none)"}\n`);
      process.stdout.write(`\n  --- Detail ---\n`);
      // Truncate long details to keep output readable
      const detail = t.result_detail ?? "(none)";
      const maxLen = 2000;
      if (detail.length > maxLen) {
        process.stdout.write(`  ${detail.slice(0, maxLen)}\n  ... (truncated, ${detail.length} chars total)\n`);
      } else {
        process.stdout.write(`  ${detail}\n`);
      }
      process.stdout.write(`\n  ${"-".repeat(40)}\n`);
    }
  }

  const ok = results.filter((r) => r.ok).length;
  process.stdout.write(
    `\n${totalTasks} task(s) collected from ${ok}/${results.length} agent(s)\n`
  );
}

// ---- Subcommands ----

async function cmdSearch(agents: string[], flags: Record<string, string>): Promise<void> {
  const topic = flags["topic"];
  if (!topic) {
    process.stderr.write("Error: --topic <keyword> required\n");
    process.exit(1);
  }

  const limit = parseInt(flags["limit"] ?? "5", 10);
  const status = flags["status"] ?? "completed";
  const password = await getSshPassword();

  process.stdout.write(`Collecting '${topic}' results from ${agents.length} agent(s): ${agents.join(", ")}\n`);
  process.stdout.write(`  Status: ${status}, Limit: ${limit}/agent\n`);

  const results = await Promise.allSettled(
    agents.map((agent) => queryAgent(agent, password, topic, status, limit, false))
  );

  const resolved: CollectResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      tasks: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printSearchResults(resolved);
}

async function cmdDetail(agents: string[], flags: Record<string, string>): Promise<void> {
  const topic = flags["topic"];
  if (!topic) {
    process.stderr.write("Error: --topic <keyword> required\n");
    process.exit(1);
  }

  const limit = parseInt(flags["limit"] ?? "3", 10);
  const status = flags["status"] ?? "completed";
  const password = await getSshPassword();

  process.stdout.write(`Collecting '${topic}' details from ${agents.length} agent(s): ${agents.join(", ")}\n`);
  process.stdout.write(`  Status: ${status}, Limit: ${limit}/agent\n`);

  const results = await Promise.allSettled(
    agents.map((agent) => queryAgent(agent, password, topic, status, limit, true))
  );

  const resolved: CollectResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      tasks: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printDetailResults(resolved);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-collect — Gather task results from all agents for a topic

Usage:
  arc skills run --name fleet-collect -- <command> [options]

Commands:
  search   Find matching tasks across agents (summaries only)
           --topic <keyword>      Subject keyword to match (required)
           --status <status>      Filter by status (default: completed, use 'any' for all)
           --limit <n>            Max results per agent (default: 5)

  detail   Collect full task details across agents
           --topic <keyword>      Subject keyword to match (required)
           --status <status>      Filter by status (default: completed, use 'any' for all)
           --limit <n>            Max results per agent (default: 3)

Options:
  --agents spark,iris   Comma-separated agent list (default: all)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  let agents: string[];
  try {
    agents = resolveAgents(flags["agents"]);
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }

  switch (sub) {
    case "search":
      await cmdSearch(agents, flags);
      break;
    case "detail":
      await cmdDetail(agents, flags);
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
    `Error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
