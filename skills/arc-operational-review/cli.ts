#!/usr/bin/env bun

/**
 * arc-operational-review CLI
 *
 * Usage:
 *   arc skills run --name arc-operational-review -- run [--hours 12]
 */

import { initDatabase } from "../../src/db.ts";
import { runReview, formatReport } from "./sensor.ts";

function parseArgs(args: string[]): { command: string; params: Record<string, string> } {
  const command = args[0] || "";
  const params: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }
  return { command, params };
}

function printUsage(): void {
  process.stdout.write(
    `arc-operational-review CLI

Commands:
  run [--hours N]   Run operational review for last N hours (default: 6)

Examples:
  arc skills run --name arc-operational-review -- run
  arc skills run --name arc-operational-review -- run --hours 12
`,
  );
}

const { command, params } = parseArgs(process.argv.slice(2));

if (!command || command === "help") {
  printUsage();
  process.exit(0);
}

if (command === "run") {
  initDatabase();
  const hours = parseInt(params.hours || "6", 10);
  if (isNaN(hours) || hours < 1) {
    console.error("Error: --hours must be a positive integer");
    process.exit(1);
  }

  const findings = runReview(hours);
  const report = formatReport(findings, hours);
  console.log(report);

  const totalIssues =
    findings.failedNoFollowUp.length +
    findings.blockedOver24h.length +
    findings.stalePendingFollowUps.length;

  console.log(`\n---\nRaw counts: failed=${findings.failedNoFollowUp.length} blocked=${findings.blockedOver24h.length} stale=${findings.stalePendingFollowUps.length}`);
  process.exit(totalIssues > 0 ? 1 : 0);
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
