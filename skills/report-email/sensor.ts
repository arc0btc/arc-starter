// skills/report-email/sensor.ts
//
// Detects new watch reports in reports/ and emails them.
// Pure TypeScript — no LLM. Runs every 1 minute, sends on first new report found.

import { readHookState, writeHookState, type HookState } from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "report-email";
const REPORTS_DIR = new URL("../../reports", import.meta.url).pathname;

interface ReportEmailState extends HookState {
  last_emailed_report: string;
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [report-email/sensor] ${msg}`);
}

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
  return filename.replace("_watch_report.md", "");
}

export default async function reportEmailSensor(): Promise<string> {
  // No cadence gating — runs every sensor tick (1 min) but only acts when there's a new report.
  // This ensures reports are emailed promptly after generation.

  // Find all report files
  const { Glob } = await import("bun");
  const glob = new Glob("*_watch_report.md");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: REPORTS_DIR, absolute: false })) {
    files.push(file);
  }

  if (files.length === 0) return "skip";

  // Sort descending — newest first
  files.sort((a, b) => b.localeCompare(a));
  const newestFile = files[0];

  // Check if already emailed
  const state = (await readHookState(SENSOR_NAME)) as ReportEmailState | null;
  if (state?.last_emailed_report === newestFile) return "skip";

  log(`new report detected: ${newestFile}`);

  // Read the report content
  const reportPath = `${REPORTS_DIR}/${newestFile}`;
  const content = await Bun.file(reportPath).text();

  // Get email credentials and recipient
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const recipient = await getCredential("email", "report_recipient");

  if (!apiBaseUrl || !adminKey) {
    log("email credentials not configured — skipping");
    return "skip";
  }

  if (!recipient) {
    log("no report_recipient in credential store (email/report_recipient) — skipping");
    return "skip";
  }

  // Query today's costs from the tasks table
  initDatabase();
  const db = getDatabase();
  const row = db.query<{ cost: number; api_cost: number }, []>(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost
     FROM tasks WHERE date(created_at) = date('now')`
  ).get();
  const costStr = row ? `$${row.cost.toFixed(2)} actual / $${row.api_cost.toFixed(2)} API` : "";

  // Format subject with MST timestamp and costs
  const reportTimestamp = extractTimestamp(newestFile);
  const subject = `Arc Watch Report ${formatMST(reportTimestamp)}${costStr ? ` — ${costStr}` : ""}`;

  // Send via email worker API
  const res = await fetch(`${apiBaseUrl}/api/send`, {
    method: "POST",
    headers: {
      "X-Admin-Key": adminKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: recipient,
      subject,
      body: content,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log(`email send failed: HTTP ${res.status} — ${body}`);
    return "error";
  }

  log(`emailed report to ${recipient}: "${subject}"`);

  // Update state
  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: state ? state.version + 1 : 1,
    consecutive_failures: 0,
    last_emailed_report: newestFile,
  } as ReportEmailState);

  return "ok";
}
