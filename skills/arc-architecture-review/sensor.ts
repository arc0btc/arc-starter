// architect/sensor.ts
//
// Creates an architecture review task when src/ or skills/ have changed
// since the last review, or when active reports need processing.
// Pure TypeScript — no LLM.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-architecture-review";
const INTERVAL_MINUTES = 720; // 12 hours
const TASK_SOURCE = "sensor:arc-architecture-review";

const ROOT = join(import.meta.dir, "../..");
const REPORTS_DIR = join(ROOT, "reports");
const SRC_DIRS = ["src/", "skills/", ":(exclude)skills/arc-architecture-review/"];

const log = createSensorLogger(SENSOR_NAME);

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
  const lastReviewedSha = (statePre?.last_reviewed_src_sha as string) ?? "";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const currentSha = getCurrentCodebaseSha();

  // Read state AFTER claimSensorRun to get the updated hook-state
  const state = await readHookState(SENSOR_NAME);

  // Primary gate: skip if code hasn't changed since last review and no active reports.
  // Diagram mtime is NOT used — if the code hasn't changed, the diagram is still accurate
  // regardless of age. This prevents daily re-reviews with no new content.
  if (currentSha && lastReviewedSha && currentSha === lastReviewedSha && !hasActiveReports()) {
    log(`no codebase changes since last review (SHA: ${currentSha}), no active reports — skipping`);
    return "ok";
  }

  const reasons: string[] = [];

  if (!lastReviewedSha) {
    reasons.push("no prior review recorded");
  } else if (currentSha && currentSha !== lastReviewedSha) {
    reasons.push(`codebase changed since last review (${lastReviewedSha} → ${currentSha})`);
  }

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
      `Follow instructions in skills/arc-architecture-review/AGENT.md.`,
    skills: '["arc-architecture-review", "arc-skill-manager"]',
    source: TASK_SOURCE,
    priority: 7,
    model: "sonnet",
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
