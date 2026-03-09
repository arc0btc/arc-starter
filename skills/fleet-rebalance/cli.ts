#!/usr/bin/env bun

/**
 * fleet-rebalance CLI
 *
 * Show rebalance status and recent steal activity.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const REBALANCE_LOG = join(MEMORY_DIR, "fleet-rebalance.log");

// ---- Types ----

interface StealAction {
  from_agent: string;
  to_agent: string;
  task_id: number;
  subject: string;
  priority: number;
}

interface RebalanceEntry {
  timestamp: string;
  idle_agents: string[];
  busy_agents: string[];
  steals: StealAction[];
  total_steals: number;
}

// ---- Status command ----

function cmdStatus(): void {
  let lines: string[];
  try {
    const raw = readFileSync(REBALANCE_LOG, "utf-8").trim();
    lines = raw.split("\n").filter(Boolean);
  } catch {
    process.stdout.write("No rebalance log found. Sensor has not run yet.\n");
    return;
  }

  if (lines.length === 0) {
    process.stdout.write("Rebalance log is empty.\n");
    return;
  }

  // Show last 10 entries
  const recent = lines.slice(-10);
  process.stdout.write("Fleet Rebalance — Recent Activity\n");
  process.stdout.write("=".repeat(60) + "\n\n");

  let totalSteals = 0;
  let cycles = 0;

  for (const line of recent) {
    let entry: RebalanceEntry;
    try {
      entry = JSON.parse(line) as RebalanceEntry;
    } catch {
      continue;
    }
    cycles++;
    totalSteals += entry.total_steals;

    const timestamp = entry.timestamp.replace("T", " ").slice(0, 19) + "Z";
    const idle = entry.idle_agents.join(", ") || "none";
    const busy = entry.busy_agents.join(", ") || "none";

    process.stdout.write(`${timestamp}  idle=[${idle}]  busy=[${busy}]  steals=${entry.total_steals}\n`);

    for (const s of entry.steals) {
      process.stdout.write(`  #${s.task_id} (P${s.priority}) ${s.from_agent} → ${s.to_agent}: ${s.subject.slice(0, 50)}\n`);
    }
  }

  process.stdout.write(`\nSummary: ${totalSteals} steal(s) across ${cycles} cycle(s) shown\n`);
  process.stdout.write(`Log: ${REBALANCE_LOG} (${lines.length} total entries)\n`);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-rebalance — Work-stealing rebalancer for fleet agents

Usage:
  arc skills run --name fleet-rebalance -- <command>

Commands:
  status    Show recent rebalance activity and steal history
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "status":
      cmdStatus();
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
