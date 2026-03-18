/**
 * External dispatch watchdog — runs independently of sensors/dispatch.
 *
 * Checks the cycle_log table directly via SQLite. If no dispatch cycle
 * has completed in >2 hours and pending tasks exist, sends an email
 * alert to whoabuddy. Does NOT auto-restart anything.
 *
 * Runs on its own systemd timer (every 15 minutes), completely
 * independent of arc-sensors.timer and arc-dispatch.timer.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DB_PATH = join(ROOT, "db", "arc.sqlite");
const STATE_FILE = join(ROOT, "db", "hook-state", "external-watchdog.json");
const GATE_FILE = join(ROOT, "db", "hook-state", "dispatch-gate.json");
const LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");

/** Alert if no cycle in this many milliseconds */
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Minimum gap between alert emails */
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

const ALERT_RECIPIENT = "whoabuddy@gmail.com";

interface WatchdogState {
  last_ran: string;
  last_alert_at: string | null;
  last_result: "ok" | "alert" | "error" | "no-db";
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] external-watchdog: ${msg}`);
}

function readState(): WatchdogState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as WatchdogState;
  } catch {
    return { last_ran: "", last_alert_at: null, last_result: "ok" };
  }
}

function writeState(state: WatchdogState): void {
  mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readGateStatus(): string {
  try {
    const data = JSON.parse(readFileSync(GATE_FILE, "utf-8"));
    return data.status ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readLockInfo(): string {
  try {
    const data = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
    return `pid=${data.pid}, task=${data.task_id}, since=${data.started_at}`;
  } catch {
    return "no lock";
  }
}

interface CycleRow {
  started_at: string;
  completed_at: string | null;
  task_id: number | null;
}

function getLastCycle(): CycleRow | null {
  if (!existsSync(DB_PATH)) return null;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.query(
      "SELECT started_at, completed_at, task_id FROM cycle_log ORDER BY started_at DESC LIMIT 1"
    ).get() as CycleRow | null;
    return row;
  } finally {
    db.close();
  }
}

function getPendingCount(): number {
  if (!existsSync(DB_PATH)) return 0;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.query(
      "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'pending'"
    ).get() as { cnt: number } | null;
    return row?.cnt ?? 0;
  } finally {
    db.close();
  }
}

function sendAlert(subject: string, body: string): void {
  try {
    const arcBin = join(ROOT, "bin/arc");
    Bun.spawnSync([
      "bash", arcBin, "skills", "run", "--name", "arc-email-sync", "--",
      "send", "--to", ALERT_RECIPIENT, "--subject", subject,
      "--body", body, "--from", "watchdog@arc0btc.com",
    ], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
    log(`alert email sent to ${ALERT_RECIPIENT}`);
  } catch (e) {
    log(`failed to send alert email: ${e}`);
  }
}

function run(): void {
  const state = readState();
  state.last_ran = new Date().toISOString();

  // Check if DB exists
  if (!existsSync(DB_PATH)) {
    log("database not found — skipping");
    state.last_result = "no-db";
    writeState(state);
    return;
  }

  // Get last cycle
  const lastCycle = getLastCycle();
  if (!lastCycle) {
    log("no cycles in cycle_log — skipping");
    state.last_result = "ok";
    writeState(state);
    return;
  }

  // Calculate age
  const lastStartedAt = new Date(lastCycle.started_at.replace(" ", "T") + "Z");
  const ageMs = Date.now() - lastStartedAt.getTime();

  if (ageMs <= STALE_THRESHOLD_MS) {
    const ageMin = Math.round(ageMs / 60_000);
    log(`dispatch healthy — last cycle ${ageMin}min ago`);
    state.last_result = "ok";
    writeState(state);
    return;
  }

  // Stale — check pending tasks
  const pendingCount = getPendingCount();
  if (pendingCount === 0) {
    log("dispatch stale but no pending tasks — not alerting");
    state.last_result = "ok";
    writeState(state);
    return;
  }

  const stallMinutes = Math.round(ageMs / 60_000);
  const gateStatus = readGateStatus();
  const lockInfo = readLockInfo();

  log(`STALL: ${stallMinutes}min since last cycle, ${pendingCount} pending, gate=${gateStatus}`);

  // Check cooldown
  const lastAlertAt = state.last_alert_at ? new Date(state.last_alert_at).getTime() : 0;
  if (Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) {
    const remainMin = Math.round((ALERT_COOLDOWN_MS - (Date.now() - lastAlertAt)) / 60_000);
    log(`alert cooldown active (${remainMin}min remaining)`);
    state.last_result = "alert";
    writeState(state);
    return;
  }

  // Send alert
  const subject = `[Arc] Dispatch stall — no cycle in ${stallMinutes} minutes`;
  const body = [
    `Arc dispatch has not completed a cycle in ${stallMinutes} minutes.`,
    ``,
    `Last cycle: ${lastCycle.started_at} (task #${lastCycle.task_id ?? "unknown"})`,
    `Pending tasks: ${pendingCount}`,
    `Dispatch gate: ${gateStatus}`,
    `Lock state: ${lockInfo}`,
    `Host: ${hostname()}`,
    `Time: ${new Date().toISOString()}`,
    ``,
    `This is an alert only — no auto-restart was performed.`,
    ``,
    `To investigate:`,
    `  journalctl --user -u arc-dispatch -n 50 --no-pager`,
    `  cat db/dispatch-lock.json`,
    `  cat db/hook-state/dispatch-gate.json`,
    `  arc dispatch reset   # if gate is stopped`,
  ].join("\n");

  sendAlert(subject, body);

  state.last_alert_at = new Date().toISOString();
  state.last_result = "alert";
  writeState(state);
}

// Execute
try {
  run();
} catch (e) {
  log(`fatal error: ${e}`);
  process.exit(1);
}
