// health/sensor.ts
//
// Monitors agent operational health every 5 minutes.
// Detects stale dispatch cycles and stale dispatch locks.
// Creates high-priority alert tasks when anomalies are found.

import { join } from "node:path";
import { claimSensorRun, createSensorLogger, pendingTaskExistsForSource } from "../../src/sensors.ts";
import { getRecentCycles, getPendingTasks, insertWorkflow, getWorkflowByInstanceKey, getWorkflowsByTemplate, completeWorkflow } from "../../src/db.ts";
import { isPidAlive } from "../../src/utils.ts";
import { DISPATCH_STALE_THRESHOLD_MS } from "../../src/constants.ts";

const SENSOR_NAME = "arc-service-health";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:arc-service-health";
const STALE_LOCK_SOURCE = "sensor:arc-service-health:stale-lock";
const PRIORITY = 2;
// Suppress stale-dispatch alerts for this window after dispatch recovers from a long outage.
// Prevents flooding the queue with ~N/hour FP alert tasks when payment blocks clear.
const RECOVERY_SUPPRESSION_MS = 60 * 60 * 1000;

const log = createSensorLogger(SENSOR_NAME);

// Compute repo root: skills/arc-service-health/sensor.ts → ../../
const ROOT = new URL("../../", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const STATE_FILE = join(ROOT, "db", "hook-state", "arc-service-health.json");

interface ServiceHealthState {
  wasStaleLastRun?: boolean;
  lastRecoveryAt?: string;
}

async function readHealthState(): Promise<ServiceHealthState> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) return (await file.json()) as ServiceHealthState;
  } catch { /* ignore */ }
  return {};
}

async function writeHealthState(state: ServiceHealthState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state));
}

/** Returns true if the last dispatch cycle started longer ago than the stale threshold and pending tasks exist. */
function checkStaleCycle(): boolean {
  const cycles = getRecentCycles(1);
  if (cycles.length === 0) return false;

  const last = cycles[0];
  const lastStartedAt = new Date(last.started_at.replace(" ", "T") + "Z");
  const ageMs = Date.now() - lastStartedAt.getTime();

  if (ageMs <= DISPATCH_STALE_THRESHOLD_MS) return false;

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

/** Auto-complete any triggered health-alert workflows for a given alertType when the condition is no longer active. */
function clearResolvedAlerts(alertType: string): void {
  const workflows = getWorkflowsByTemplate("health-alert");
  for (const wf of workflows) {
    if (wf.completed_at !== null) continue;
    if (wf.current_state !== "triggered") continue;
    try {
      const ctx = JSON.parse(wf.context ?? "{}") as { alertType?: string };
      if (ctx.alertType === alertType) {
        completeWorkflow(wf.id);
        log(`auto-completed resolved ${alertType} workflow id=${wf.id}`);
      }
    } catch {
      // skip unparseable context
    }
  }
}

export default async function healthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const state = await readHealthState();
  const staleCycle = checkStaleCycle();

  // Detect recovery: dispatch was stale last run but is healthy now
  if (state.wasStaleLastRun && !staleCycle) {
    state.lastRecoveryAt = new Date().toISOString();
    log(`dispatch recovered from stale — recording recovery at ${state.lastRecoveryAt}`);
    clearResolvedAlerts("dispatch-stale");
  }

  // Check if we're within the post-recovery suppression window
  const inSuppressionWindow =
    state.lastRecoveryAt !== undefined &&
    Date.now() - new Date(state.lastRecoveryAt).getTime() < RECOVERY_SUPPRESSION_MS;

  state.wasStaleLastRun = staleCycle;
  await writeHealthState(state);

  if (staleCycle && inSuppressionWindow) {
    log(`dispatch-stale alert suppressed — within ${RECOVERY_SUPPRESSION_MS / 60000}min recovery window (since ${state.lastRecoveryAt})`);
  } else if (staleCycle && !pendingTaskExistsForSource(TASK_SOURCE)) {
    const now = new Date().toISOString();
    const wfKey = `health-alert:dispatch-stale:${now.slice(0, 13)}`; // hourly dedup
    if (!getWorkflowByInstanceKey(wfKey)) {
      insertWorkflow({
        template: "health-alert",
        instance_key: wfKey,
        current_state: "triggered",
        context: JSON.stringify({
          alertType: "dispatch-stale",
          alertDate: now.slice(0, 10),
        }),
      });
    }
  } else if (!staleCycle && !state.wasStaleLastRun) {
    // Condition cleared and was already cleared — auto-complete any open triggered workflows
    clearResolvedAlerts("dispatch-stale");
  }

  const staleLock = await checkStaleLock();
  if (staleLock && !pendingTaskExistsForSource(STALE_LOCK_SOURCE)) {
    const now = new Date().toISOString();
    const wfKey = `health-alert:stale-lock:${now.slice(0, 13)}`;
    if (!getWorkflowByInstanceKey(wfKey)) {
      insertWorkflow({
        template: "health-alert",
        instance_key: wfKey,
        current_state: "triggered",
        context: JSON.stringify({
          alertType: "stale-lock",
          alertDate: now.slice(0, 10),
        }),
      });
    }
  } else if (!staleLock) {
    // Condition cleared — auto-complete any open triggered workflows for this alert type
    clearResolvedAlerts("stale-lock");
  }

  return "ok";
}
