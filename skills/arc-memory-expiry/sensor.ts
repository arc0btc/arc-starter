// arc-memory-expiry/sensor.ts
//
// Daily cleanup of TTL-expired arc_memory entries.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { initDatabase, expireArcMemories, countArcMemories } from "../../src/db.ts";

const SENSOR_NAME = "arc-memory-expiry";
const INTERVAL_MINUTES = 1440; // 24 hours

export default async function memoryExpirySensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const log = createSensorLogger(SENSOR_NAME);

  try {
    initDatabase();
    const expired = expireArcMemories();
    const remaining = countArcMemories();

    if (expired > 0) {
      log(`Expired ${expired} memories. ${remaining} remaining.`);
    } else {
      log(`No expired memories. ${remaining} total.`);
    }

    return "ok";
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return "ok"; // Don't block other sensors on memory cleanup failure
  }
}
