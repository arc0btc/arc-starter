#!/usr/bin/env bun

// skills/arc0btc-deploy-monitor/cli.ts
//
// On-demand health check for all arc0btc org deployments.

import { getCredential } from "../../src/credentials.ts";

const FETCH_TIMEOUT = 10_000;
const FRESHNESS_DAYS = 2;

interface CheckResult {
  site: string;
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

async function timedFetch(url: string): Promise<{ response: Response; body: string; ms: number }> {
  const start = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), redirect: "follow" });
  const body = await response.text();
  const ms = Math.round(performance.now() - start);
  return { response, body, ms };
}

// ---- arc0.me ----

async function checkArc0me(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "arc0.me";

  // Uptime
  let mainBody = "";
  try {
    const { response, body, ms } = await timedFetch("https://arc0.me");
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}`, response_ms: ms });
    mainBody = body;

    if (response.ok) {
      const linksToArc0btc = body.includes("arc0btc.com");
      results.push({ site, check: "links-to-arc0btc", ok: linksToArc0btc, detail: linksToArc0btc ? "found" : "DRIFT: missing" });
    }
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results;
  }

  // No /services/
  try {
    const { response, ms } = await timedFetch("https://arc0.me/services");
    results.push({
      site,
      check: "no-services",
      ok: response.status !== 200,
      detail: response.status === 200 ? "DRIFT: /services/ exists" : `HTTP ${response.status} (expected)`,
      response_ms: ms,
    });
  } catch {
    results.push({ site, check: "no-services", ok: true, detail: "unreachable (expected)" });
  }

  // No x402
  try {
    const { response, ms } = await timedFetch("https://arc0.me/.well-known/x402");
    results.push({
      site,
      check: "no-x402",
      ok: response.status !== 200,
      detail: response.status === 200 ? "DRIFT: x402 exists" : `HTTP ${response.status} (expected)`,
      response_ms: ms,
    });
  } catch {
    results.push({ site, check: "no-x402", ok: true, detail: "unreachable (expected)" });
  }

  // API + freshness
  try {
    const { response, body, ms } = await timedFetch("https://arc0.me/api/posts.json");
    if (!response.ok) {
      results.push({ site, check: "api", ok: false, detail: `HTTP ${response.status}`, response_ms: ms });
    } else {
      let data: unknown;
      try { data = JSON.parse(body); } catch { data = null; }

      if (!Array.isArray(data)) {
        results.push({ site, check: "api", ok: false, detail: "not an array", response_ms: ms });
      } else {
        results.push({ site, check: "api", ok: true, detail: `${data.length} posts`, response_ms: ms });

        const dates = (data as Array<{ date?: string; pubDate?: string }>)
          .map((p) => new Date(p.date ?? p.pubDate ?? ""))
          .filter((d) => !isNaN(d.getTime()))
          .sort((a, b) => b.getTime() - a.getTime());

        if (dates.length > 0) {
          const ageDays = (Date.now() - dates[0].getTime()) / (1000 * 60 * 60 * 24);
          results.push({
            site,
            check: "freshness",
            ok: ageDays <= FRESHNESS_DAYS,
            detail: `latest post ${Math.floor(ageDays)}d ago (threshold: ${FRESHNESS_DAYS}d)`,
          });
        }
      }
    }
  } catch (e) {
    results.push({ site, check: "api", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return results;
}

// ---- arc0btc.com ----

async function checkArc0btc(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "arc0btc.com";

  try {
    const { response, body, ms } = await timedFetch("https://arc0btc.com");
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}`, response_ms: ms });

    if (response.ok) {
      const bodyLower = body.toLowerCase();
      results.push({
        site,
        check: "has-services",
        ok: bodyLower.includes("service"),
        detail: bodyLower.includes("service") ? "found" : "DRIFT: missing",
      });
      results.push({
        site,
        check: "links-to-arc0me",
        ok: body.includes("arc0.me"),
        detail: body.includes("arc0.me") ? "found" : "DRIFT: missing",
      });
    }
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results;
  }

  try {
    const { response, ms } = await timedFetch("https://arc0btc.com/.well-known/x402");
    results.push({
      site,
      check: "has-x402",
      ok: response.status === 200,
      detail: response.status === 200 ? "present" : `DRIFT: missing (HTTP ${response.status})`,
      response_ms: ms,
    });
  } catch (e) {
    results.push({ site, check: "has-x402", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return results;
}

// ---- logs.arc0btc.com ----

async function checkWorkerLogs(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "logs.arc0btc.com";

  try {
    const { response, ms } = await timedFetch("https://logs.arc0btc.com");
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}`, response_ms: ms });
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results;
  }

  const adminKey = await getCredential("worker-logs", "arc0btc_admin_api_key");
  if (!adminKey) {
    results.push({ site, check: "error-count", ok: true, detail: "no admin key, skipping stats" });
    return results;
  }

  try {
    const appsRes = await fetch("https://logs.arc0btc.com/apps", {
      headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });

    if (!appsRes.ok) {
      results.push({ site, check: "error-count", ok: true, detail: `apps API HTTP ${appsRes.status}` });
      return results;
    }

    const appsData = (await appsRes.json()) as { data?: string[] } | string[];
    const apps: string[] = Array.isArray(appsData) ? appsData : appsData.data ?? [];

    let totalErrors = 0;
    for (const appId of apps) {
      const statsRes = await fetch(`https://logs.arc0btc.com/stats/${appId}?days=1`, {
        headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!statsRes.ok) continue;

      const statsData = (await statsRes.json()) as { data?: Array<{ error: number }> } | Array<{ error: number }>;
      const stats = Array.isArray(statsData) ? statsData : statsData.data ?? [];
      for (const day of stats) {
        totalErrors += day.error ?? 0;
      }
    }

    results.push({
      site,
      check: "error-count",
      ok: totalErrors < 10,
      detail: `${totalErrors} error(s) in last 24h`,
    });
  } catch (e) {
    results.push({ site, check: "error-count", ok: true, detail: `stats failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  return results;
}

// ---- CLI ----

const SITE_MAP: Record<string, () => Promise<CheckResult[]>> = {
  arc0me: checkArc0me,
  arc0btc: checkArc0btc,
  logs: checkWorkerLogs,
};

async function cmdCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const verbose = flags["verbose"] === true;
  const siteFilter = flags["site"] as string | undefined;

  let allResults: CheckResult[] = [];

  if (siteFilter) {
    const checkFunction = SITE_MAP[siteFilter];
    if (!checkFunction) {
      process.stderr.write(`Error: unknown site '${siteFilter}'. Valid: ${Object.keys(SITE_MAP).join(", ")}\n`);
      process.exit(1);
    }
    allResults = await checkFunction();
  } else {
    const [a, b, c] = await Promise.allSettled([checkArc0me(), checkArc0btc(), checkWorkerLogs()]);
    if (a.status === "fulfilled") allResults.push(...a.value);
    if (b.status === "fulfilled") allResults.push(...b.value);
    if (c.status === "fulfilled") allResults.push(...c.value);
  }

  const failures = allResults.filter((r) => !r.ok);

  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    status: failures.length === 0 ? "healthy" : "degraded",
    total_checks: allResults.length,
    passed: allResults.length - failures.length,
    failed: failures.length,
    checks: verbose
      ? allResults
      : allResults.map(({ site, check, ok, detail }) => ({ site, check, ok, detail })),
  };

  console.log(JSON.stringify(output, null, 2));
  if (failures.length > 0) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`arc0btc-deploy-monitor CLI

USAGE
  arc skills run --name arc0btc-deploy-monitor -- <subcommand> [flags]

SUBCOMMANDS
  check [--verbose] [--site arc0me|arc0btc|logs]
    Run health checks. Default: all sites.
    Returns JSON with per-check results.
    Exit code 1 if any check fails.

EXAMPLES
  arc skills run --name arc0btc-deploy-monitor -- check
  arc skills run --name arc0btc-deploy-monitor -- check --verbose
  arc skills run --name arc0btc-deploy-monitor -- check --site arc0me
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
