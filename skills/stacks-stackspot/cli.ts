#!/usr/bin/env bun

// skills/stacks-stackspot/cli.ts
//
// CLI for inspecting stackspot stacking state: pot status, join history,
// and manual sensor trigger.

import { parseFlags, pad, truncate } from "../../src/utils.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";
import { readHookState } from "../../src/sensors.ts";

const SENSOR_NAME = "stacks-stackspot";
const SKILLS_ROOT = "../../github/aibtcdev/skills";

const KNOWN_POTS = [
  { name: "Genesis", minStx: 20, maxParticipants: 2 },
  { name: "BuildOnBitcoin", minStx: 100, maxParticipants: 10 },
  { name: "STXLFG", minStx: 21, maxParticipants: 100 },
];

function printHelp(): void {
  process.stdout.write(
    [
      "stacks-stackspot CLI",
      "",
      "Usage: arc skills run --name stacks-stackspot -- <command> [flags]",
      "",
      "Commands:",
      "  status             Show current pot states and sensor hook state",
      "  history [--limit N]  Show past join/claim tasks (default: 20)",
      "  check              Run sensor logic once and report decision (may skip on cadence)",
      "  help               Show this help",
      "",
    ].join("\n"),
  );
}

async function runUpstreamScript(
  script: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd: import.meta.dir + "/" + SKILLS_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NETWORK: "mainnet",
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function cmdStatus(): Promise<void> {
  // Sensor hook state
  const state = await readHookState(SENSOR_NAME);
  if (!state) {
    process.stdout.write("Sensor has not run yet — no hook state found.\n\n");
  } else {
    process.stdout.write(
      [
        `Sensor:       ${SENSOR_NAME}`,
        `Last ran:     ${state.last_ran ?? "unknown"}`,
        `Last result:  ${state.last_result ?? "unknown"}`,
        "",
      ].join("\n"),
    );
  }

  // Live pot state from upstream script
  const script = import.meta.dir + "/" + SKILLS_ROOT + "/stackspot/stackspot.ts";
  process.stdout.write("Fetching live pot states...\n\n");

  for (const pot of KNOWN_POTS) {
    process.stdout.write(`Pot: ${pot.name} (min ${pot.minStx} STX, max ${pot.maxParticipants} participants)\n`);
    try {
      const result = await runUpstreamScript(script, ["get-pot-state", "--contract-name", pot.name]);
      if (result.exitCode === 0) {
        // Pretty-print the JSON state
        try {
          const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
          for (const [k, v] of Object.entries(parsed)) {
            process.stdout.write(`  ${pad(k, 22)} ${JSON.stringify(v)}\n`);
          }
        } catch {
          process.stdout.write(`  ${result.stdout}\n`);
        }
      } else {
        process.stdout.write(`  (error: ${result.stderr || "unknown"})\n`);
      }
    } catch (e) {
      const err = e as Error;
      process.stdout.write(`  (error: ${err.message})\n`);
    }
    process.stdout.write("\n");
  }

  // Pending join tasks
  initDatabase();
  const db = getDatabase();
  const pending = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE source LIKE 'sensor:stacks-stackspot:%'
         AND status = 'pending'`,
    )
    .get() as { count: number };

  process.stdout.write(`Pending join tasks: ${pending.count}\n`);
}

function cmdHistory(args: string[]): void {
  const { flags } = parseFlags(args);
  const limit = parseInt(flags["limit"] ?? "20", 10);

  initDatabase();
  const db = getDatabase();

  const rows = db
    .query(
      `SELECT id, priority, status, subject, source, created_at, result_summary
       FROM tasks
       WHERE source LIKE 'sensor:stacks-stackspot:%'
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
    result_summary: string | null;
  }>;

  if (rows.length === 0) {
    process.stdout.write("No stackspot tasks found.\n");
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
    const line =
      pad(String(row.id), 6) +
      pad(String(row.priority), 4) +
      pad(row.status, 12) +
      pad(truncate(row.subject, 48), 50) +
      truncate(row.created_at, 16);
    process.stdout.write(line + "\n");
    if (row.result_summary) {
      process.stdout.write(`       ${truncate(row.result_summary, 100)}\n`);
    }
  }

  process.stdout.write(`\n${rows.length} stackspot task(s) shown.\n`);
}

async function cmdCheck(): Promise<void> {
  process.stdout.write("Running stacks-stackspot sensor (manual trigger)...\n");
  const sensor = await import("./sensor.ts");
  const result = await sensor.default();
  process.stdout.write(`Sensor result: ${result}\n`);
  if (result === "skip") {
    process.stdout.write(
      "Sensor skipped due to cadence gating. Use 'status' to inspect state without triggering.\n",
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "history":
      cmdHistory(args.slice(1));
      break;
    case "check":
      await cmdCheck();
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
