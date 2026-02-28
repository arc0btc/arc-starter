// overnight-brief/sensor.ts
//
// Creates an overnight brief task at 6am PST each day.
// Covers all activity from the quiet hours window (8pm–6am PST).
// Pure TypeScript — no LLM.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "overnight-brief";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:overnight-brief";
const PRIORITY = 2; // high — morning brief should generate early

/** Get current hour in PST (UTC-8). */
function getPstHour(): number {
  return (new Date().getUTCHours() - 8 + 24) % 24;
}

export default async function overnightBriefSensor(): Promise<string> {
  initDatabase();

  // Only fire during the 6am PST hour (6:00–6:59)
  const pstHour = getPstHour();
  if (pstHour !== 6) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack briefs
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const now = new Date().toISOString();

  insertTask({
    subject: `Overnight brief — ${now.slice(0, 10)}`,
    description:
      "Generate a consolidated overnight brief covering all activity from 8pm–6am PST.\n\n" +
      "Follow the instructions in skills/overnight-brief/AGENT.md.\n" +
      "Use the template at templates/overnight-brief.md.\n" +
      "Write output to reports/ directory.\n\n" +
      `Brief generated at: ${now}`,
    skills: '["overnight-brief"]',
    source: TASK_SOURCE,
    priority: PRIORITY,
  });

  return "ok";
}
