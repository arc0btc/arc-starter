// reporting/sensor.ts
//
// Unified reporting sensor with two time-gated variants:
// 1. Watch report — every 6 hours during active hours (6am–8pm Pacific), P6, HTML
// 2. Overnight brief — once daily at 6am Pacific, P2, markdown
//
// Each variant uses its own sensor claim to avoid interference.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, recentTaskExistsForSource, insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";

// ---- Shared helpers ----

const log = createSensorLogger("arc-reporting");

/** Current hour in America/Los_Angeles (handles PST/PDT automatically). */
function getPacificHour(): number {
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).format(now);
  return parseInt(hourStr, 10);
}

/** True when current time is in quiet hours (8pm–6am Pacific). */
function isQuietHours(): boolean {
  const hour = getPacificHour();
  return hour >= 20 || hour < 6;
}

// ---- Watch report variant ----

const INTERVAL_MINUTES = 60; // minimum polling interval; variants use their own intervals internally

const WATCH_SENSOR = "arc-reporting-watch";
const WATCH_INTERVAL = 360; // 6 hours
const WATCH_SOURCE = "sensor:arc-reporting-watch";
const WATCH_PRIORITY = 6;

async function watchReportSensor(): Promise<string> {
  if (isQuietHours()) return "skip";

  const claimed = await claimSensorRun(WATCH_SENSOR, WATCH_INTERVAL);
  if (!claimed) return "skip";

  // Time-bounded dedup: ignore stale tasks older than 8h to prevent indefinite blocking
  if (recentTaskExistsForSource(WATCH_SOURCE, 480)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Watch report — ${now.slice(0, 16)}Z`,
    description:
      "Generate an HTML watch report covering all activity since the last report.\n\n" +
      "Follow the instructions in skills/arc-reporting/AGENT.md (Watch Report section).\n" +
      "Use the template at templates/status-report.html.\n" +
      "Include prediction market positions from stacks-market skill.\n" +
      "Write output to reports/ directory as .html.\n\n" +
      `Report period ends: ${now}`,
    skills: '["arc-reporting"]',
    source: WATCH_SOURCE,
    priority: WATCH_PRIORITY,
    model: "sonnet",
  });

  return "ok";
}

// ---- Overnight brief variant ----

const OVERNIGHT_SENSOR = "arc-reporting-overnight";
const OVERNIGHT_INTERVAL = 60; // check every hour, but only fire at 6am PST
const OVERNIGHT_SOURCE = "sensor:arc-reporting-overnight";
const OVERNIGHT_PRIORITY = 2;

async function overnightBriefSensor(): Promise<string> {
  const hour = getPacificHour();
  if (hour !== 6) return "skip";

  const claimed = await claimSensorRun(OVERNIGHT_SENSOR, OVERNIGHT_INTERVAL);
  if (!claimed) return "skip";

  // Time-bounded dedup: ignore stale tasks older than 24h to prevent indefinite blocking
  if (recentTaskExistsForSource(OVERNIGHT_SOURCE, 1440)) return "skip";

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Use workflow for brief→retrospective chain tracking
  const wfKey = `overnight-brief:${today}`;
  if (getWorkflowByInstanceKey(wfKey)) return "skip";

  insertWorkflow({
    template: "overnight-brief",
    instance_key: wfKey,
    current_state: "pending",
    context: JSON.stringify({ date: today }),
  });

  return "ok";
}

// ---- Entry point: run both variants ----

export default async function reportingSensor(): Promise<string> {
  const watchResult = await watchReportSensor();
  const overnightResult = await overnightBriefSensor();

  // Return "ok" if either created a task, "skip" if both skipped
  if (watchResult === "ok" || overnightResult === "ok") return "ok";
  return "skip";
}
