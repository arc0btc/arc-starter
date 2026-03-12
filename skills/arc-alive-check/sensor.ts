// system-alive-check/sensor.ts
//
// Creates a "system alive check" task every 6 hours.
// Standard pattern: claimSensorRun for interval gating + pendingTaskExistsForSource for dedup.
//
// NOTE: Disabled for Arc — 22+ other sensors confirm liveness continuously.
// Left in arc-starter as the default for new agents. Remove this flag to re-enable.
const DISABLED = true;

import { claimSensorRun, createSensorLogger, pendingTaskExistsForSource, insertTask } from "../../src/sensors.ts";

const SENSOR_NAME = "arc-alive-check";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:arc-alive-check";

const log = createSensorLogger(SENSOR_NAME);

export default async function systemAliveCheckSensor(): Promise<string> {
  if (DISABLED) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: "system alive check",
    priority: 5,
    model: "haiku",
    source: TASK_SOURCE,
  });

  log("created system alive check task");
  return "ok";
}
