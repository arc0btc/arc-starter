// skills/arc-artifacts/sensor.ts
//
// 24h vacuum pass for the source-artifact pool. Soft-deletes TTL'd rows,
// hard-deletes rows past grace, sweeps orphan files on disk.
//
// This is a pure DB+FS maintenance pass — no LLM, no task creation.

import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { vacuumExpired } from "../../src/artifacts.ts";

const SENSOR_NAME = "arc-artifacts-vacuum";
const INTERVAL_MINUTES = 24 * 60;
const log = createSensorLogger(SENSOR_NAME);

export default async function arcArtifactsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    const result = vacuumExpired();
    log(
      `vacuum: soft-deleted ${result.soft}, hard-deleted ${result.hard}, ` +
        `orphan files removed ${result.orphanFiles}`,
    );
    return result.soft + result.hard + result.orphanFiles > 0 ? "ok" : "skip";
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return "skip";
  }
}
