#!/usr/bin/env bun

// worker-logs/cli.ts
//
// CLI for managing worker-logs across three deployments.
// Subcommands: sync, events, report

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFlags } from "../../src/utils.ts";

const ROOT = join(import.meta.dir, "../..");
const REPORTS_DIR = join(ROOT, "reports");
const ARCHIVE_DIR = join(REPORTS_DIR, "archive");

const UPSTREAM = "whoabuddy/worker-logs";
const FORKS = ["aibtcdev/worker-logs", "arc0btc/worker-logs"];

const DEPLOYMENTS: Record<string, string> = {
  "wbd": "https://logs.wbd.host",
  "mainnet": "https://logs.aibtc.com",
  "testnet": "https://logs.aibtc.dev",
};

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [worker-logs/cli] ${msg}`);
}

// ---- Sync subcommand ----

function cmdSync(): void {
  log("checking fork drift against upstream...");

  for (const fork of FORKS) {
    const result = spawnSync(
      "gh",
      [
        "api",
        `repos/${fork}/compare/main...${UPSTREAM.replace("/", ":")}:main`,
        "--jq",
        ".behind_by",
      ],
      { timeout: 15_000 }
    );

    const stdout = result.stdout?.toString().trim() ?? "";
    const stderr = result.stderr?.toString().trim() ?? "";

    if (result.status !== 0) {
      process.stderr.write(`Error checking ${fork}: ${stderr}\n`);
      continue;
    }

    const behind = parseInt(stdout, 10);
    if (isNaN(behind) || behind === 0) {
      log(`${fork}: in sync`);
      continue;
    }

    log(`${fork}: ${behind} commits behind upstream`);

    // Check if a sync PR already exists
    const prCheck = spawnSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        fork,
        "--head",
        `${UPSTREAM.split("/")[0]}:main`,
        "--state",
        "open",
        "--json",
        "number",
        "--jq",
        "length",
      ],
      { timeout: 15_000 }
    );

    const openPrs = parseInt(prCheck.stdout?.toString().trim() ?? "0", 10);
    if (openPrs > 0) {
      log(`${fork}: sync PR already exists`);
      continue;
    }

    // Create sync PR using gh repo sync (simplest approach)
    log(`${fork}: creating sync...`);
    const syncResult = spawnSync(
      "gh",
      ["repo", "sync", fork, "--source", UPSTREAM],
      { timeout: 30_000 }
    );

    if (syncResult.status === 0) {
      log(`${fork}: synced successfully`);
    } else {
      const syncErr = syncResult.stderr?.toString().trim() ?? "";
      process.stderr.write(`Failed to sync ${fork}: ${syncErr}\n`);
    }
  }

  log("sync check complete");
}

// ---- Events subcommand ----

async function cmdEvents(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  let url = flags["deployment"];

  if (!url) {
    process.stderr.write("Error: --deployment required (URL or alias: wbd, mainnet, testnet)\n");
    process.exit(1);
  }

  // Resolve aliases
  if (DEPLOYMENTS[url]) {
    url = DEPLOYMENTS[url];
  }

  // Validate URL
  if (!url.startsWith("https://")) {
    process.stderr.write(`Error: invalid deployment URL: ${url}\n`);
    process.exit(1);
  }

  log(`fetching events from ${url}...`);

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      process.stderr.write(`Error: ${response.status} ${response.statusText}\n`);
      process.exit(1);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      console.log(JSON.stringify(data, null, 2));
    } else {
      const text = await response.text();
      console.log(text);
    }
  } catch (err) {
    process.stderr.write(
      `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}

// ---- Report subcommand ----

async function cmdReport(): Promise<void> {
  log("generating worker-logs report...");

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

  const results: Record<string, { status: number; body: string }> = {};

  for (const [name, url] of Object.entries(DEPLOYMENTS)) {
    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });

      const body = await response.text();
      results[name] = { status: response.status, body };
    } catch (err) {
      results[name] = {
        status: 0,
        body: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Build report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
  const reportName = `${timestamp}_worker_logs.md`;
  const reportPath = join(REPORTS_DIR, reportName);

  const lines: string[] = [
    `# Worker Logs Report`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Upstream:** ${UPSTREAM}`,
    ``,
    `## Fork Status`,
    ``,
  ];

  for (const fork of FORKS) {
    const result = spawnSync(
      "gh",
      [
        "api",
        `repos/${fork}/compare/main...${UPSTREAM.replace("/", ":")}:main`,
        "--jq",
        ".behind_by",
      ],
      { timeout: 15_000 }
    );
    const behind = parseInt(result.stdout?.toString().trim() ?? "0", 10);
    const status = isNaN(behind) || behind === 0 ? "in sync" : `${behind} commits behind`;
    lines.push(`- **${fork}:** ${status}`);
  }

  lines.push("", "## Deployment Responses", "");

  for (const [name, res] of Object.entries(results)) {
    lines.push(`### ${name} (${DEPLOYMENTS[name]})`);
    lines.push("");
    lines.push(`**Status:** ${res.status === 0 ? "unreachable" : res.status}`);
    lines.push("");
    // Truncate body for report readability
    const preview = res.body.length > 500 ? res.body.slice(0, 500) + "..." : res.body;
    lines.push("```");
    lines.push(preview);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Summary", "");
  lines.push("_Production app API structure TBD — whoabuddy will teach over time. This is a baseline report._");
  lines.push("");

  await Bun.write(reportPath, lines.join("\n"));
  log(`report written: ${reportPath}`);

  // Housekeeping: keep max 5 active reports, archive older ones
  const reportFiles = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith("_worker_logs.md"))
    .sort()
    .reverse();

  if (reportFiles.length > 5) {
    const toArchive = reportFiles.slice(5);
    for (const f of toArchive) {
      const src = join(REPORTS_DIR, f);
      const dest = join(ARCHIVE_DIR, f);
      await Bun.write(dest, Bun.file(src));
      const { unlinkSync } = await import("node:fs");
      unlinkSync(src);
      log(`archived: ${f}`);
    }
  }

  log("report complete");
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`worker-logs CLI

USAGE
  bun skills/worker-logs/cli.ts <subcommand> [args]

SUBCOMMANDS
  sync
    Check all three repos for drift against upstream.
    Creates sync PRs or fast-forwards if forks are behind.

  events --deployment URL|ALIAS
    Fetch recent events from a deployment endpoint.
    Aliases: wbd, mainnet, testnet

  report
    Analyze events across all deployments. Produce ISO 8601 report at reports/.

EXAMPLES
  bun skills/worker-logs/cli.ts sync
  bun skills/worker-logs/cli.ts events --deployment wbd
  bun skills/worker-logs/cli.ts events --deployment https://logs.aibtc.com
  bun skills/worker-logs/cli.ts report
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "sync":
      cmdSync();
      break;
    case "events":
      await cmdEvents(args.slice(1));
      break;
    case "report":
      await cmdReport();
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

main().catch((err) => {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
