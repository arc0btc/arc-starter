// ceo-review/sensor.ts
//
// Creates a CEO review task every 4 hours, offset to run after the status report.
// Checks that a recent report exists before creating the review task.
// Pure TypeScript — no LLM.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "ceo-review";
const INTERVAL_MINUTES = 240; // 4 hours
const TASK_SOURCE = "sensor:ceo-review";
const PRIORITY = 1; // blocks report delivery to whoabuddy — process first

const ROOT = new URL("../../", import.meta.url).pathname;
const REPORTS_DIR = join(ROOT, "reports");

/** Find the most recent status report file. Returns filename or null. */
function findLatestReport(): string | null {
  try {
    const files = readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith("_watch_report.md"))
      .sort()
      .reverse();
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

/** Check if the report already has a CEO review filled in. */
async function reportHasReview(filename: string): Promise<boolean> {
  try {
    const content = await Bun.file(join(REPORTS_DIR, filename)).text();
    // Check if the Assessment section has content (not just the template placeholder)
    const reviewSection = content.split("### Assessment")[1];
    if (!reviewSection) return false;
    // If it still contains the template comment, it hasn't been reviewed
    return !reviewSection.includes("<!-- CEO's assessment");
  } catch {
    return false;
  }
}

export default async function ceoReviewSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack reviews
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  // Need a report to review
  const latestReport = findLatestReport();
  if (!latestReport) return "skip";

  // Don't re-review a report that already has a CEO review
  const alreadyReviewed = await reportHasReview(latestReport);
  if (alreadyReviewed) return "skip";

  insertTask({
    subject: `CEO review — ${latestReport.slice(0, 16)}`,
    description:
      `Review the latest status report and provide strategic direction.\n\n` +
      `Report file: reports/${latestReport}\n\n` +
      `Follow the instructions in skills/ceo-review/AGENT.md.\n` +
      `Load the CEO skill context for strategic framework.\n` +
      `Maximum 3 follow-up tasks.`,
    skills: '["ceo-review", "ceo"]',
    source: TASK_SOURCE,
    priority: PRIORITY,
  });

  return "ok";
}
