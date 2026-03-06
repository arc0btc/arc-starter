#!/usr/bin/env bun

// worker-logs-monitor/cli.ts
//
// CLI for querying worker-logs deployments.
// Subcommands: errors, stats, issues

import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";

interface Deployment {
  name: string;
  url: string;
  repo: string;
  credKey: string;
}

const DEPLOYMENTS: Deployment[] = [
  { name: "arc0btc", url: "https://logs.arc0btc.com", repo: "arc0btc/worker-logs", credKey: "arc0btc_worker_api_key" },
  { name: "wbd", url: "https://logs.wbd.host", repo: "whoabuddy/worker-logs", credKey: "whoabuddy_admin_api_key" },
  { name: "mainnet", url: "https://logs.aibtc.com", repo: "aibtcdev/worker-logs", credKey: "aibtc_admin_api_key" },
  { name: "testnet", url: "https://logs.aibtc.dev", repo: "aibtcdev/worker-logs", credKey: "aibtc_admin_api_key" },
];

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [worker-logs-monitor/cli] ${message}`);
}

function getDeployments(name?: string): Deployment[] {
  if (!name) return DEPLOYMENTS;
  const found = DEPLOYMENTS.filter((d) => d.name === name);
  if (found.length === 0) {
    process.stderr.write(`Error: unknown deployment '${name}'. Valid: ${DEPLOYMENTS.map((d) => d.name).join(", ")}\n`);
    process.exit(1);
  }
  return found;
}

async function fetchWithAuth(deployment: Deployment, path: string): Promise<Response | null> {
  const adminKey = await getCredential("worker-logs", deployment.credKey);
  if (!adminKey) {
    log(`no admin key for ${deployment.name} (worker-logs/${deployment.credKey})`);
    return null;
  }

  const url = `${deployment.url}${path}`;
  try {
    const response = await fetch(url, {
      headers: {
        "X-Admin-Key": adminKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    return response;
  } catch (error) {
    log(`${deployment.name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ---- errors subcommand ----

async function cmdErrors(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const deploymentName = flags["deployment"];
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const targets = getDeployments(deploymentName);

  for (const dep of targets) {
    const response = await fetchWithAuth(dep, `/logs?level=ERROR&limit=${limit}`);
    if (!response) continue;

    if (!response.ok) {
      log(`${dep.name}: HTTP ${response.status}`);
      continue;
    }

    const data = await response.json();
    const logs = Array.isArray(data) ? data : data.logs ?? [];

    console.log(`\n=== ${dep.name} (${dep.url}) ===`);

    if (logs.length === 0) {
      console.log("  No errors found.");
      continue;
    }

    for (const entry of logs) {
      const time = entry.created_at ?? "?";
      const app = entry.app_id ?? "?";
      const message = entry.message ?? "(no message)";
      console.log(`  [${time}] [${app}] ${message}`);
      if (entry.context && Object.keys(entry.context).length > 0) {
        console.log(`    context: ${JSON.stringify(entry.context)}`);
      }
    }

    console.log(`  Total: ${logs.length} error(s)`);
  }
}

// ---- stats subcommand ----

async function cmdStats(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const deploymentName = flags["deployment"];
  const days = flags["days"] ?? "1";
  const targets = getDeployments(deploymentName);

  for (const dep of targets) {
    // First get the list of apps
    const appsRes = await fetchWithAuth(dep, "/apps");
    if (!appsRes) continue;

    if (!appsRes.ok) {
      log(`${dep.name}: HTTP ${appsRes.status} fetching apps`);
      continue;
    }

    const appsData = await appsRes.json();
    const apps = Array.isArray(appsData) ? appsData : appsData.apps ?? [];

    console.log(`\n=== ${dep.name} (${dep.url}) ===`);

    if (apps.length === 0) {
      console.log("  No apps registered.");
      continue;
    }

    for (const app of apps) {
      const appId = typeof app === "string" ? app : app.app_id ?? app.id ?? "unknown";
      const statsRes = await fetchWithAuth(dep, `/stats/${appId}?days=${days}`);
      if (!statsRes || !statsRes.ok) {
        console.log(`  ${appId}: failed to fetch stats`);
        continue;
      }

      const stats = await statsRes.json();
      console.log(`  ${appId}:`);
      console.log(`    ${JSON.stringify(stats, null, 4).split("\n").join("\n    ")}`);
    }
  }
}

// ---- issues subcommand ----

function cmdIssues(args: string[]): void {
  const { flags } = parseFlags(args);
  const repo = flags["repo"];

  const repos = repo
    ? [repo]
    : [...new Set(DEPLOYMENTS.map((d) => d.repo))];

  for (const r of repos) {
    console.log(`\n=== ${r} ===`);

    const result = Bun.spawnSync(
      [
        "gh", "issue", "list",
        "--repo", r,
        "--label", "worker-logs",
        "--state", "open",
        "--json", "number,title,createdAt",
        "--jq", '.[] | "  #\\(.number) [\\(.createdAt[:10])] \\(.title)"',
      ],
      { timeout: 15_000 },
    );

    const stdout = result.stdout.toString().trim();
    if (stdout) {
      console.log(stdout);
    } else {
      // Try without label filter in case labels aren't set up
      const fallback = Bun.spawnSync(
        [
          "gh", "issue", "list",
          "--repo", r,
          "--state", "open",
          "--search", "worker-logs OR error OR logs",
          "--json", "number,title,createdAt",
          "--limit", "10",
          "--jq", '.[] | "  #\\(.number) [\\(.createdAt[:10])] \\(.title)"',
        ],
        { timeout: 15_000 },
      );

      const fallbackOut = fallback.stdout.toString().trim();
      if (fallbackOut) {
        console.log(fallbackOut);
      } else {
        console.log("  No open issues found.");
      }
    }
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`worker-logs-monitor CLI

USAGE
  bun skills/worker-logs-monitor/cli.ts <subcommand> [args]

SUBCOMMANDS
  errors [--deployment NAME] [--limit N]
    Fetch recent error logs. Default: all deployments, limit 20.
    Deployments: arc0btc, wbd, mainnet, testnet

  stats [--deployment NAME] [--days N]
    Show daily stats per app. Default: all deployments, 1 day.

  issues [--repo OWNER/REPO]
    List open worker-logs issues on GitHub.
    Default: all deployment repos.

EXAMPLES
  bun skills/worker-logs-monitor/cli.ts errors
  bun skills/worker-logs-monitor/cli.ts errors --deployment arc0btc --limit 50
  bun skills/worker-logs-monitor/cli.ts stats --deployment mainnet --days 7
  bun skills/worker-logs-monitor/cli.ts issues --repo arc0btc/worker-logs
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "errors":
      await cmdErrors(args.slice(1));
      break;
    case "stats":
      await cmdStats(args.slice(1));
      break;
    case "issues":
      cmdIssues(args.slice(1));
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

main().catch((error) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
