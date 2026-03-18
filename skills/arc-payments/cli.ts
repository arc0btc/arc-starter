#!/usr/bin/env bun

// skills/arc-payments/cli.ts
//
// CLI for inspecting arc-payments state: recent payment tasks, service map,
// hook state, and manual sensor scan.

import { parseFlags, pad, truncate } from "../../src/utils.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";
import { readHookState } from "../../src/sensors.ts";

const SENSOR_NAME = "arc-payments";

// Mirror of sensor.ts SERVICE_MAP for display purposes
const SERVICE_MAP: Record<string, { priority: number; model: string; skills: string[] }> = {
  "arc:arxiv-latest": { priority: 6, model: "sonnet", skills: ["arxiv-research"] },
  "arc:ask-quick": { priority: 8, model: "haiku", skills: [] },
  "arc:ask-informed": { priority: 6, model: "sonnet", skills: [] },
  "arc:pr-standard": { priority: 5, model: "sonnet", skills: ["aibtc-repo-maintenance"] },
};

const MIN_AMOUNTS_STX: Record<string, number> = {
  "arc:arxiv-latest": 5_000_000,
  "arc:ask-quick": 1_000_000,
  "arc:ask-informed": 5_000_000,
  "arc:pr-standard": 40_000_000,
};

const MIN_AMOUNTS_SBTC: Record<string, number> = {
  "arc:arxiv-latest": 5_000,
  "arc:ask-quick": 1_000,
  "arc:ask-informed": 5_000,
  "arc:pr-standard": 40_000,
};

function printHelp(): void {
  process.stdout.write(
    [
      "arc-payments CLI",
      "",
      "Usage: arc skills run --name arc-payments -- <command> [flags]",
      "",
      "Commands:",
      "  list [--limit N]   List recent tasks created by payment sensor (default: 20)",
      "  services           Show configured service codes with minimums",
      "  status             Show sensor hook state (last block, last run)",
      "  scan               Run payment sensor once (manual trigger)",
      "  help               Show this help",
      "",
    ].join("\n"),
  );
}

function cmdList(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = parseInt(flags["limit"] ?? "20", 10);

  initDatabase();
  const db = getDatabase();

  const rows = db
    .query(
      `SELECT id, priority, status, subject, source, created_at
       FROM tasks
       WHERE source LIKE 'sensor:arc-payments:%'
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    priority: number;
    status: string;
    subject: string;
    source: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    process.stdout.write("No payment tasks found.\n");
    return;
  }

  const header =
    pad("id", 6) +
    pad("pri", 4) +
    pad("status", 12) +
    pad("subject", 50) +
    "created_at";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const row of rows) {
    // Extract txid from source (sensor:arc-payments:0x...)
    const line =
      pad(String(row.id), 6) +
      pad(String(row.priority), 4) +
      pad(row.status, 12) +
      pad(truncate(row.subject, 48), 50) +
      truncate(row.created_at, 16);
    process.stdout.write(line + "\n");
  }

  process.stdout.write(`\n${rows.length} payment task(s) shown.\n`);
}

function cmdServices(): void {
  const header =
    pad("memo", 22) +
    pad("pri", 4) +
    pad("model", 8) +
    pad("min STX", 10) +
    pad("min sBTC (sats)", 18) +
    "skills";
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const [memo, svc] of Object.entries(SERVICE_MAP)) {
    const stxMin = MIN_AMOUNTS_STX[memo] ?? 0;
    const sbtcMin = MIN_AMOUNTS_SBTC[memo] ?? 0;
    const stxDisplay = `${stxMin / 1_000_000} STX`;
    const sbtcDisplay = String(sbtcMin);
    const skillsDisplay = svc.skills.length > 0 ? svc.skills.join(", ") : "—";

    const line =
      pad(memo, 22) +
      pad(String(svc.priority), 4) +
      pad(svc.model, 8) +
      pad(stxDisplay, 10) +
      pad(sbtcDisplay, 18) +
      skillsDisplay;
    process.stdout.write(line + "\n");
  }
}

async function cmdStatus(): Promise<void> {
  const state = await readHookState(SENSOR_NAME);

  if (!state) {
    process.stdout.write("No hook state found — sensor has not run yet.\n");
    return;
  }

  process.stdout.write(
    [
      `Sensor:           ${SENSOR_NAME}`,
      `Last ran:         ${state.last_ran ?? "unknown"}`,
      `Last result:      ${state.last_result ?? "unknown"}`,
      `Last block:       ${state.last_block_height ?? "unknown"}`,
      `State version:    ${state.version ?? 0}`,
      "",
    ].join("\n"),
  );

  // Count payment tasks by status
  initDatabase();
  const db = getDatabase();
  const counts = db
    .query(
      `SELECT status, COUNT(*) as count
       FROM tasks
       WHERE source LIKE 'sensor:arc-payments:%'
       GROUP BY status
       ORDER BY status`,
    )
    .all() as Array<{ status: string; count: number }>;

  if (counts.length > 0) {
    process.stdout.write("Payment tasks by status:\n");
    for (const row of counts) {
      process.stdout.write(`  ${pad(row.status, 12)} ${row.count}\n`);
    }
  } else {
    process.stdout.write("No payment tasks recorded.\n");
  }
}

async function cmdScan(): Promise<void> {
  process.stdout.write("Running arc-payments sensor (manual trigger)...\n");
  const sensor = await import("./sensor.ts");
  // The default export is the sensor function, but claimSensorRun will gate it.
  // For manual scan, we call it directly — cadence gating may cause a "skip".
  const result = await sensor.default();
  process.stdout.write(`Sensor result: ${result}\n`);
  if (result === "skip") {
    process.stdout.write(
      "Sensor skipped due to cadence gating. Wait for the interval to elapse or check status.\n",
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "list":
      cmdList(args.slice(1));
      break;
    case "services":
      cmdServices();
      break;
    case "status":
      await cmdStatus();
      break;
    case "scan":
      await cmdScan();
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

main().catch((error) => {
  process.stderr.write(`Error: ${error}\n`);
  process.exit(1);
});
