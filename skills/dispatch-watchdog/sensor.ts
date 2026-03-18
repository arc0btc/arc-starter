// dispatch-watchdog/sensor.ts
//
// Monitors dispatch cycle gaps every 10 minutes.
// When a stall is detected (>95min since last cycle + pending tasks),
// writes a structured incident to memory/topics/incidents.md
// and creates a high-priority alert task.

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { getRecentCycles, getPendingTasks } from "../../src/db.ts";
import { DISPATCH_STALE_THRESHOLD_MS } from "../../src/constants.ts";
import { isGateStopped } from "../../src/dispatch-gate.ts";

const SENSOR_NAME = "dispatch-watchdog";
const INTERVAL_MINUTES = 10;
const TASK_SOURCE = "sensor:dispatch-watchdog";
const PRIORITY = 2;

// Minimum gap between incident reports (ms) — avoid duplicate entries for the same stall
const INCIDENT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const log = createSensorLogger(SENSOR_NAME);
const ROOT = new URL("../../", import.meta.url).pathname;
const INCIDENTS_TOPIC = join(ROOT, "memory", "topics", "incidents.md");

interface WatchdogState {
  last_ran: string;
  last_result: string;
  version: number;
  last_incident_at?: string;
}

/** Build a structured incident entry for incidents.md */
function formatIncident(
  stallMinutes: number,
  lastCycleAt: string,
  pendingCount: number,
  gateState: string,
): string {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return [
    "",
    `**Dispatch stall detected (${timestamp}):** No dispatch cycle in ${stallMinutes} minutes (last cycle: ${lastCycleAt}). ` +
      `${pendingCount} pending task(s) waiting. Gate state: ${gateState}. ` +
      `Detected by dispatch-watchdog sensor. Investigate: check systemd timers, dispatch logs, lock file state.`,
    "",
  ].join("\n");
}

/** Append incident text to memory/topics/incidents.md */
async function writeIncident(entry: string): Promise<void> {
  const file = Bun.file(INCIDENTS_TOPIC);
  const existing = (await file.exists()) ? await file.text() : "## Recent Incidents\n";
  await Bun.write(INCIDENTS_TOPIC, existing.trimEnd() + "\n" + entry);
}

export default async function dispatchWatchdogSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Check last dispatch cycle age
  const cycles = getRecentCycles(1);
  if (cycles.length === 0) {
    log("no cycles in cycle_log — skipping");
    return "ok";
  }

  const last = cycles[0];
  const lastStartedAt = new Date(last.started_at.replace(" ", "T") + "Z");
  const ageMs = Date.now() - lastStartedAt.getTime();

  if (ageMs <= DISPATCH_STALE_THRESHOLD_MS) {
    return "ok"; // dispatch is healthy
  }

  // Stale — check if there are pending tasks (no stall if queue is empty)
  const pending = getPendingTasks();
  if (pending.length === 0) {
    log("dispatch stale but no pending tasks — not a stall");
    return "ok";
  }

  const stallMinutes = Math.round(ageMs / 60_000);
  const gateState = isGateStopped() ? "STOPPED" : "running";

  log(`stall detected: ${stallMinutes}min since last cycle, ${pending.length} pending, gate=${gateState}`);

  // Check cooldown — avoid duplicate incident entries for the same stall
  const state = (await readHookState(SENSOR_NAME)) as WatchdogState | null;
  const lastIncidentAt = state?.last_incident_at ? new Date(state.last_incident_at).getTime() : 0;
  const sinceLastIncident = Date.now() - lastIncidentAt;

  if (sinceLastIncident >= INCIDENT_COOLDOWN_MS) {
    // Write incident to incidents.md
    const lastCycleFormatted = lastStartedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
    const entry = formatIncident(stallMinutes, lastCycleFormatted, pending.length, gateState);
    await writeIncident(entry);
    log("incident written to memory/topics/incidents.md");

    // Update cooldown timestamp
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { last_ran: new Date().toISOString(), last_result: "ok", version: 1 }),
      last_incident_at: new Date().toISOString(),
    });
  } else {
    log(`incident cooldown active (${Math.round((INCIDENT_COOLDOWN_MS - sinceLastIncident) / 60_000)}min remaining)`);
  }

  // Create alert task (deduped by source)
  insertTaskIfNew(TASK_SOURCE, {
    subject: "dispatch watchdog: stall detected — investigate",
    description:
      `Dispatch has been stale for ${stallMinutes} minutes (last cycle: ${last.started_at}). ` +
      `${pending.length} pending task(s) waiting. Gate state: ${gateState}. ` +
      `Check: systemd timers, dispatch lock (db/dispatch-lock.json), dispatch-gate state, recent errors in cycle_log.`,
    priority: PRIORITY,
    model: "haiku",
    skills: JSON.stringify(["dispatch-watchdog", "arc-service-health"]),
  });

  return "ok";
}
