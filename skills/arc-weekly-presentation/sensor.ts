// arc-weekly-presentation/sensor.ts
//
// Runs every 60 minutes. On Tuesdays, creates a task to generate
// the weekly presentation if one hasn't been created yet this week.

import { claimSensorRun, createSensorLogger } from "../../src/sensors";
import { insertTask, recentTaskExistsForSourcePrefix } from "../../src/db";

const SENSOR_NAME = "arc-weekly-presentation";
const INTERVAL_MINUTES = 60;
const SOURCE_PREFIX = `sensor:${SENSOR_NAME}`;

const log = createSensorLogger(SENSOR_NAME);

function isTuesdayUTC(): boolean {
  return new Date().getUTCDay() === 2;
}

function currentWeekSource(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const tuesdayOffset = -(((day - 2) + 7) % 7);
  const tuesday = new Date(now);
  tuesday.setUTCDate(tuesday.getUTCDate() + tuesdayOffset);
  return `${SOURCE_PREFIX}:${tuesday.toISOString().slice(0, 10)}`;
}

export default async function weeklyPresentationSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (!isTuesdayUTC()) return "skip";

  if (recentTaskExistsForSourcePrefix(SOURCE_PREFIX, 7 * 24 * 60)) return "skip";

  const source = currentWeekSource();

  insertTask({
    subject: `Generate weekly presentation for ${new Date().toISOString().slice(0, 10)}`,
    description: [
      "Run: arc skills run --name arc-weekly-presentation -- generate",
      "",
      "Archives the previous presentation.html to src/web/archives/YYYYMMDD-aibtc-weekly.html,",
      "then writes the new deck to src/web/presentation.html (served at /presentation).",
      "See AGENT.md for the subagent research workflow that feeds live data into the deck.",
    ].join("\n"),
    skills: '["arc-weekly-presentation"]',
    priority: 5,
    model: "sonnet",
    source,
  });

  log("created weekly presentation task");
  return "ok";
}
