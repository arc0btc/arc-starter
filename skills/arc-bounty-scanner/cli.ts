#!/usr/bin/env bun
// skills/arc-bounty-scanner/cli.ts

import { getDatabase } from "../../src/db.ts";

const args = process.argv.slice(2);
const command = args[0];

function listBounties(): void {
  const db = getDatabase();
  const rows = db
    .query<
      { id: number; subject: string; status: string; created_at: string; priority: number },
      []
    >(
      `SELECT id, subject, status, created_at, priority
       FROM tasks
       WHERE source LIKE 'bounty:%'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all();

  if (rows.length === 0) {
    console.log("No bounty tasks found.");
    process.exit(0);
  }

  console.log(`Bounty tasks (${rows.length}):\n`);
  for (const row of rows) {
    const statusIcon = row.status === "completed" ? "✓" : row.status === "failed" ? "✗" : "○";
    console.log(
      `  ${statusIcon} [#${row.id}] P${row.priority} [${row.status}] ${row.subject}`,
    );
  }
}

function runScan(): void {
  console.log("Triggering bounty scan...");
  const result = Bun.spawnSync(["bun", "skills/arc-bounty-scanner/sensor.ts"], {
    cwd: process.cwd(),
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(result.exitCode ?? 0);
}

switch (command) {
  case "list":
    listBounties();
    break;
  case "scan":
    runScan();
    break;
  default:
    console.log("Usage:");
    console.log("  arc skills run --name arc-bounty-scanner -- list    List queued bounty tasks");
    console.log("  arc skills run --name arc-bounty-scanner -- scan    Run sensor immediately");
    process.exit(1);
}
