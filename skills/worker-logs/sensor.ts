// worker-logs/sensor.ts
//
// Checks every 360 minutes if any worker-logs fork is behind upstream.
// Creates a sync task when drift is detected.
// Pure TypeScript — no LLM.

import { spawnSync } from "node:child_process";
import { claimSensorRun } from "../../src/sensors.ts";
import {
  initDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";

const SENSOR_NAME = "worker-logs";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:worker-logs-sync";

const UPSTREAM = "whoabuddy/worker-logs";
const FORKS = ["aibtcdev/worker-logs", "arc0btc/worker-logs"];

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [worker-logs/sensor] ${msg}`);
}

interface CompareResult {
  repo: string;
  behind: number;
  error?: string;
}

/** Compare a fork's main branch against upstream main. Returns commits behind count. */
function checkForkDrift(fork: string): CompareResult {
  try {
    const result = spawnSync(
      "gh",
      ["api", `repos/${fork}/compare/main...${UPSTREAM.replace("/", ":")}:main`, "--jq", ".behind_by"],
      { timeout: 15_000 }
    );

    const stdout = result.stdout?.toString().trim() ?? "";
    const stderr = result.stderr?.toString().trim() ?? "";

    if (result.status !== 0) {
      return { repo: fork, behind: 0, error: stderr || "gh api failed" };
    }

    const behind = parseInt(stdout, 10);
    return { repo: fork, behind: isNaN(behind) ? 0 : behind };
  } catch (err) {
    return {
      repo: fork,
      behind: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function workerLogsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("sync task already pending — skipping");
    return "skip";
  }

  const results = FORKS.map(checkForkDrift);
  const drifted = results.filter((r) => r.behind > 0);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    for (const e of errors) {
      log(`error checking ${e.repo}: ${e.error}`);
    }
  }

  if (drifted.length === 0) {
    log("all forks in sync with upstream");
    return "ok";
  }

  const driftSummary = drifted
    .map((r) => `${r.repo}: ${r.behind} commits behind`)
    .join(", ");

  log(`drift detected: ${driftSummary}`);

  insertTask({
    subject: `worker-logs sync needed — ${driftSummary}`,
    description:
      `Fork drift detected against upstream (${UPSTREAM}).\n\n` +
      drifted.map((r) => `- ${r.repo}: ${r.behind} commits behind`).join("\n") +
      `\n\nUse the worker-logs sync command to create PRs:\n` +
      `arc skills run --name worker-logs -- sync\n\n` +
      `Follow instructions in skills/worker-logs/AGENT.md.`,
    skills: '["worker-logs"]',
    source: TASK_SOURCE,
    priority: 6,
  });

  return "ok";
}
