// sensors.ts
//
// Discovers all skills/<name>/sensor.ts files and runs them in parallel.
// Each sensor is responsible for its own shouldRun() gating.
//
// Provides the shouldRun infrastructure (HookState, readHookState,
// writeHookState, claimSensorRun) used by individual sensor files.
//
// State files live in db/hook-state/{name}.json (already in .gitignore).

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "./skills.ts";
import { initDatabase } from "./db.ts";
import { AGENT_NAME } from "./identity.ts";
import { insertTask, pendingTaskExistsForSource, pendingTaskExistsForSubject, taskExistsForSource } from "./db.ts";
export { insertTask, pendingTaskExistsForSource, taskExistsForSource };
import type { InsertTask } from "./db.ts";

// ---- Constants ----

const HOOK_STATE_DIR = new URL("../db/hook-state", import.meta.url).pathname;

// Ensure state directory exists once at module load
mkdirSync(HOOK_STATE_DIR, { recursive: true });

// ---- Types ----

export interface HookState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  [key: string]: unknown;
}

// ---- Read ----

/** Read hook state from db/hook-state/{name}.json. Returns null if missing or unparsable. */
export async function readHookState(name: string): Promise<HookState | null> {
  const filePath = join(HOOK_STATE_DIR, `${name}.json`);
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return (await file.json()) as HookState;
  } catch {
    return null;
  }
}

// ---- Write ----

/** Write hook state to db/hook-state/{name}.json. */
export async function writeHookState(name: string, state: HookState): Promise<void> {
  const filePath = join(HOOK_STATE_DIR, `${name}.json`);
  await Bun.write(filePath, JSON.stringify(state));
}

// ---- Logging ----

/** Create a prefixed logger for a sensor. Usage: `const log = createSensorLogger("arc-service-health");` */
export function createSensorLogger(name: string): (msg: string) => void {
  return (msg: string) => {
    console.log(`[${new Date().toISOString()}] [${name}/sensor] ${msg}`);
  };
}

// ---- Network helpers ----

/**
 * Fetch with a single retry on 5xx server errors or network failures.
 * Client errors (4xx) are returned immediately without retrying.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries: number = 1,
  delayMs: number = 2000,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) continue;
    }
  }
  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}

// ---- Scheduling ----

export async function shouldRun(name: string, intervalMinutes: number): Promise<boolean> {
  const state = await readHookState(name);
  if (state === null) return true;
  const intervalMs = intervalMinutes * 60 * 1000;
  const nextAllowed = new Date(state.last_ran).getTime() + intervalMs;
  return Date.now() >= nextAllowed;
}

export async function claimSensorRun(name: string, intervalMinutes: number): Promise<boolean> {
  const state = await readHookState(name);

  if (state !== null) {
    const intervalMs = intervalMinutes * 60 * 1000;
    const nextAllowed = new Date(state.last_ran).getTime() + intervalMs;
    if (Date.now() < nextAllowed) return false;
  }

  await writeHookState(name, {
    ...state,
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: state ? state.version + 1 : 1,
  });

  return true;
}

// ---- Task creation helpers ----

/**
 * Dedup check + insert. Returns the new task ID, or null if a task already exists.
 *
 * @param dedupMode "pending" checks pending/active only (default). "any" checks all statuses.
 */
export function insertTaskIfNew(
  source: string,
  taskConfig: Omit<InsertTask, "source">,
  dedupMode: "pending" | "any" = "pending",
): number | null {
  const exists =
    dedupMode === "any"
      ? taskExistsForSource(source)
      : pendingTaskExistsForSource(source);
  if (exists) return null;
  // Also check subject dedup — catches identical tasks from different sources
  if (pendingTaskExistsForSubject(taskConfig.subject)) return null;
  return insertTask({ ...taskConfig, source });
}

/**
 * Full sensor boilerplate: claim interval gate → dedup → insert task.
 * Returns "skip" (interval not reached), "exists" (task already queued), or "created".
 */
export async function createTaskIfDue(
  sensorName: string,
  intervalMinutes: number,
  source: string,
  taskConfig: Omit<InsertTask, "source">,
  opts?: { dedupMode?: "pending" | "any" },
): Promise<"skip" | "exists" | "created"> {
  const claimed = await claimSensorRun(sensorName, intervalMinutes);
  if (!claimed) return "skip";

  const result = insertTaskIfNew(source, taskConfig, opts?.dedupMode ?? "pending");
  return result !== null ? "created" : "exists";
}

