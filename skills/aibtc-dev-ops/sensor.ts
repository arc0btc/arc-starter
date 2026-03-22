// aibtc-dev/sensor.ts
//
// Dual-cadence sensor:
// - Log review (every 4h): queries worker-logs REST API for errors
// - Repo audit (every 24h): runs production-grade checklist via GitHub API
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

const SENSOR_NAME = "aibtc-dev-ops";
const INTERVAL_MINUTES = 240; // 4 hours
const AUDIT_INTERVAL_HOURS = 24;

const LOG_SOURCE = "sensor:aibtc-dev-ops-logs";
const AUDIT_SOURCE = "sensor:aibtc-dev-ops-audit";

const WORKER_LOGS_HOST = "https://logs.aibtc.com";

/**
 * Per-repo production expectations.
 *
 * Each repo gets a profile describing what checks apply. Repos that don't use
 * TypeScript shouldn't be flagged for missing tsconfig. Repos without a test
 * runner shouldn't be flagged for missing tests. This prevents the audit from
 * generating false positives on repos with different tech stacks.
 */
interface RepoProfile {
  /** Expect tsconfig.json with strict:true */
  typescript: boolean;
  /** Expect *.test.ts or *.spec.ts files */
  tests: boolean;
  /** Expect wrangler config (Workers project) */
  workers: boolean;
  /** Expect release-please config (only checked if workers=true) */
  releasePlease: boolean;
}

const REPO_PROFILES: Record<string, RepoProfile> = {
  "aibtcdev/landing-page":     { typescript: true,  tests: true,  workers: true,  releasePlease: false },
  "aibtcdev/skills":           { typescript: true,  tests: true,  workers: false, releasePlease: true  },
  "aibtcdev/x402-api":         { typescript: true,  tests: true,  workers: true,  releasePlease: true  },
  "aibtcdev/aibtc-mcp-server": { typescript: true,  tests: true,  workers: false, releasePlease: true  },
  "aibtcdev/agent-news":       { typescript: false, tests: false, workers: true,  releasePlease: false },
};

/** Repos to audit — only repos with defined profiles. */
const AUDIT_REPOS = AIBTC_WATCHED_REPOS.filter((r) => r in REPO_PROFILES);

const log = createSensorLogger(SENSOR_NAME);

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args], { timeout: 30_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
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
      headers: { "X-Api-Key": adminKey, "X-App-ID": "aibtc-mainnet" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      log(`worker-logs API returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return Array.isArray(data) ? (data as LogEntry[]) : [];
  } catch (error) {
    log(`worker-logs fetch failed: ${error instanceof Error ? error.message : String(error)}`);
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
  const profile = REPO_PROFILES[repo];
  if (!profile) return { repo, gaps }; // unknown repo — skip

  // TypeScript strict mode (only for TS repos)
  if (profile.typescript) {
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
  }

  // Test files (only for repos expected to have tests)
  if (profile.tests) {
    const tests = gh(["api", `repos/${repo}/git/trees/main?recursive=1`, "--jq",
      '[.tree[].path | select(test("\\.(test|spec)\\.(ts|js)$"))] | length']);
    if (tests.ok) {
      const count = parseInt(tests.stdout, 10);
      if (isNaN(count) || count === 0) {
        gaps.push("No test files found");
      }
    }
  }

  // Release-please (only for repos that should have it)
  if (profile.releasePlease) {
    const releasePlease = gh(["api", `repos/${repo}/contents/.release-please-manifest.json`, "--jq", ".name"]);
    const releasePleaseConfig = gh(["api", `repos/${repo}/contents/release-please-config.json`, "--jq", ".name"]);
    const releasePleaseWorkflow = gh(["api", `repos/${repo}/contents/.github/workflows/release-please.yml`, "--jq", ".name"]);
    if (!releasePlease.ok && !releasePleaseConfig.ok && !releasePleaseWorkflow.ok) {
      gaps.push("No release-please configuration");
    }
  }

  return { repo, gaps };
}

// ---- Main ----

export default async function aibtcDevSensor(): Promise<string> {
  // Read state BEFORE claimSensorRun to preserve custom fields
  const statePre = await readHookState(SENSOR_NAME);
  const lastAuditTimestamp = statePre?.lastAuditTimestamp as string | undefined;
  const lastLogCheck = statePre?.lastLogCheck as string | undefined;

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Read state AFTER claimSensorRun to get updated base fields
  const state = await readHookState(SENSOR_NAME);

  let tasksCreated = 0;

  // ---- Log Review (every 4h) ----
  let apiKey: string | null = null;
  try {
    apiKey = await getCredential("worker-logs", "aibtc_api_key");
  } catch {
    // credential store not available
  }

  if (apiKey) {
    if (!pendingTaskExistsForSource(LOG_SOURCE)) {
      const since = lastLogCheck ?? new Date(Date.now() - 4 * 3600_000).toISOString();
      const errors = await checkWorkerLogs(apiKey, since);

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
            "1. Read skills/aibtc-dev-ops/AGENT.md before acting.",
            "2. Run: arc skills run --name aibtc-dev -- logs --level ERROR --limit 50",
            "3. Correlate errors with known issues. File or update GitHub issues.",
          ].join("\n"),
          skills: '["aibtc-dev-ops"]',
          priority: 6,
          model: "sonnet",
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
      });
    }
  } else {
    log("worker-logs/aibtc_api_key not set — skipping log review");
  }

  // ---- Repo Audit (every 24h) ----
  const now = Date.now();
  const lastAuditMs = lastAuditTimestamp ? new Date(lastAuditTimestamp).getTime() : 0;
  const auditDue = now - lastAuditMs > AUDIT_INTERVAL_HOURS * 3600_000;

  if (auditDue) {
    if (!pendingTaskExistsForSource(AUDIT_SOURCE)) {
      log("running repo audit checks...");

      const results: AuditResult[] = [];
      for (const repo of AUDIT_REPOS) {
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
            `Production-grade audit found ${totalGaps} gaps across ${results.length} of ${AUDIT_REPOS.length} repos.`,
            "",
            "Gaps found:",
            gapSummary,
            "",
            "Instructions:",
            "1. Read skills/aibtc-dev-ops/AGENT.md before acting.",
            "2. Run: arc skills run --name aibtc-dev -- audit",
            "3. Check for existing prod-grade labeled issues before filing new ones.",
            "4. File one issue per gap per repo. Label: prod-grade, enhancement.",
          ].join("\n"),
          skills: '["aibtc-dev-ops"]',
          priority: 7,
          model: "sonnet",
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
        lastLogCheck: currentState.lastLogCheck ?? lastLogCheck ?? "",
      });
    }
  } else {
    const hoursUntilAudit = Math.round((AUDIT_INTERVAL_HOURS * 3600_000 - (now - lastAuditMs)) / 3600_000);
    log(`repo audit not due for ~${hoursUntilAudit}h — skipping`);
  }

  log(`sensor complete — ${tasksCreated} task(s) created`);
  return "ok";
}
