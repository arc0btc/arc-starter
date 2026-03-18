// arc-memory-expiry/sensor.ts
//
// Daily cleanup of TTL-expired arc_memory entries + full consolidation pass.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { initDatabase, consolidateMemories, countArcMemories } from "../../src/db.ts";

const SENSOR_NAME = "arc-memory-expiry";
const INTERVAL_MINUTES = 1440; // 24 hours

export default async function memoryExpirySensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const log = createSensorLogger(SENSOR_NAME);

  try {
    initDatabase();
    const result = consolidateMemories();
    const remaining = countArcMemories();

    const parts: string[] = [];
    if (result.ttlAssigned > 0) parts.push(`ttl=${result.ttlAssigned}`);
    if (result.importanceDecayed > 0) parts.push(`decayed=${result.importanceDecayed}`);
    if (result.expired > 0) parts.push(`expired=${result.expired}`);
    if (result.domainAlerts.length > 0) {
      parts.push(`budget-alerts=${result.domainAlerts.map((a) => `${a.domain}:${a.count}`).join(",")}`);
    }

    if (parts.length > 0) {
      log(`Consolidation: ${parts.join(", ")}. ${remaining} remaining.`);
    } else {
      log(`No consolidation needed. ${remaining} total.`);
    }

    return "ok";
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return "ok"; // Don't block other sensors on memory cleanup failure
  }
}
