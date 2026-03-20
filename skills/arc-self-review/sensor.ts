// skills/arc-self-review/sensor.ts
//
// Triggers a daily self-review cycle by creating a self-review-cycle workflow instance.
// The arc-workflows meta-sensor evaluates the workflow and creates the health-check task.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";

const SENSOR_NAME = "arc-self-review";
const INTERVAL_MINUTES = 360; // 6 hours — ensures daily coverage without double-firing

const log = createSensorLogger(SENSOR_NAME);

export default async function arcSelfReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const today = new Date().toISOString().slice(0, 10);
  const workflowKey = `self-review-${today}`;

  if (getWorkflowByInstanceKey(workflowKey)) {
    log(`workflow instance exists for "${workflowKey}" — skipping`);
    return "skip";
  }

  const workflowId = insertWorkflow({
    template: "self-review-cycle",
    instance_key: workflowKey,
    current_state: "triggered",
    context: JSON.stringify({ cycleDate: today }),
  });

  log(`created self-review-cycle workflow ${workflowId} for ${today}`);
  return "ok";
}