// ---- Sensor runner ----

/**
 * Worker allowlist — workers ONLY run these sensors. Everything else is Arc-only.
 * Simpler than exclusion lists and safer as the sensor count grows.
 * Workers are lean executors; Arc is the workhorse with 66+ sensors.
 */
const WORKER_SENSORS: ReadonlySet<string> = new Set([
  // Core — every agent needs these
  "aibtc-heartbeat",        // signed platform check-in (5min)
  "aibtc-inbox-sync",       // poll AIBTC inbox for messages
  "arc-service-health",     // self-monitor: detect own stale cycles/dead services
  "arc-alive-check",        // periodic alive signal
  "arc-housekeeping",       // basic repo hygiene
  "fleet-self-sync",        // receive code updates from Arc
  "arc-scheduler",          // fire scheduled tasks
  "contacts",               // contact sync
]);

/** Per-sensor timeout in milliseconds. Liberal limit to catch hangs, not rush normal work. */
const SENSOR_TIMEOUT_MS = 90_000; // 90 seconds

interface SensorResult {
  name: string;
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sensor ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function runSensors(): Promise<void> {
  const skills = discoverSkills();
  let sensorsToRun = skills.filter((s) => s.hasSensor);

  // Workers only run allowlisted sensors. Arc runs everything.
  if (AGENT_NAME !== "arc0") {
    const before = sensorsToRun.length;
    sensorsToRun = sensorsToRun.filter((s) => WORKER_SENSORS.has(s.name));
    const skipped = before - sensorsToRun.length;
    if (skipped > 0) {
      process.stdout.write(`sensors: ${sensorsToRun.length} allowed, ${skipped} Arc-only skipped on ${AGENT_NAME}\n`);
    }
  }

  if (sensorsToRun.length === 0) {
    process.stdout.write("sensors: ran 0 sensors\n");
    return;
  }

  const start = Date.now();

  const promises = sensorsToRun.map(async (skill): Promise<SensorResult> => {
    const sensorPath = join(skill.path, "sensor.ts");
    const t0 = Date.now();
    try {
      const mod = await import(sensorPath);
      const fn = mod.default;
      if (typeof fn !== "function") {
        return {
          name: skill.name,
          ok: false,
          skipped: false,
          durationMs: Date.now() - t0,
          error: "no default export function",
        };
      }
      const result = await withTimeout(fn(), SENSOR_TIMEOUT_MS, skill.name);
      const durationMs = Date.now() - t0;
      // Sensors can return "skip" string to signal they were gated out
      if (result === "skip") {
        return { name: skill.name, ok: true, skipped: true, durationMs };
      }
      // Sensors can return "error" to signal a non-exception failure
      if (result === "error") {
        return { name: skill.name, ok: false, skipped: false, durationMs, error: "sensor returned error" };
      }
      return { name: skill.name, ok: true, skipped: false, durationMs };
    } catch (err) {
      return {
        name: skill.name,
        ok: false,
        skipped: false,
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const settled = await Promise.allSettled(promises);
  const results = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          name: sensorsToRun[i].name,
          ok: false,
          skipped: false,
          durationMs: 0,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        }
  );

  for (const r of results) {
    const status = r.skipped ? "skip" : r.ok ? "ok" : "error";
    const detail = r.error ? ` (${r.error})` : "";
    process.stdout.write(`  sensor ${r.name}: ${status} ${r.durationMs}ms${detail}\n`);
  }

  const totalMs = Date.now() - start;
  process.stdout.write(`sensors: ran ${sensorsToRun.length} sensor${sensorsToRun.length === 1 ? "" : "s"} in ${totalMs}ms\n`);
}

// ---- Main (standalone) ----

if (import.meta.main) {
  const ROOT = new URL("..", import.meta.url).pathname;
  const criticalFiles = ["SOUL.md", "CLAUDE.md"];
  for (const file of criticalFiles) {
    if (!existsSync(join(ROOT, file))) {
      console.error(`[${new Date().toISOString()}] sensors: preflight failed — missing ${file}`);
      process.exit(1);
    }
  }
  initDatabase();
  await runSensors();
}
