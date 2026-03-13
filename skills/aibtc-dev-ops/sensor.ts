// aibtc-dev/sensor.ts
//
// Log review (every 4h): queries worker-logs REST API for errors
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "aibtc-dev-ops";
const INTERVAL_MINUTES = 240; // 4 hours

const LOG_SOURCE = "sensor:aibtc-dev-ops-logs";

const WORKER_LOGS_HOST = "https://logs.aibtc.com";

const log = createSensorLogger(SENSOR_NAME);

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

// ---- Main ----

export default async function aibtcDevSensor(): Promise<string> {
  // Read state BEFORE claimSensorRun to preserve custom fields
  const statePre = await readHookState(SENSOR_NAME);
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
      });
    }
  } else {
    log("worker-logs/aibtc_api_key not set — skipping log review");
  }

  log(`sensor complete — ${tasksCreated} task(s) created`);
  return "ok";
}
