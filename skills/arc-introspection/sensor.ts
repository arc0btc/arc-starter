// arc-introspection/sensor.ts
//
// RETIRED 2026-07-04 (task #21061). Merged into skills/arc-purpose-eval/sensor.ts:
// both sensors fired on the identical 720min/24h-window schedule and queried the
// same tasks+cycle_log rows, producing two redundant daily meta-tasks. The
// qualitative narrative this sensor used to generate (completed/failed lists,
// model distribution, skill frequency, reflection prompts) now lives inside
// arc-purpose-eval's single daily task description.
//
// Kept as an inert stub rather than deleted so the skill directory (SKILL.md,
// history) stays intact. Always returns "skip".

import { claimSensorRun } from "../../src/sensors.ts";

const SENSOR_NAME = "arc-introspection";
const INTERVAL_MINUTES = 720;

export default async function introspectionSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";
  return "skip";
}
