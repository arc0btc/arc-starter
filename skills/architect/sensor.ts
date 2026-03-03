// architect/sensor.ts
//
// Creates an architecture review task every 6 hours when:
// - State machine diagram is stale (>24h or codebase changed since last gen)
// - CEO/watch reports exist with actionable feedback
// Pure TypeScript — no LLM.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "architect";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:architect";
const STALE_HOURS = 24;

const ROOT = join(import.meta.dir, "../..");
const DIAGRAM_PATH = join(ROOT, "skills/architect/state-machine.md");
const REPORTS_DIR = join(ROOT, "reports");
const SRC_DIRS = ["src/", "skills/"];

const log = createSensorLogger(SENSOR_NAME);

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
    const result = Bun.spawnSync(
      ["git", "log", "-1", "--format=%ct", "--", ...SRC_DIRS],
      { cwd: ROOT }
    );
    const lastCommitTime = parseInt(result.stdout.toString().trim() || "0", 10);
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

/** Get the current commit SHA for src/ or skills/. Returns empty string on error. */
function getCurrentCodebaseSha(): string {
  try {
    const result = Bun.spawnSync(
      ["git", "log", "-1", "--format=%H", "--", ...SRC_DIRS],
      { cwd: ROOT }
    );
    return result.stdout.toString().trim().substring(0, 7); // short SHA
  } catch {
    return "";
  }
}

export default async function architectSensor(): Promise<string> {
  // Read state BEFORE claimSensorRun to preserve last_reviewed_src_sha
  const statePre = await readHookState(SENSOR_NAME);
  const lastReviewedSha = statePre?.last_reviewed_src_sha ?? "";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const currentSha = getCurrentCodebaseSha();

  // Read state AFTER claimSensorRun to get the updated hook-state
  const state = await readHookState(SENSOR_NAME);

  // Skip review if code hasn't changed since last review and diagram is fresh
  if (
    currentSha &&
    lastReviewedSha &&
    currentSha === lastReviewedSha &&
    !isDiagramStale() &&
    !hasActiveReports()
  ) {
    log(
      `no codebase changes since last review (SHA: ${currentSha.substring(0, 7)}), diagram fresh, no reports — skipping`
    );
    return "ok";
  }

  const reasons: string[] = [];

  if (isDiagramStale()) reasons.push("diagram stale (>24h or missing)");
  if (hasCodebaseChanged()) reasons.push("codebase changed since last diagram");
  if (hasActiveReports()) reasons.push("active reports to process");
  if (currentSha && lastReviewedSha && currentSha !== lastReviewedSha) {
    reasons.push(`codebase changed since last review (${lastReviewedSha} → ${currentSha})`);
  }

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

  // Record current SHA as reviewed (for next cycle's dedup)
  if (state && currentSha) {
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_reviewed_src_sha: currentSha,
    });
  }

  return "ok";
}
