// architect/sensor.ts
//
// Creates an architecture review task every 6 hours when:
// - State machine diagram is stale (>24h or codebase changed since last gen)
// - CEO/watch reports exist with actionable feedback
// Pure TypeScript — no LLM.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "architect";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:architect";
const STALE_HOURS = 24;

const ROOT = join(import.meta.dir, "../..");
const DIAGRAM_PATH = join(ROOT, "skills/architect/state-machine.md");
const REPORTS_DIR = join(ROOT, "reports");
const SRC_DIRS = ["src/", "skills/"];

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [architect/sensor] ${msg}`);
}

/** Check if the state machine diagram is stale (>24h old). */
function isDiagramStale(): boolean {
  if (!existsSync(DIAGRAM_PATH)) return true;
  try {
    const stat = statSync(DIAGRAM_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs > STALE_HOURS * 3600_000;
  } catch {
    return true;
  }
}

/** Check if src/ or skills/ have commits newer than the diagram. */
function hasCodebaseChanged(): boolean {
  if (!existsSync(DIAGRAM_PATH)) return true;
  try {
    const diagramStat = statSync(DIAGRAM_PATH);
    const diagramTime = Math.floor(diagramStat.mtimeMs / 1000);

    // Use git log to find most recent commit touching src/ or skills/
    const result = spawnSync(
      "git",
      ["log", "-1", "--format=%ct", "--", ...SRC_DIRS],
      { cwd: ROOT }
    );
    const lastCommitTime = parseInt(result.stdout?.toString().trim() ?? "0", 10);
    return lastCommitTime > diagramTime;
  } catch {
    return false;
  }
}

/** Check if reports/ has active (non-archived) report files. */
function hasActiveReports(): boolean {
  if (!existsSync(REPORTS_DIR)) return false;
  try {
    const files = readdirSync(REPORTS_DIR).filter(
      (f) => f.endsWith(".md") && !f.startsWith(".")
    );
    return files.length > 0;
  } catch {
    return false;
  }
}

export default async function architectSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const reasons: string[] = [];

  if (isDiagramStale()) reasons.push("diagram stale (>24h or missing)");
  if (hasCodebaseChanged()) reasons.push("codebase changed since last diagram");
  if (hasActiveReports()) reasons.push("active reports to process");

  if (reasons.length === 0) {
    log("no review triggers — skipping");
    return "ok";
  }

  log(`creating review task: ${reasons.join(", ")}`);

  insertTask({
    subject: "architecture review — " + reasons[0],
    description:
      `Triggers: ${reasons.join(", ")}\n\n` +
      `Run the architect skill to update the state machine diagram, ` +
      `audit context delivery at decision points, and apply the SpaceX ` +
      `5-step engineering process.\n\n` +
      `Follow instructions in skills/architect/AGENT.md.`,
    skills: '["architect", "manage-skills"]',
    source: TASK_SOURCE,
    priority: 7,
  });

  return "ok";
}
