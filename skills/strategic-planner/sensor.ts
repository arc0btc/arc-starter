// strategic-planner/sensor.ts
//
// Detects prolonged idle state (no pending tasks for multiple dispatch cycles)
// and creates a task to generate a strategic plan aligned with D1-D5 directives.
//
// Trigger: fleet-status.json idle=true for > IDLE_THRESHOLD_MINUTES.
// Dedup: one pending planning task at a time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";

const SENSOR_NAME = "strategic-planner";
const INTERVAL_MINUTES = 30;
const IDLE_THRESHOLD_MINUTES = 60;
const TASK_SOURCE = "sensor:strategic-planner";

const ROOT = new URL("../..", import.meta.url).pathname;
const FLEET_STATUS_FILE = join(ROOT, "memory", "fleet-status.json");

const log = createSensorLogger(SENSOR_NAME);

interface FleetStatus {
  idle: boolean;
  idle_since: string | null;
}

function readFleetStatus(): FleetStatus | null {
  try {
    const raw = readFileSync(FLEET_STATUS_FILE, "utf-8");
    return JSON.parse(raw) as FleetStatus;
  } catch {
    return null;
  }
}

export default async function strategicPlannerSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const status = readFleetStatus();
  if (!status) {
    log("fleet-status.json missing or unreadable");
    return "skip";
  }

  if (!status.idle || !status.idle_since) {
    log("dispatch is active — no planning needed");
    return "skip";
  }

  const idleMs = Date.now() - new Date(status.idle_since).getTime();
  const idleMinutes = idleMs / 60_000;

  if (idleMinutes < IDLE_THRESHOLD_MINUTES) {
    log(`idle for ${Math.round(idleMinutes)}m — below ${IDLE_THRESHOLD_MINUTES}m threshold`);
    return "skip";
  }

  const taskId = insertTaskIfNew(TASK_SOURCE, {
    subject: "Strategic planner: propose directive-aligned tasks and email plan to whoabuddy",
    description: [
      `Arc has been idle for ${Math.round(idleMinutes)} minutes (no pending tasks).`,
      "Review D1-D5 directives and current fleet state.",
      "Generate 3-5 high-priority strategic tasks with rationale.",
      "Email the proposed plan to whoabuddy for approval — do NOT create tasks directly.",
      "Use: arc skills run --name arc-email-sync -- send --to whoabuddy@gmail.com --subject 'Arc Strategic Plan: Proposed Tasks' --body '<plan>'",
      "Close this task after sending the email.",
    ].join("\n"),
    priority: 4,
    skills: JSON.stringify(["strategic-planner", "arc-email-sync"]),
  });

  if (taskId === null) {
    log("planning task already pending — skipping");
    return "skip";
  }

  log(`created planning task (idle ${Math.round(idleMinutes)}m)`);
  return "ok";
}
