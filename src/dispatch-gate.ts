/**
 * Dispatch gate — on/off switch with no auto-recovery.
 * Rate limit → immediate stop + email notification.
 * 3 consecutive other failures → same.
 * Resume with `arc dispatch reset`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_GATE_FILE = join(ROOT, "db", "hook-state", "dispatch-gate.json");
const GATE_FAILURE_THRESHOLD = 3;

export type ErrorClass = "auth" | "rate_limited" | "subprocess_timeout" | "transient" | "unknown";

interface DispatchGateState {
  status: "running" | "stopped";
  consecutive_failures: number;
  stopped_at: string | null;
  stop_reason: string | null;
  last_error_class: ErrorClass | null;
  last_updated: string;
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function readGateState(): DispatchGateState {
  try {
    const data = readFileSync(DISPATCH_GATE_FILE, "utf-8");
    return JSON.parse(data) as DispatchGateState;
  } catch {
    return {
      status: "running",
      consecutive_failures: 0,
      stopped_at: null,
      stop_reason: null,
      last_error_class: null,
      last_updated: new Date().toISOString(),
    };
  }
}

function writeGateState(state: DispatchGateState): void {
  state.last_updated = new Date().toISOString();
  mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
  writeFileSync(DISPATCH_GATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Send email notification to whoabuddy that dispatch has stopped.
 * Uses arc CLI (fire-and-forget, non-blocking).
 */
function notifyDispatchStopped(reason: string, errorClass: ErrorClass | null): void {
  const subject = errorClass === "rate_limited"
    ? `[Arc] Dispatch stopped — rate/plan limit hit`
    : `[Arc] Dispatch stopped — ${GATE_FAILURE_THRESHOLD} consecutive failures`;
  const body = [
    `Arc dispatch has stopped and will not auto-recover.`,
    ``,
    `Reason: ${reason}`,
    `Error class: ${errorClass ?? "unknown"}`,
    `Time: ${new Date().toISOString()}`,
    `Host: ${hostname()}`,
    ``,
    `To resume, SSH in and run:`,
    `  bash bin/arc dispatch reset`,
    ``,
    `Or clear the gate file:`,
    `  rm db/hook-state/dispatch-gate.json`,
  ].join("\n");

  try {
    Bun.spawn(["bash", join(ROOT, "bin/arc"), "skills", "run", "--name", "email", "--",
      "send", "--to", "whoabuddy@gmail.com", "--subject", subject, "--body", body,
      "--from", "arc@arc0btc.com"], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
    log(`dispatch: notification email queued to whoabuddy`);
  } catch (e) {
    log(`dispatch: failed to send notification email: ${e}`);
  }
}

/** Check dispatch gate. Returns true if dispatch should proceed. */
export function checkDispatchGate(): boolean {
  const state = readGateState();
  if (state.status === "running") return true;

  log(`dispatch: STOPPED — not dispatching (since ${state.stopped_at}, reason: ${state.stop_reason?.slice(0, 100)}). Run 'arc dispatch reset' to resume.`);
  return false;
}

export function recordGateSuccess(): void {
  const state = readGateState();
  if (state.status === "running" && state.consecutive_failures === 0) return;
  state.consecutive_failures = 0;
  state.status = "running";
  state.stopped_at = null;
  state.stop_reason = null;
  state.last_error_class = null;
  writeGateState(state);
}

export function recordGateFailure(errMsg: string, errClass: ErrorClass): void {
  const state = readGateState();
  state.consecutive_failures += 1;
  state.last_error_class = errClass;

  // Rate limit or plan suspension → immediate stop (no threshold)
  if (errClass === "rate_limited") {
    state.status = "stopped";
    state.stopped_at = new Date().toISOString();
    state.stop_reason = errMsg.slice(0, 500);
    writeGateState(state);
    log(`dispatch: STOPPED — rate/plan limit hit. Manual restart required.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass);
    return;
  }

  // Other errors: stop after consecutive threshold
  if (state.consecutive_failures >= GATE_FAILURE_THRESHOLD) {
    state.status = "stopped";
    state.stopped_at = new Date().toISOString();
    state.stop_reason = errMsg.slice(0, 500);
    writeGateState(state);
    log(`dispatch: STOPPED after ${state.consecutive_failures} consecutive failures (${errClass}). Manual restart required.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass);
    return;
  }

  writeGateState(state);
}

/** Reset the dispatch gate to "running". Called by `arc dispatch reset`. */
export function resetDispatchGate(): void {
  const state = readGateState();
  log(`dispatch: gate reset (was ${state.status}, ${state.consecutive_failures} failures, reason: ${state.stop_reason?.slice(0, 100)})`);
  writeGateState({
    status: "running",
    consecutive_failures: 0,
    stopped_at: null,
    stop_reason: null,
    last_error_class: null,
    last_updated: new Date().toISOString(),
  });
}
