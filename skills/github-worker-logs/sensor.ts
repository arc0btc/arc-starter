// worker-logs/sensor.ts
//
// Monitors worker-logs forks for meaningful upstream drift.
// Only creates tasks when upstream has significant new changes (>3 commits behind).
// Skips known-divergent forks (aibtcdev) since Arc can't resolve that drift.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";

const SENSOR_NAME = "github-worker-logs";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:github-worker-logs-sync";

const UPSTREAM = "whoabuddy/worker-logs";

// Only monitor arc0btc — we own it and can auto-sync.
// aibtcdev/worker-logs has permanent divergence (6 commits ahead with deployment
// customizations). PR #16 is the resolution path; Arc can't auto-resolve it.
const FORKS = ["arc0btc/worker-logs"];

// Ignore small drift — arc0btc is always 1 commit ahead (wrangler config)
// and briefly 1-2 behind after upstream pushes before sync.
// Only alert when upstream has substantial new changes.
const DRIFT_THRESHOLD = 3;

const log = createSensorLogger(SENSOR_NAME);

interface CompareResult {
  repo: string;
  behind: number;
  error?: string;
}

/** Compare a fork's main branch against upstream main. Returns commits behind count. */
function checkForkDrift(fork: string): CompareResult {
  try {
    const result = Bun.spawnSync(
      ["gh", "api", `repos/${fork}/compare/main...${UPSTREAM.replace("/", ":")}:main`, "--jq", ".behind_by"],
      { timeout: 15_000 }
    );

    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString().trim();

    if (result.exitCode !== 0) {
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
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("sync task already pending — skipping");
    return "skip";
  }

  const results = FORKS.map(checkForkDrift);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    for (const e of errors) {
      log(`error checking ${e.repo}: ${e.error}`);
    }
  }

  // Only flag drift above threshold — small drift is normal config divergence
  const drifted = results.filter((r) => r.behind >= DRIFT_THRESHOLD);

  if (drifted.length === 0) {
    const minor = results.filter((r) => r.behind > 0 && r.behind < DRIFT_THRESHOLD);
    if (minor.length > 0) {
      log(`minor drift (below threshold ${DRIFT_THRESHOLD}): ${minor.map((r) => `${r.repo}: ${r.behind} behind`).join(", ")}`);
    } else {
      log("all forks in sync with upstream");
    }
    return "ok";
  }

  const driftSummary = drifted
    .map((r) => `${r.repo}: ${r.behind} commits behind`)
    .join(", ");

  log(`significant drift detected: ${driftSummary}`);

  insertTask({
    subject: `worker-logs sync needed — ${driftSummary}`,
    description:
      `Significant fork drift detected against upstream (${UPSTREAM}).\n\n` +
      drifted.map((r) => `- ${r.repo}: ${r.behind} commits behind (threshold: ${DRIFT_THRESHOLD})`).join("\n") +
      `\n\nUse the worker-logs sync command:\n` +
      `arc skills run --name worker-logs -- sync\n\n` +
      `Follow instructions in skills/github-worker-logs/AGENT.md.`,
    skills: '["github-worker-logs"]',
    source: TASK_SOURCE,
    priority: 7,
    model: "haiku",
  });

  return "ok";
}
