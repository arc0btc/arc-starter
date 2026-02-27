// status-report/sensor.ts
//
// Creates a quarterly status report task every 4 hours.
// Pure TypeScript — no LLM. The dispatch task does the actual report generation.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "status-report";
const INTERVAL_MINUTES = 240; // 4 hours
const TASK_SOURCE = "sensor:status-report";
const PRIORITY = 6; // below normal work, above housekeeping

export default async function statusReportSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack reports — one at a time
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Quarterly status report — ${now.slice(0, 16)}Z`,
    description:
      "Generate a quarterly status report covering all activity since the last report.\n\n" +
      "Follow the instructions in skills/status-report/AGENT.md.\n" +
      "Use the template at templates/status-report.md.\n" +
      "Write output to reports/ directory.\n\n" +
      `Report period ends: ${now}`,
    skills: '["status-report"]',
    source: TASK_SOURCE,
    priority: PRIORITY,
  });

  return "ok";
}
