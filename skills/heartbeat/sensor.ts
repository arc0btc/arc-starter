// heartbeat/sensor.ts
//
// Creates a "system alive check" task every 6 hours.
// Uses createTaskIfDue() for interval gating + dedup + insert.

import { createTaskIfDue } from "../../src/sensors.ts";

export default async function heartbeatSensor(): Promise<string> {
  const result = await createTaskIfDue("heartbeat", 360, "sensor:heartbeat", {
    subject: "system alive check",
    priority: 1,
    model: "haiku",
  });
  return result === "skip" ? "skip" : "ok";
}
