// arc-weekly-presentation/sensor.ts
//
// Runs every 60 minutes. On Mondays, creates a task to generate
// the weekly presentation if one hasn't been created yet this week.

import { claimSensorRun, createSensorLogger } from "../../src/sensors";
import { insertTask, recentTaskExistsForSourcePrefix } from "../../src/db";

const SENSOR_NAME = "arc-weekly-presentation";
const INTERVAL_MINUTES = 60;
const SOURCE_PREFIX = `sensor:${SENSOR_NAME}`;

const log = createSensorLogger(SENSOR_NAME);

function isMondayUTC(): boolean {
  return new Date().getUTCDay() === 1;
}

function currentWeekSource(): string {
  // Use ISO week date for dedup: sensor:arc-weekly-presentation:YYYY-MM-DD (Monday's date)
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return `${SOURCE_PREFIX}:${monday.toISOString().slice(0, 10)}`;
}

export default async function weeklyPresentationSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Only trigger on Mondays
  if (!isMondayUTC()) {
    return "skip";
  }

  // Dedup: check if we already created a task for this week (7-day window)
  const source = currentWeekSource();
  if (recentTaskExistsForSourcePrefix(SOURCE_PREFIX, 7 * 24 * 60)) {
    return "skip";
  }

  insertTask({
    subject: `Generate weekly presentation for ${new Date().toISOString().slice(0, 10)}`,
    description: [
      "Run: arc skills run --name arc-weekly-presentation -- generate",
      "",
      "This generates the AIBTC Monday presentation from live data.",
      "Archives the previous presentation and writes src/web/presentation.html.",
      "Review the output and commit.",
    ].join("\n"),
    skills: '["arc-weekly-presentation"]',
    priority: 5,
    model: "sonnet",
    source,
  });

  log("created weekly presentation task");
  return "ok";
}
