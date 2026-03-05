#!/usr/bin/env bun
// skills/arc0btc-site-health/cli.ts
// On-demand health check for arc0btc.com (arc0.me).

import { readHookState } from "../../src/sensors.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SITE_URL = "https://arc0.me";
const API_URL = "https://arc0.me/api/posts.json";
const FRESHNESS_DAYS = 14;
const SITE_DIR = join(process.cwd(), "github/arc0btc/arc0me-site");

interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
  response_ms?: number;
}

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

async function timedFetch(url: string): Promise<{ response: Response; ms: number }> {
  const start = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const ms = Math.round(performance.now() - start);
  return { response, ms };
}

async function checkUptime(): Promise<CheckResult> {
  try {
    const { response, ms } = await timedFetch(SITE_URL);
    return {
      check: "uptime",
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status} ${response.statusText}`,
      response_ms: ms,
    };
  } catch (e) {
    return { check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkApi(): Promise<CheckResult> {
  try {
    const { response, ms } = await timedFetch(API_URL);
    if (!response.ok) {
      return { check: "api", ok: false, detail: `HTTP ${response.status}`, response_ms: ms };
    }
    const data = await response.json();
    const isArray = Array.isArray(data);
    return {
      check: "api",
      ok: isArray,
      detail: isArray ? `${data.length} posts returned` : "response is not an array",
      response_ms: ms,
    };
  } catch (e) {
    return { check: "api", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkContentFreshness(): Promise<CheckResult> {
  try {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return { check: "freshness", ok: false, detail: "could not fetch posts API" };
    }
    const posts = (await response.json()) as Array<{ date?: string; pubDate?: string }>;
    if (!Array.isArray(posts) || posts.length === 0) {
      return { check: "freshness", ok: false, detail: "no posts found" };
    }
    const dates = posts
      .map((p) => new Date(p.date ?? p.pubDate ?? ""))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    if (dates.length === 0) {
      return { check: "freshness", ok: false, detail: "no valid dates in posts" };
    }

    const latestDate = dates[0];
    const ageDays = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24);
    return {
      check: "freshness",
      ok: ageDays <= FRESHNESS_DAYS,
      detail: `latest post ${Math.floor(ageDays)}d ago (threshold: ${FRESHNESS_DAYS}d)`,
    };
  } catch (e) {
    return { check: "freshness", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDeployDrift(): Promise<CheckResult> {
  if (!existsSync(SITE_DIR)) {
    return { check: "deploy-drift", ok: true, detail: "site dir not found, skipping" };
  }

  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: SITE_DIR });
    const currentSha = result.stdout.toString().trim().substring(0, 12);
    if (!currentSha) {
      return { check: "deploy-drift", ok: true, detail: "could not read git HEAD" };
    }

    const state = await readHookState("blog-deploy");
    const lastDeployedSha = (state?.last_deployed_sha as string) ?? "";

    if (!lastDeployedSha) {
      return { check: "deploy-drift", ok: true, detail: "no deploy history yet" };
    }

    const drifted = currentSha !== lastDeployedSha;
    return {
      check: "deploy-drift",
      ok: !drifted,
      detail: drifted
        ? `HEAD ${currentSha} != deployed ${lastDeployedSha}`
        : `deployed at ${currentSha}`,
    };
  } catch (e) {
    return { check: "deploy-drift", ok: true, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function cmdCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const verbose = flags["verbose"] === true;

  const results = await Promise.allSettled([
    checkUptime(),
    checkApi(),
    checkContentFreshness(),
    checkDeployDrift(),
  ]);

  const checks = results
    .filter((r): r is PromiseFulfilledResult<CheckResult> => r.status === "fulfilled")
    .map((r) => r.value);

  const failures = checks.filter((c) => !c.ok);
  const overall = failures.length === 0 ? "healthy" : "degraded";

  const output: Record<string, unknown> = {
    site: SITE_URL,
    status: overall,
    checks_passed: checks.length - failures.length,
    checks_failed: failures.length,
    checked_at: new Date().toISOString(),
  };

  if (verbose) {
    output.checks = checks;
  } else {
    output.checks = checks.map(({ check, ok, detail }) => ({ check, ok, detail }));
  }

  console.log(JSON.stringify(output, null, 2));
  if (failures.length > 0) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`arc0btc-site-health CLI

USAGE
  arc skills run --name arc0btc-site-health -- <subcommand> [flags]

SUBCOMMANDS
  check [--verbose]
    Run all health checks against arc0.me.
    Returns JSON with overall status and per-check results.
    Exit code 1 if any check fails.

EXAMPLES
  arc skills run --name arc0btc-site-health -- check
  arc skills run --name arc0btc-site-health -- check --verbose
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "check":
      await cmdCheck(args.slice(1));
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
