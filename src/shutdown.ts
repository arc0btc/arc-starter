/**
 * Fleet agent shutdown state — idempotent, reversible shutdown/resume.
 *
 * State file: db/shutdown-state.json
 * Checked by sensors (runSensors) and dispatch (runDispatch) on every cycle.
 * Controlled via `arc shutdown` and `arc resume` CLI commands.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHUTDOWN_STATE_FILE = join(ROOT, "db", "shutdown-state.json");

export interface ShutdownState {
  enabled: boolean;
  reason: string;
  since: string;
  initiated_by: string;
}

/** Read shutdown state. Returns null if no shutdown file or shutdown not enabled. */
export function getShutdownState(): ShutdownState | null {
  try {
    if (!existsSync(SHUTDOWN_STATE_FILE)) return null;
    const data = JSON.parse(readFileSync(SHUTDOWN_STATE_FILE, "utf-8")) as ShutdownState;
    return data.enabled ? data : null;
  } catch {
    return null;
  }
}

/** Check if agent is in shutdown state. Fast path for gating. */
export function isShutdown(): boolean {
  return getShutdownState() !== null;
}

/** Enter shutdown state. Idempotent — calling twice is safe. */
export function enterShutdown(reason: string, initiatedBy: string = "cli"): ShutdownState {
  const existing = getShutdownState();
  const state: ShutdownState = {
    enabled: true,
    reason,
    since: existing?.since ?? new Date().toISOString(),
    initiated_by: initiatedBy,
  };
  writeFileSync(SHUTDOWN_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  return state;
}

/** Exit shutdown state. Idempotent — calling when not shutdown is safe. */
export function exitShutdown(): void {
  try {
    if (existsSync(SHUTDOWN_STATE_FILE)) {
      unlinkSync(SHUTDOWN_STATE_FILE);
    }
  } catch {
    // Already gone — fine
  }
}
