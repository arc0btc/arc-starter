// aibtc-dev/sensor.ts
//
// Dual-cadence sensor:
// - Log review (every 4h): queries worker-logs REST API for errors
// - Repo audit (every 24h): runs production-grade checklist via GitHub API
// Pure TypeScript — no LLM.

import { spawnSync } from "node:child_process";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "aibtc-dev";
const INTERVAL_MINUTES = 240; // 4 hours
const AUDIT_INTERVAL_HOURS = 24;

const LOG_SOURCE = "sensor:aibtc-dev-logs";
const AUDIT_SOURCE = "sensor:aibtc-dev-audit";

const WORKER_LOGS_HOST = "https://logs.aibtc.com";

const AIBTC_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/skills",
  "aibtcdev/worker-logs",
  "aibtcdev/ai-agent-crew",
  "aibtcdev/agent-news",
  "aibtcdev/aibtc-projects",
  "aibtcdev/bitcoin-ai-agent-crew-frontend",
  "aibtcdev/agent-tools-ts",
  "aibtcdev/communication-tools",
  "aibtcdev/ai-agent-chrome-extension",
];

const log = createSensorLogger(SENSOR_NAME);

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { timeout: 30_000 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
  };
}

// ---- Log Review ----

interface LogEntry {
  id: string;
  app: string;
  level: string;
  message: string;
  timestamp: string;
}

