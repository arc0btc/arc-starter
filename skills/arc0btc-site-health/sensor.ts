// skills/arc0btc-site-health/sensor.ts
//
// Monitors arc0btc.com (arc0.me) every 30 minutes.
// Checks: uptime, API health, content freshness, deploy drift.
// Creates alert tasks when issues are detected.

import { claimSensorRun, createSensorLogger, readHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SENSOR_NAME = "arc0btc-site-health";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE = "sensor:arc0btc-site-health";
const SITE_URL = "https://arc0.me";
const API_URL = "https://arc0.me/api/posts.json";
const FRESHNESS_DAYS = 14;
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");

const log = createSensorLogger(SENSOR_NAME);

interface HealthResult {
  check: string;
  ok: boolean;
  detail: string;
}

async function checkUptime(): Promise<HealthResult> {
  try {
    const response = await fetch(SITE_URL, { signal: AbortSignal.timeout(10_000) });
    return {
      check: "uptime",
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status} ${response.statusText}`,
    };
  } catch (e) {
    return { check: "uptime", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkApi(): Promise<HealthResult> {
  try {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return { check: "api", ok: false, detail: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const isArray = Array.isArray(data);
    return {
      check: "api",
      ok: isArray,
      detail: isArray ? `${data.length} posts returned` : "response is not an array",
    };
  } catch (e) {
    return { check: "api", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkContentFreshness(): Promise<HealthResult> {
  try {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return { check: "freshness", ok: false, detail: "could not fetch posts API" };
    }
    const posts = (await response.json()) as Array<{ date?: string; pubDate?: string }>;
    if (!Array.isArray(posts) || posts.length === 0) {
      return { check: "freshness", ok: false, detail: "no posts found" };
    }
    // Find the most recent post date
    const dates = posts
      .map((p) => new Date(p.date ?? p.pubDate ?? ""))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    if (dates.length === 0) {
      return { check: "freshness", ok: false, detail: "no valid dates in posts" };
    }

    const latestDate = dates[0];
    const ageDays = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24);
    const ok = ageDays <= FRESHNESS_DAYS;
    return {
      check: "freshness",
      ok,
      detail: `latest post ${Math.floor(ageDays)}d ago (threshold: ${FRESHNESS_DAYS}d)`,
    };
  } catch (e) {
    return { check: "freshness", ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDeployDrift(): Promise<HealthResult> {
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

export default async function arc0btcSiteHealthSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const results = await Promise.allSettled([
      checkUptime(),
      checkApi(),
      checkContentFreshness(),
      checkDeployDrift(),
    ]);

    const checks = results
      .filter((r): r is PromiseFulfilledResult<HealthResult> => r.status === "fulfilled")
      .map((r) => r.value);

    const failures = checks.filter((c) => !c.ok);

    if (failures.length === 0) {
      log("all checks passed");
      return "ok";
    }

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log(`${failures.length} issue(s) but alert task already pending`);
      return "ok";
    }

    const failSummary = failures.map((f) => `- ${f.check}: ${f.detail}`).join("\n");
    const allSummary = checks.map((c) => `- ${c.check}: ${c.ok ? "OK" : "FAIL"} — ${c.detail}`).join("\n");

    insertTask({
      subject: `arc0btc.com health alert: ${failures.length} issue(s)`,
      description:
        `Site health check detected issues on arc0.me:\n\n` +
        `**Failures:**\n${failSummary}\n\n` +
        `**Full results:**\n${allSummary}\n\n` +
        `Run: arc skills run --name arc0btc-site-health -- check --verbose`,
      skills: JSON.stringify(["arc0btc-site-health", "blog-deploy"]),
      source: TASK_SOURCE,
      priority: 3,
      model: "sonnet",
    });

    log(`created alert task: ${failures.length} issue(s)`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
