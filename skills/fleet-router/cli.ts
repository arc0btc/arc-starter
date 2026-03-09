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
import { routeTask, computeLoadScore } from "./sensor.ts";
import type { RoutingDecision, AgentLoad } from "./sensor.ts";
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

async function getRemoteLoad(
  agent: string,
  password: string,
): Promise<AgentLoad> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return { pending: 999, active: 0, score: 999 };
  }

  const result = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const p = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'pending\\\\'').get();
      const a = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'active\\\\'').get();
      console.log((p?.c ?? 0) + ':' + (a?.c ?? 0));
      db.close();
    " 2>/dev/null || echo "999:0"`
  );

  const parts = result.stdout.trim().split(":");
  const pending = parseInt(parts[0]) || 999;
  const active = parseInt(parts[1]) || 0;
  return { pending, active, score: computeLoadScore(pending, active) };
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

  // Get loads (or mock them)
  const loads: Record<string, AgentLoad> = {};
  if (password) {
    const results = await Promise.allSettled(
      [...healthy].map(async (agent) => ({
        agent,
        load: await getRemoteLoad(agent, password),
      }))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        loads[r.value.agent] = r.value.load;
      }
    }
  }

  for (const agent of Object.keys(AGENTS)) {
    if (healthy.has(agent)) {
      const l = loads[agent] ?? { pending: 0, active: 0, score: 0 };
      process.stdout.write(`${agent}: ${l.pending}p + ${l.active}a = load ${l.score}\n`);
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
    const decision = routeTask(task, loads, healthy);
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

  // Get loads
  const loads: Record<string, AgentLoad> = {};
  const results = await Promise.allSettled(
    [...healthy].map(async (agent) => ({
      agent,
      load: await getRemoteLoad(agent, password),
    }))
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      loads[r.value.agent] = r.value.load;
    }
  }

  const pending = getPendingTasks();
  process.stdout.write(`Arc pending: ${pending.length}, routing up to ${limit}...\n\n`);

  let routed = 0;
  for (const task of pending) {
    if (routed >= limit) break;

    const decision = routeTask(task, loads, healthy);
    if (decision.target === "arc") continue;

    const sent = await sendToAgent(decision.target, task, password);
    if (sent) {
      markTaskCompleted(task.id, `Routed to ${decision.target} (${decision.reason})`);
      const prev = loads[decision.target] ?? { pending: 0, active: 0, score: 0 };
      prev.pending++;
      prev.score = computeLoadScore(prev.pending, prev.active);
      loads[decision.target] = prev;
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

  process.stdout.write("Fleet load status (pending + active × 5 = load score):\n\n");

  for (const agent of Object.keys(AGENTS)) {
    if (!healthy.has(agent)) {
      process.stdout.write(`  ${agent}: (unhealthy/unreachable)\n`);
      continue;
    }

    const load = await getRemoteLoad(agent, password);
    const bar = "█".repeat(Math.min(load.score, 40));
    const active = load.active > 0 ? ` [dispatching]` : "";
    process.stdout.write(`  ${agent.padEnd(6)} ${String(load.pending).padStart(3)}p + ${load.active}a = ${String(load.score).padStart(3)} ${bar}${active}\n`);
  }

  // Show Arc's count too
  try {
    initDatabase();
    const pending = getPendingTasks();
    const bar = "█".repeat(Math.min(pending.length, 40));
    process.stdout.write(`  ${"arc".padEnd(6)} ${String(pending.length).padStart(3)}p                ${bar}\n`);
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
  Skill tag match → domain agent (overflow if load > 12)
  Unmatched P3+ → least-busy agent by load score
  Load score = pending + (active × 5)
  Soft cap: 12 (triggers overflow), Hard cap: 20 (skip agent)
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
