// status-report/sensor.ts
//
// Creates a watch report task every 6 hours during active hours.
// Pure TypeScript — no LLM. The dispatch task does the actual report generation.

import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "status-report";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:status-report";
const PRIORITY = 6; // below normal work, above housekeeping

/** True when current time is in quiet hours (8pm–6am PST / UTC-8). */
function isQuietHours(): boolean {
  const pstHour = (new Date().getUTCHours() - 8 + 24) % 24;
  return pstHour >= 20 || pstHour < 6;
}

export default async function statusReportSensor(): Promise<string> {
  if (isQuietHours()) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack reports — one at a time
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Watch report — ${now.slice(0, 16)}Z`,
    description:
      "Generate an HTML watch report covering all activity since the last report.\n\n" +
      "Follow the instructions in skills/status-report/AGENT.md.\n" +
      "Use the template at templates/status-report.html.\n" +
      "Include prediction market positions from stacks-market skill.\n" +
      "Write output to reports/ directory as .html.\n\n" +
      `Report period ends: ${now}`,
    skills: '["status-report"]',
    source: TASK_SOURCE,
    priority: PRIORITY,
  });

  return "ok";
}
