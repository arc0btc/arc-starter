// reporting/sensor.ts
//
// Unified reporting sensor with two time-gated variants:
// 1. Watch report — every 6 hours during active hours (6am–8pm PST), P6, HTML
// 2. Overnight brief — once daily at 6am PST, P2, markdown
//
// Each variant uses its own sensor claim to avoid interference.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

// ---- Shared helpers ----

const log = createSensorLogger("reporting");

/** Current hour in PST (UTC-8). */
function getPstHour(): number {
  return (new Date().getUTCHours() - 8 + 24) % 24;
}

/** True when current time is in quiet hours (8pm–6am PST). */
function isQuietHours(): boolean {
  const pstHour = getPstHour();
  return pstHour >= 20 || pstHour < 6;
}

// ---- Watch report variant ----

const WATCH_SENSOR = "reporting-watch";
const WATCH_INTERVAL = 360; // 6 hours
const WATCH_SOURCE = "sensor:reporting-watch";
const WATCH_PRIORITY = 6;

async function watchReportSensor(): Promise<string> {
  if (isQuietHours()) return "skip";

  const claimed = await claimSensorRun(WATCH_SENSOR, WATCH_INTERVAL);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(WATCH_SOURCE)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Watch report — ${now.slice(0, 16)}Z`,
    description:
      "Generate an HTML watch report covering all activity since the last report.\n\n" +
      "Follow the instructions in skills/reporting/AGENT.md (Watch Report section).\n" +
      "Use the template at templates/status-report.html.\n" +
      "Include prediction market positions from stacks-market skill.\n" +
      "Write output to reports/ directory as .html.\n\n" +
      `Report period ends: ${now}`,
    skills: '["reporting"]',
    source: WATCH_SOURCE,
    priority: WATCH_PRIORITY,
    model: "sonnet",
  });

  return "ok";
}

// ---- Overnight brief variant ----

const OVERNIGHT_SENSOR = "reporting-overnight";
const OVERNIGHT_INTERVAL = 60; // check every hour, but only fire at 6am PST
const OVERNIGHT_SOURCE = "sensor:reporting-overnight";
const OVERNIGHT_PRIORITY = 2;

async function overnightBriefSensor(): Promise<string> {
  const pstHour = getPstHour();
  if (pstHour !== 6) return "skip";

  const claimed = await claimSensorRun(OVERNIGHT_SENSOR, OVERNIGHT_INTERVAL);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(OVERNIGHT_SOURCE)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Overnight brief — ${now.slice(0, 10)}`,
    description:
      "Generate a consolidated overnight brief covering all activity from 8pm–6am PST.\n\n" +
      "Follow the instructions in skills/reporting/AGENT.md (Overnight Brief section).\n" +
      "Use the template at templates/overnight-brief.md.\n" +
      "Write output to reports/ directory.\n\n" +
      `Brief generated at: ${now}`,
    skills: '["reporting"]',
    source: OVERNIGHT_SOURCE,
    priority: OVERNIGHT_PRIORITY,
    model: "sonnet",
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
