// skills/arc-report-email/sensor.ts
//
// Detects new watch reports in reports/ and emails them as themed HTML.
// Pure TypeScript — no LLM. Runs every 1 minute, sends on first new report found.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { sendEmail } from "../arc-email-sync/sync.ts";
import { markdownToHtml, wrapInArcTheme } from "./html.ts";

const SENSOR_NAME = "arc-report-email";
const REPORTS_DIR = new URL("../../reports", import.meta.url).pathname;
const INTERVAL_MINUTES = 30; // 30 min — reports don't arrive every 5 min
const TASK_SOURCE = "sensor:arc-report-email";

const log = createSensorLogger(SENSOR_NAME);

/** Format an ISO timestamp as "2026-02-27 16:00 MST" */
function formatMST(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} MST`;
}

/** Extract the ISO timestamp from a report filename like 2026-02-27T22:00:00Z_watch_report.md */
function extractTimestamp(filename: string): string {
  return filename.replace(/_watch_report\.(md|html)$/, "");
}

/** Check if the report has a completed CEO review (not just template placeholders). */
function hasCompletedCeoReview(content: string): boolean {
  // Support both markdown (### Assessment) and HTML (<h3>Assessment</h3>) reports
  const splitPoint = content.includes("<h3>Assessment</h3>")
    ? "<h3>Assessment</h3>"
    : "### Assessment";
  const reviewSection = content.split(splitPoint)[1];
  if (!reviewSection) return false;
  // Template placeholder contains this comment — if still present, not yet reviewed
  return !reviewSection.includes("<!-- ");
}

export default async function reportEmailSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Dedup: skip if a pending email task already exists
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  // Find all report files
  const { Glob } = await import("bun");
  const glob = new Glob("*_watch_report.{md,html}");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: REPORTS_DIR, absolute: false })) {
    files.push(file);
  }

  if (files.length === 0) return "skip";

  // Sort descending — newest first
  files.sort((a, b) => b.localeCompare(a));
  const newestFile = files[0];

  // Check if already emailed
  const state = await readHookState(SENSOR_NAME);
  if (state?.last_emailed_report === newestFile) return "skip";

  // Read the report content
  const reportPath = `${REPORTS_DIR}/${newestFile}`;
  const content = await Bun.file(reportPath).text();

  // Wait for CEO review before emailing — don't send raw reports
  if (!hasCompletedCeoReview(content)) return "skip";

  log(`CEO-reviewed report ready: ${newestFile}`);

  // Get email recipient (API credentials handled by sendEmail())
  const recipient = await getCredential("arc-email-sync", "report_recipient");

  if (!recipient) {
    log("no report_recipient in credential store (email/report_recipient) — skipping");
    return "skip";
  }

  // Format subject with MST timestamp
  const reportTimestamp = extractTimestamp(newestFile);
  const subject = `Arc Watch Report ${formatMST(reportTimestamp)}`;

  // If report is already HTML (.html extension), use it directly; otherwise convert markdown
  const isHtml = newestFile.endsWith(".html");
  const htmlBody = isHtml ? content : wrapInArcTheme(markdownToHtml(content), subject);
  const plainText = isHtml ? subject : content;

  // Write state BEFORE sending to prevent duplicate sends on crash-after-send
  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: state ? state.version + 1 : 1,
    last_emailed_report: newestFile,
  });

  // Send via email worker API (html field for themed email, body as plain text fallback)
  try {
    await sendEmail({ to: recipient, subject, body: plainText, html: htmlBody });
  } catch (error) {
    // Clear state on failure so we retry next cycle
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "error",
      version: state ? state.version + 1 : 1,
      last_emailed_report: state?.last_emailed_report as string ?? "",
    });
    log(`email send failed: ${error instanceof Error ? error.message : String(error)}`);
    return "error";
  }

  log(`emailed report to ${recipient}: "${subject}"`);
  return "ok";
}
