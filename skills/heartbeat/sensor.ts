// heartbeat/sensor.ts
//
// Creates a "system alive check" task every 6 hours.
// Uses shouldRun() for interval gating.
// Deduplicates by checking for pending or active tasks with source "sensor:heartbeat".

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "heartbeat";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:heartbeat";

export default async function heartbeatSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Dedup: skip if a pending or active heartbeat task already exists
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: "system alive check",
    source: TASK_SOURCE,
    priority: 1,
  });

  return "ok";
}