async function checkWorkerLogs(adminKey: string, since: string): Promise<LogEntry[]> {
  try {
    const url = `${WORKER_LOGS_HOST}/logs?level=ERROR&limit=50&since=${encodeURIComponent(since)}`;
    const resp = await fetch(url, {
      headers: { "X-Admin-Key": adminKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      log(`worker-logs API returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return Array.isArray(data) ? (data as LogEntry[]) : [];
  } catch (err) {
    log(`worker-logs fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ---- Repo Audit ----

interface AuditResult {
  repo: string;
  gaps: string[];
}

function auditRepo(repo: string): AuditResult {
  const gaps: string[] = [];

  // Check tsconfig.json for strict mode
  const tsconfig = gh(["api", `repos/${repo}/contents/tsconfig.json`, "--jq", ".content"]);
  if (tsconfig.ok && tsconfig.stdout) {
    try {
      const content = Buffer.from(tsconfig.stdout, "base64").toString("utf-8");
      if (!content.includes('"strict"') || !content.includes("true")) {
        gaps.push("TypeScript strict mode not enabled");
      }
    } catch {
      gaps.push("Could not parse tsconfig.json");
    }
  } else {
    gaps.push("No tsconfig.json found");
  }

  // Check for test files
  const tests = gh(["api", `repos/${repo}/git/trees/main?recursive=1`, "--jq",
    '[.tree[].path | select(test("\\.(test|spec)\\.ts$"))] | length']);
  if (tests.ok) {
    const count = parseInt(tests.stdout, 10);
    if (isNaN(count) || count === 0) {
      gaps.push("No test files found");
    }
  }

  // Check for CI workflows
  const workflows = gh(["api", `repos/${repo}/contents/.github/workflows`, "--jq", "length"]);
  if (!workflows.ok || workflows.stdout === "0") {
    gaps.push("No CI workflows found");
  }

  // Check for wrangler config (jsonc preferred)
  const wranglerJsonc = gh(["api", `repos/${repo}/contents/wrangler.jsonc`, "--jq", ".name"]);
  const wranglerToml = gh(["api", `repos/${repo}/contents/wrangler.toml`, "--jq", ".name"]);
  if (!wranglerJsonc.ok && wranglerToml.ok) {
    gaps.push("Using wrangler.toml instead of wrangler.jsonc");
  } else if (!wranglerJsonc.ok && !wranglerToml.ok) {
    // Not a Workers project, skip remaining Workers-specific checks
    return { repo, gaps };
  }

  // Check for release-please config (required — raw merge-to-main deploys are a gap)
  const releasePlease = gh(["api", `repos/${repo}/contents/.release-please-manifest.json`, "--jq", ".name"]);
  const releasePleaseConfig = gh(["api", `repos/${repo}/contents/release-please-config.json`, "--jq", ".name"]);
  if (!releasePlease.ok && !releasePleaseConfig.ok) {
    gaps.push("No release-please configuration");
  }

  return { repo, gaps };
}

// ---- Main ----

export default async function aibtcDevSensor(): Promise<string> {
  // Read state BEFORE claimSensorRun to preserve custom fields
  const statePre = await readHookState(SENSOR_NAME);
  const lastAuditTimestamp = (statePre as Record<string, unknown> | null)?.lastAuditTimestamp as string | undefined;
  const lastLogCheck = (statePre as Record<string, unknown> | null)?.lastLogCheck as string | undefined;

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Read state AFTER claimSensorRun to get updated base fields
  const state = await readHookState(SENSOR_NAME);

  let tasksCreated = 0;

  // ---- Log Review (every 4h) ----
  let adminKey: string | null = null;
  try {
    adminKey = await getCredential("worker-logs", "admin_api_key");
  } catch {
    // credential store not available
  }

  if (adminKey) {
    if (!pendingTaskExistsForSource(LOG_SOURCE)) {
      const since = lastLogCheck ?? new Date(Date.now() - 4 * 3600_000).toISOString();
      const errors = await checkWorkerLogs(adminKey, since);

      if (errors.length > 0) {
        const apps = [...new Set(errors.map((e) => e.app))];
        log(`found ${errors.length} errors across ${apps.length} apps — creating log review task`);

        insertTask({
          subject: `Review ${errors.length} worker-logs errors across ${apps.join(", ")}`,
          description: [
            `${errors.length} ERROR-level log entries found since ${since}.`,
            `Affected apps: ${apps.join(", ")}`,
            "",
            "Instructions:",
            "1. Read skills/aibtc-dev/AGENT.md before acting.",
            "2. Run: arc skills run --name aibtc-dev -- logs --level ERROR --limit 50",
            "3. Correlate errors with known issues. File or update GitHub issues.",
          ].join("\n"),
          skills: '["aibtc-dev"]',
          priority: 6,
          source: LOG_SOURCE,
        });
        tasksCreated++;
      } else {
        log("no errors in worker-logs since last check");
      }
    } else {
      log("pending log review task exists — skipping");
    }

    // Update lastLogCheck timestamp
    if (state) {
      await writeHookState(SENSOR_NAME, {
        ...state,
        lastLogCheck: new Date().toISOString(),
        lastAuditTimestamp: lastAuditTimestamp ?? "",
      } as typeof state);
    }
  } else {
    log("worker-logs/admin_api_key not set — skipping log review");
  }

  // ---- Repo Audit (every 24h) ----
  const now = Date.now();
  const lastAuditMs = lastAuditTimestamp ? new Date(lastAuditTimestamp).getTime() : 0;
  const auditDue = now - lastAuditMs > AUDIT_INTERVAL_HOURS * 3600_000;

  if (auditDue) {
    if (!pendingTaskExistsForSource(AUDIT_SOURCE)) {
      log("running repo audit checks...");

      const results: AuditResult[] = [];
      for (const repo of AIBTC_REPOS) {
        const result = auditRepo(repo);
        if (result.gaps.length > 0) {
          results.push(result);
        }
      }

      if (results.length > 0) {
        const totalGaps = results.reduce((sum, r) => sum + r.gaps.length, 0);
        log(`found ${totalGaps} gaps across ${results.length} repos — creating audit task`);

        const gapSummary = results
          .map((r) => `- ${r.repo}: ${r.gaps.join(", ")}`)
          .join("\n");

        insertTask({
          subject: `Repo audit: ${totalGaps} production-grade gaps across ${results.length} repos`,
          description: [
            `Production-grade audit found ${totalGaps} gaps across ${results.length} of ${AIBTC_REPOS.length} repos.`,
            "",
            "Gaps found:",
            gapSummary,
            "",
            "Instructions:",
            "1. Read skills/aibtc-dev/AGENT.md before acting.",
            "2. Run: arc skills run --name aibtc-dev -- audit",
            "3. Check for existing prod-grade labeled issues before filing new ones.",
            "4. File one issue per gap per repo. Label: prod-grade, enhancement.",
          ].join("\n"),
          skills: '["aibtc-dev"]',
          priority: 7,
          source: AUDIT_SOURCE,
        });
        tasksCreated++;
      } else {
        log("all repos pass production-grade checklist");
      }
    } else {
      log("pending audit task exists — skipping");
    }

    // Update lastAuditTimestamp
    const currentState = await readHookState(SENSOR_NAME);
    if (currentState) {
      await writeHookState(SENSOR_NAME, {
        ...currentState,
        lastAuditTimestamp: new Date().toISOString(),
        lastLogCheck: (currentState as Record<string, unknown>).lastLogCheck ?? lastLogCheck ?? "",
      } as typeof currentState);
    }
  } else {
    const hoursUntilAudit = Math.round((AUDIT_INTERVAL_HOURS * 3600_000 - (now - lastAuditMs)) / 3600_000);
    log(`repo audit not due for ~${hoursUntilAudit}h — skipping`);
  }

  log(`sensor complete — ${tasksCreated} task(s) created`);
  return "ok";
}
