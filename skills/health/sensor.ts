// health/sensor.ts
//
// Monitors agent operational health every 5 minutes.
// Detects stale dispatch cycles and stale dispatch locks.
// Creates high-priority alert tasks when anomalies are found.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldRun, writeHookState, readHookState } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, getRecentCycles, getPendingTasks } from "../../src/db.ts";

const SENSOR_NAME = "health";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:health";
const STALE_LOCK_SOURCE = "sensor:health:stale-lock";
const PRIORITY = 9;

// Compute repo root: skills/health/sensor.ts → ../../
const ROOT = new URL("../../", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");

// Returns true if the last dispatch cycle was more than 30 minutes ago
// AND there are pending tasks that should have been processed.
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

// Returns true if a dispatch lock file exists but the recorded PID is no longer alive.
function checkStaleLock(): boolean {
  if (!existsSync(DISPATCH_LOCK_FILE)) return false;

  let pid: number;
  try {
    const lock = JSON.parse(readFileSync(DISPATCH_LOCK_FILE, "utf-8")) as { pid: number };
    pid = lock.pid;
  } catch {
    // Unreadable lock file — treat as stale
    return true;
  }

  try {
    process.kill(pid, 0);
    // PID is alive — lock is legitimate
    return false;
  } catch {
    // PID is dead — lock is stale
    return true;
  }
}

export default async function healthSensor(): Promise<string> {
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

  // Check for stale cycle
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

  // Check for stale lock
  const staleLock = checkStaleLock();
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
