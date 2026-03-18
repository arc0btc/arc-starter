// skills/arc0btc-deploy-monitor/sensor.ts
//
// Unified deployment monitor for all arc0btc org sites.
// Consolidates arc0btc-site-health + site-consistency into one sensor.
// Checks: uptime, API health, content freshness, structural consistency,
// and worker-logs error counts.

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "arc0btc-deploy-monitor";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE = "sensor:arc0btc-deploy-monitor";
const FRESHNESS_DAYS = 2;
const FETCH_TIMEOUT = 10_000;

const log = createSensorLogger(SENSOR_NAME);

interface CheckResult {
  site: string;
  check: string;
  ok: boolean;
  detail: string;
}

// ---- arc0.me checks ----

async function checkArc0me(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "arc0.me";

  // Uptime
  try {
    const response = await fetch("https://arc0.me", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}` });

    if (response.ok) {
      const body = await response.text();

      // Structural: should NOT have /services/ content on blog
      // (checking body for services link is cheaper than a separate fetch)
      const linksToArc0btc = body.includes("arc0btc.com");
      results.push({
        site,
        check: "links-to-arc0btc",
        ok: linksToArc0btc,
        detail: linksToArc0btc ? "cross-link found" : "DRIFT: no link to arc0btc.com",
      });
    }
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results; // Skip dependent checks
  }

  // Structural: no /services/ route
  try {
    const response = await fetch("https://arc0.me/services", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
    });
    results.push({
      site,
      check: "no-services",
      ok: response.status !== 200,
      detail: response.status === 200 ? "DRIFT: /services/ exists on blog" : `HTTP ${response.status} (expected)`,
    });
  } catch {
    results.push({ site, check: "no-services", ok: true, detail: "unreachable (expected)" });
  }

  // Structural: no x402 endpoint
  try {
    const response = await fetch("https://arc0.me/.well-known/x402", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    results.push({
      site,
      check: "no-x402",
      ok: response.status !== 200,
      detail: response.status === 200 ? "DRIFT: x402 exists on blog" : `HTTP ${response.status} (expected)`,
    });
  } catch {
    results.push({ site, check: "no-x402", ok: true, detail: "unreachable (expected)" });
  }

  // API health
  try {
    const response = await fetch("https://arc0.me/api/posts.json", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!response.ok) {
      results.push({ site, check: "api", ok: false, detail: `HTTP ${response.status}` });
    } else {
      const data = await response.json();
      if (!Array.isArray(data)) {
        results.push({ site, check: "api", ok: false, detail: "response is not an array" });
      } else {
        results.push({ site, check: "api", ok: true, detail: `${data.length} posts` });

        // Content freshness (derived from API response)
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
        } else {
          results.push({ site, check: "freshness", ok: false, detail: "no valid dates in posts" });
        }
      }
    }
  } catch (e) {
    results.push({ site, check: "api", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return results;
}

// ---- arc0btc.com checks ----

async function checkArc0btc(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "arc0btc.com";

  // Uptime + structural checks from main page
  try {
    const response = await fetch("https://arc0btc.com", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}` });

    if (response.ok) {
      const body = await response.text();
      const bodyLower = body.toLowerCase();

      results.push({
        site,
        check: "has-services",
        ok: bodyLower.includes("service"),
        detail: bodyLower.includes("service") ? "services content found" : "DRIFT: no services content",
      });

      results.push({
        site,
        check: "links-to-arc0me",
        ok: body.includes("arc0.me"),
        detail: body.includes("arc0.me") ? "cross-link found" : "DRIFT: no link to arc0.me",
      });
    }
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results;
  }

  // x402 endpoint should exist
  try {
    const response = await fetch("https://arc0btc.com/.well-known/x402", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    results.push({
      site,
      check: "has-x402",
      ok: response.status === 200,
      detail: response.status === 200 ? "x402 present" : `DRIFT: x402 missing (HTTP ${response.status})`,
    });
  } catch (e) {
    results.push({ site, check: "has-x402", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return results;
}

// ---- logs.arc0btc.com checks ----

async function checkWorkerLogs(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const site = "logs.arc0btc.com";

  // Uptime
  try {
    const response = await fetch("https://logs.arc0btc.com", { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    results.push({ site, check: "uptime", ok: response.ok, detail: `HTTP ${response.status}` });
  } catch (e) {
    results.push({ site, check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return results;
  }

  // Error count via /stats (admin key required)
  const adminKey = await getCredential("worker-logs", "arc0btc_admin_api_key");
  if (!adminKey) {
    results.push({ site, check: "error-count", ok: true, detail: "no admin key, skipping stats" });
    return results;
  }

  try {
    const appsRes = await fetchWithRetry("https://logs.arc0btc.com/apps", {
      headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });

    if (!appsRes.ok) {
      results.push({ site, check: "error-count", ok: true, detail: `apps API returned ${appsRes.status}` });
      return results;
    }

    const appsData = (await appsRes.json()) as { data?: string[] } | string[];
    const apps: string[] = Array.isArray(appsData) ? appsData : appsData.data ?? [];

    let totalErrors = 0;
    for (const appId of apps) {
      const statsRes = await fetchWithRetry(`https://logs.arc0btc.com/stats/${appId}?days=1`, {
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

    const errorThreshold = 10;
    results.push({
      site,
      check: "error-count",
      ok: totalErrors < errorThreshold,
      detail: `${totalErrors} error(s) in last 24h${totalErrors >= errorThreshold ? ` (threshold: ${errorThreshold})` : ""}`,
    });
  } catch (e) {
    results.push({ site, check: "error-count", ok: true, detail: `stats query failed: ${e instanceof Error ? e.message : String(e)}` });
  }

  return results;
}

// ---- Main sensor ----

export default async function arc0btcDeployMonitorSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const [arc0meResults, arc0btcResults, logsResults] = await Promise.allSettled([
      checkArc0me(),
      checkArc0btc(),
      checkWorkerLogs(),
    ]);

    const allChecks: CheckResult[] = [
      ...(arc0meResults.status === "fulfilled" ? arc0meResults.value : []),
      ...(arc0btcResults.status === "fulfilled" ? arc0btcResults.value : []),
      ...(logsResults.status === "fulfilled" ? logsResults.value : []),
    ];

    const failures = allChecks.filter((c) => !c.ok);

    if (failures.length === 0) {
      log(`all ${allChecks.length} checks passed`);
      return "ok";
    }

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log(`${failures.length} issue(s) but alert task already pending`);
      return "ok";
    }

    const failSummary = failures.map((f) => `- [${f.site}] ${f.check}: ${f.detail}`).join("\n");
    const allSummary = allChecks.map((c) => `- [${c.site}] ${c.check}: ${c.ok ? "OK" : "FAIL"} — ${c.detail}`).join("\n");

    const affectedSites = [...new Set(failures.map((f) => f.site))].join(", ");

    insertTask({
      subject: `Deploy monitor: ${failures.length} issue(s) on ${affectedSites}`,
      description:
        `arc0btc deployment health check detected issues:\n\n` +
        `**Failures:**\n${failSummary}\n\n` +
        `**Full results:**\n${allSummary}\n\n` +
        `Run: arc skills run --name arc0btc-deploy-monitor -- check --verbose`,
      skills: JSON.stringify(["arc0btc-deploy-monitor"]),
      source: TASK_SOURCE,
      priority: 3,
      model: "sonnet",
    });

    log(`created alert task: ${failures.length} issue(s) on ${affectedSites}`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
