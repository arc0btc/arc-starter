#!/usr/bin/env bun

/**
 * fleet-router CLI
 *
 * Preview and execute task routing from Arc to fleet agents.
 */

import { parseFlags } from "../../src/utils.ts";
import { initDatabase, getPendingTasks, markTaskCompleted } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { routeTask } from "./sensor.ts";
import type { RoutingDecision } from "./sensor.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// ---- Fleet health reader ----

function readHealthyAgents(): Set<string> {
  const healthy = new Set<string>();
  try {
    const memDir = new URL("../../memory", import.meta.url).pathname;
    const content = readFileSync(join(memDir, "fleet-status.md"), "utf-8");
    for (const agent of Object.keys(AGENTS)) {
      const re = new RegExp(`\\|\\s*${agent}\\s*\\|\\s*yes\\s*\\|`);
      if (re.test(content)) {
        healthy.add(agent);
      }
    }
  } catch {
    // No fleet-status.md
  }
  return healthy;
}

async function getRemoteBacklog(
  agent: string,
  password: string,
): Promise<number> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return 999;
  }

  const result = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'pending\\\\'').get();
      console.log(row?.c ?? 0);
      db.close();
    " 2>/dev/null || echo "999"`
  );

  return parseInt(result.stdout.trim()) || 999;
}

async function sendToAgent(
  agent: string,
  task: Task,
  password: string,
): Promise<boolean> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return false;
  }

  const escSubject = task.subject.replace(/'/g, "'\\''");
  let cmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${task.priority}`;

  let skills: string[] = [];
  try {
    const parsed = JSON.parse(task.skills ?? "[]");
    if (Array.isArray(parsed)) skills = parsed;
  } catch { /* ignore */ }

  if (skills.length > 0) {
    cmd += ` --skills ${skills.join(",")}`;
  }

  if (task.description) {
    const escDesc = task.description.replace(/'/g, "'\\''").slice(0, 500);
    cmd += ` --description '${escDesc}'`;
  }

  cmd += ` --source 'fleet:arc:router'`;

  const result = await ssh(ip, password, cmd);
  return result.ok;
}

// ---- Commands ----

async function cmdDryRun(flags: Record<string, string>): Promise<void> {
  initDatabase();
  const limit = parseInt(flags["limit"] ?? "20");

  const healthy = readHealthyAgents();
  process.stdout.write(`Healthy agents: ${healthy.size > 0 ? [...healthy].join(", ") : "(none)"}\n\n`);

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    process.stdout.write("No SSH password — using mock backlogs of 0\n\n");
    password = "";
  }

  // Get backlogs (or mock them)
  const backlogs: Record<string, number> = {};
  if (password) {
    const results = await Promise.allSettled(
      [...healthy].map(async (agent) => ({
        agent,
        count: await getRemoteBacklog(agent, password),
      }))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        backlogs[r.value.agent] = r.value.count;
      }
    }
  }

  for (const agent of Object.keys(AGENTS)) {
    if (healthy.has(agent)) {
      process.stdout.write(`${agent}: ${backlogs[agent] ?? "?"} pending\n`);
    } else {
      process.stdout.write(`${agent}: (unhealthy/unreachable)\n`);
    }
  }

  const pending = getPendingTasks();
  process.stdout.write(`\nArc pending: ${pending.length}\n\n`);

  // Route and display
  const decisions: RoutingDecision[] = [];
  const routeCounts: Record<string, number> = { arc: 0 };
  for (const agent of Object.keys(AGENTS)) routeCounts[agent] = 0;

  for (const task of pending.slice(0, limit)) {
    const decision = routeTask(task, backlogs, healthy);
    decisions.push(decision);
    routeCounts[decision.target] = (routeCounts[decision.target] ?? 0) + 1;
  }

  // Show routable tasks
  const routable = decisions.filter((d) => d.target !== "arc");
  if (routable.length === 0) {
    process.stdout.write("No tasks eligible for routing.\n");
    return;
  }

  process.stdout.write(`Routable tasks (${routable.length}):\n`);
  process.stdout.write("─".repeat(80) + "\n");

  for (const d of routable) {
    const subj = d.task.subject.slice(0, 55);
    process.stdout.write(
      `  #${d.task.id} P${d.task.priority} → ${d.target.padEnd(6)} │ ${d.reason.padEnd(25)} │ ${subj}\n`
    );
  }

  process.stdout.write("\n── Summary ──\n");
  for (const [agent, count] of Object.entries(routeCounts)) {
    if (count > 0) {
      process.stdout.write(`  ${agent}: ${count}\n`);
    }
  }
}

