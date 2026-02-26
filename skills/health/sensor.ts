// health/sensor.ts
//
// Monitors agent operational health every 5 minutes.
// Detects stale dispatch cycles and stale dispatch locks.
// Creates high-priority alert tasks when anomalies are found.

import { join } from "node:path";
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, getRecentCycles, getPendingTasks } from "../../src/db.ts";
import { isPidAlive } from "../../src/utils.ts";

const SENSOR_NAME = "health";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:health";
const STALE_LOCK_SOURCE = "sensor:health:stale-lock";
const PRIORITY = 9;

// Compute repo root: skills/health/sensor.ts → ../../
const ROOT = new URL("../../", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");

/** Returns true if the last dispatch cycle was more than 30 minutes ago and pending tasks exist. */
function checkStaleCycle(): boolean {
  const cycles = getRecentCycles(1);
  if (cycles.length === 0) return false;

  const last = cycles[0];
  const lastStartedAt = new Date(last.started_at.replace(" ", "T") + "Z");
  const ageMinutes = (Date.now() - lastStartedAt.getTime()) / 60_000;

  if (ageMinutes <= 30) return false;

  // Only alert if there are pending tasks waiting to be processed
  const pending = getPendingTasks();
  return pending.length > 0;
}

/** Returns true if a dispatch lock file exists but the recorded PID is no longer alive. */
async function checkStaleLock(): Promise<boolean> {
  const file = Bun.file(DISPATCH_LOCK_FILE);
  if (!(await file.exists())) return false;

  try {
    const lock = (await file.json()) as { pid: number };
    return !isPidAlive(lock.pid);
  } catch {
    return true;
  }
}

export default async function healthSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const staleCycle = checkStaleCycle();
  if (staleCycle && !pendingTaskExistsForSource(TASK_SOURCE)) {
    insertTask({
      subject: "health alert: dispatch stale or stuck",
      description:
        "The last dispatch cycle completed more than 30 minutes ago and there are pending tasks. " +
        "Check arc status, systemd timers, and dispatch logs.",
      source: TASK_SOURCE,
      priority: PRIORITY,
    });
  }

  const staleLock = await checkStaleLock();
  if (staleLock && !pendingTaskExistsForSource(STALE_LOCK_SOURCE)) {
    insertTask({
      subject: "health alert: stale dispatch lock detected",
      description:
        "A dispatch lock file exists at db/dispatch-lock.json but the recorded PID is no longer alive. " +
        "Run: rm db/dispatch-lock.json && arc run",
      source: STALE_LOCK_SOURCE,
      priority: PRIORITY,
    });
  }

  return "ok";
}
