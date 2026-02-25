// heartbeat/sensor.ts
//
// Creates a "system alive check" task every 6 hours.
// Uses shouldRun() for interval gating.
// Deduplicates by checking for pending or active tasks with source "sensor:heartbeat".

import { shouldRun, writeHookState, readHookState } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "heartbeat";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:heartbeat";

export default async function heartbeatSensor(): Promise<string> {
  // Ensure db is initialized (sensors may be called standalone)
  initDatabase();

  // Gate: only run if enough time has passed
  const ok = await shouldRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!ok) {
    return "skip";
  }

  // Read current state to get version for increment
  const existing = await readHookState(SENSOR_NAME);
  const nextVersion = existing ? existing.version + 1 : 1;

  // Write updated state immediately (claim the run slot)
  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: nextVersion,
    consecutive_failures: 0,
  });

  // Dedup: skip if a pending or active heartbeat task already exists
  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    // Update state to reflect skip
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: nextVersion,
      consecutive_failures: existing ? existing.consecutive_failures : 0,
    });
    return "skip";
  }

  // Create the heartbeat task
  insertTask({
    subject: "system alive check",
    source: TASK_SOURCE,
    priority: 1,
  });

  return "ok";
}