async function cmdRoute(flags: Record<string, string>): Promise<void> {
  initDatabase();
  const limit = parseInt(flags["limit"] ?? "10");

  const healthy = readHealthyAgents();
  if (healthy.size === 0) {
    process.stdout.write("No healthy agents — aborting.\n");
    process.exit(1);
  }

  const password = await getSshPassword();

  // Get backlogs
  const backlogs: Record<string, number> = {};
  const results = await Promise.allSettled(
    [...healthy].map(async (agent) => ({
      agent,
      count: await getRemoteBacklog(agent, password),
    }))
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      backlogs[r.value.agent] = r.value.count;
    }
  }

  const pending = getPendingTasks();
  process.stdout.write(`Arc pending: ${pending.length}, routing up to ${limit}...\n\n`);

  let routed = 0;
  for (const task of pending) {
    if (routed >= limit) break;

    const decision = routeTask(task, backlogs, healthy);
    if (decision.target === "arc") continue;

    const sent = await sendToAgent(decision.target, task, password);
    if (sent) {
      markTaskCompleted(task.id, `Routed to ${decision.target} (${decision.reason})`);
      backlogs[decision.target] = (backlogs[decision.target] ?? 0) + 1;
      routed++;
      process.stdout.write(`  ✓ #${task.id} → ${decision.target}: ${task.subject.slice(0, 60)}\n`);
    } else {
      process.stdout.write(`  ✗ #${task.id} → ${decision.target}: send failed\n`);
    }
  }

  process.stdout.write(`\nRouted ${routed} tasks.\n`);
}

async function cmdStatus(_flags: Record<string, string>): Promise<void> {
  const healthy = readHealthyAgents();

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    process.stdout.write("No SSH password configured.\n");
    process.exit(1);
    return;
  }

  process.stdout.write("Fleet backlog status:\n\n");

  for (const agent of Object.keys(AGENTS)) {
    if (!healthy.has(agent)) {
      process.stdout.write(`  ${agent}: (unhealthy/unreachable)\n`);
      continue;
    }

    const count = await getRemoteBacklog(agent, password);
    const bar = "█".repeat(Math.min(count, 40));
    process.stdout.write(`  ${agent.padEnd(6)} ${String(count).padStart(3)} pending ${bar}\n`);
  }

  // Show Arc's count too
  try {
    initDatabase();
    const pending = getPendingTasks();
    const bar = "█".repeat(Math.min(pending.length, 40));
    process.stdout.write(`  ${"arc".padEnd(6)} ${String(pending.length).padStart(3)} pending ${bar}\n`);
  } catch {
    process.stdout.write(`  arc    (db not available)\n`);
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-router — Route tasks from Arc to fleet agents

Usage:
  arc skills run --name fleet-router -- <command> [options]

Commands:
  dry-run     Preview routing decisions without executing
              --limit <n>     Max tasks to evaluate (default: 20)

  route       Execute routing — send tasks and close local copies
              --limit <n>     Max tasks to route (default: 10)

  status      Show fleet backlog summary

Routing rules:
  P1-2 → Arc (always)
  Skill tag match → domain agent (spark/iris/loom/forge)
  P8+ untagged → lowest backlog agent
  Backlog cap: 20 per agent
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "dry-run":
      await cmdDryRun(flags);
      break;
    case "route":
      await cmdRoute(flags);
      break;
    case "status":
      await cmdStatus(flags);
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
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
