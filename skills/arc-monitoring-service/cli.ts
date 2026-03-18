#!/usr/bin/env bun
// skills/arc-monitoring-service/cli.ts
// CLI for managing monitored endpoints.

import {
  initDatabase,
  getActiveMonitoredEndpoints,
  getMonitoredEndpoint,
  insertMonitoredEndpoint,
  deleteMonitoredEndpoint,
  updateMonitoredEndpointCheck,
  type MonitoredEndpoint,
} from "../../src/db.ts";

initDatabase();

const CHECK_TIMEOUT_MS = 10_000;

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function formatEndpoint(ep: MonitoredEndpoint): Record<string, unknown> {
  return {
    id: ep.id,
    endpoint_url: ep.endpoint_url,
    label: ep.label,
    tier: ep.tier,
    check_interval_minutes: ep.check_interval_minutes,
    status: ep.status,
    last_status: ep.last_status,
    last_response_ms: ep.last_response_ms,
    last_checked_at: ep.last_checked_at,
    consecutive_failures: ep.consecutive_failures,
    alert_webhook: ep.alert_webhook ? "(set)" : null,
    owner_address: ep.owner_address,
    expires_at: ep.expires_at,
    created_at: ep.created_at,
  };
}

function cmdList(args: string[]): void {
  const flags = parseFlags(args);
  const statusFilter = typeof flags["status"] === "string" ? flags["status"] : null;

  const endpoints = getActiveMonitoredEndpoints();
  const filtered = statusFilter
    ? endpoints.filter((ep) => ep.status === statusFilter)
    : endpoints;

  console.log(JSON.stringify({
    count: filtered.length,
    endpoints: filtered.map(formatEndpoint),
  }, null, 2));
}

async function cmdCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const id = typeof flags["id"] === "string" ? parseInt(flags["id"], 10) : 0;
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const ep = getMonitoredEndpoint(id);
  if (!ep) {
    process.stderr.write(`Error: endpoint ${id} not found\n`);
    process.exit(1);
  }

  const start = performance.now();
  try {
    const response = await fetch(ep.endpoint_url, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: "follow",
    });
    const ms = Math.round(performance.now() - start);
    const ok = response.ok;
    const statusLabel = ok ? "healthy" : "degraded";
    const newFailures = ok ? 0 : ep.consecutive_failures + 1;

    updateMonitoredEndpointCheck(ep.id, statusLabel, ms, newFailures);

    console.log(JSON.stringify({
      endpoint_id: ep.id,
      url: ep.endpoint_url,
      status: statusLabel,
      http_status: response.status,
      response_ms: ms,
      consecutive_failures: newFailures,
      checked_at: new Date().toISOString(),
    }, null, 2));

    if (!ok) process.exit(1);
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const newFailures = ep.consecutive_failures + 1;
    updateMonitoredEndpointCheck(ep.id, "down", ms, newFailures);

    console.log(JSON.stringify({
      endpoint_id: ep.id,
      url: ep.endpoint_url,
      status: "down",
      http_status: 0,
      response_ms: ms,
      error: e instanceof Error ? e.message : String(e),
      consecutive_failures: newFailures,
      checked_at: new Date().toISOString(),
    }, null, 2));
    process.exit(1);
  }
}

function cmdAdd(args: string[]): void {
  const flags = parseFlags(args);
  const url = typeof flags["url"] === "string" ? flags["url"].trim() : "";
  if (!url) {
    process.stderr.write("Error: --url is required\n");
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    process.stderr.write("Error: --url must be a valid URL\n");
    process.exit(1);
  }

  const tier = typeof flags["tier"] === "string" ? flags["tier"] : "basic";
  if (tier !== "basic" && tier !== "pro") {
    process.stderr.write("Error: --tier must be 'basic' or 'pro'\n");
    process.exit(1);
  }

  const label = typeof flags["label"] === "string" ? flags["label"] : null;
  const webhook = typeof flags["webhook"] === "string" ? flags["webhook"] : null;
  const owner = typeof flags["owner"] === "string" ? flags["owner"] : null;

  const intervalMinutes = tier === "pro" ? 5 : 60;

  const id = insertMonitoredEndpoint({
    endpoint_url: url,
    label,
    tier,
    check_interval_minutes: intervalMinutes,
    alert_webhook: webhook,
    owner_address: owner,
  });

  console.log(JSON.stringify({
    id,
    endpoint_url: url,
    tier,
    check_interval_minutes: intervalMinutes,
    status: "active",
    label,
    alert_webhook: webhook ? "(set)" : null,
  }, null, 2));
}

function cmdRemove(args: string[]): void {
  const flags = parseFlags(args);
  const id = typeof flags["id"] === "string" ? parseInt(flags["id"], 10) : 0;
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const ep = getMonitoredEndpoint(id);
  if (!ep) {
    process.stderr.write(`Error: endpoint ${id} not found\n`);
    process.exit(1);
  }

  deleteMonitoredEndpoint(id);
  console.log(JSON.stringify({ removed: id, endpoint_url: ep.endpoint_url }));
}

function cmdReport(args: string[]): void {
  const flags = parseFlags(args);
  const id = typeof flags["id"] === "string" ? parseInt(flags["id"], 10) : 0;
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const ep = getMonitoredEndpoint(id);
  if (!ep) {
    process.stderr.write(`Error: endpoint ${id} not found\n`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ...formatEndpoint(ep),
    health_summary: {
      current_status: ep.last_status ?? "unknown",
      consecutive_failures: ep.consecutive_failures,
      last_response_ms: ep.last_response_ms,
      last_checked_at: ep.last_checked_at,
      monitoring_since: ep.created_at,
    },
  }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`arc-monitoring-service CLI

USAGE
  arc skills run --name arc-monitoring-service -- <subcommand> [flags]

SUBCOMMANDS
  list [--status active|paused|expired]
    List monitored endpoints.

  check --id N
    Run an on-demand health check for endpoint N.

  add --url URL [--tier basic|pro] [--label LABEL] [--webhook URL] [--owner ADDRESS]
    Register a new endpoint for monitoring.

  remove --id N
    Remove a monitored endpoint.

  report --id N
    Show health report for endpoint N.

EXAMPLES
  arc skills run --name arc-monitoring-service -- add --url https://example.com --tier pro --label "My API"
  arc skills run --name arc-monitoring-service -- check --id 1
  arc skills run --name arc-monitoring-service -- list
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "list":
      cmdList(args.slice(1));
      break;
    case "check":
      await cmdCheck(args.slice(1));
      break;
    case "add":
      cmdAdd(args.slice(1));
      break;
    case "remove":
      cmdRemove(args.slice(1));
      break;
    case "report":
      cmdReport(args.slice(1));
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
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
