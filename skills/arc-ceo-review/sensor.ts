// ceo-review/sensor.ts
//
// Creates a CEO review workflow when an unreviewed watch report exists.
// The workflow handles: review → email delivery to whoabuddy.
// Report-only — no task creation or modification during review.
// Pure TypeScript — no LLM.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun } from "../../src/sensors.ts";
import { insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";

const SENSOR_NAME = "arc-ceo-review";
const INTERVAL_MINUTES = 720; // 12 hours — daily strategic review

const ROOT = new URL("../../", import.meta.url).pathname;
const REPORTS_DIR = join(ROOT, "reports");

/** Find the most recent status report file. Returns filename or null. */
function findLatestReport(): string | null {
  try {
    const files = readdirSync(REPORTS_DIR)
      .filter((f) => f.includes("_watch_report."))
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
    // Support both markdown (### Assessment) and HTML (<h3>Assessment</h3>) reports
    const splitPoint = content.includes("<h3>Assessment</h3>")
      ? "<h3>Assessment</h3>"
      : "### Assessment";
    const reviewSection = content.split(splitPoint)[1];
    if (!reviewSection) return false;
    // If it still contains template comments, it hasn't been reviewed
    return !reviewSection.includes("<!-- ");
  } catch {
    return false;
  }
}

/** True when current time is in quiet hours (8pm–6am PST / UTC-8). */
function isQuietHours(): boolean {
  const pstHour = (new Date().getUTCHours() - 8 + 24) % 24;
  return pstHour >= 20 || pstHour < 6;
}

export default async function ceoReviewSensor(): Promise<string> {
  if (isQuietHours()) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Need a report to review
  const latestReport = findLatestReport();
  if (!latestReport) return "skip";

  // Don't re-review a report that already has a CEO review
  const alreadyReviewed = await reportHasReview(latestReport);
  if (alreadyReviewed) return "skip";

  // Use workflow for review → email chain
  const wfKey = `ceo-review:${latestReport}`;
  if (getWorkflowByInstanceKey(wfKey)) return "skip";

  insertWorkflow({
    template: "ceo-review",
    instance_key: wfKey,
    current_state: "scheduled",
    context: JSON.stringify({
      reviewDate: new Date().toISOString().slice(0, 16),
      reportFile: latestReport,
    }),
  });

  return "ok";
}
