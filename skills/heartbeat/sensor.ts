// heartbeat/sensor.ts
//
// Creates a "system alive check" task every 6 hours.
// Standard pattern: claimSensorRun for interval gating + pendingTaskExistsForSource for dedup.

import { claimSensorRun, pendingTaskExistsForSource, insertTask } from "../../src/sensors.ts";

const SENSOR_NAME = "heartbeat";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:heartbeat";

export default async function heartbeatSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: "system alive check",
    priority: 1,
    source: TASK_SOURCE,
  });

  return "ok";
}
