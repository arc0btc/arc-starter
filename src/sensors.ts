// sensors.ts
//
// Discovers all skills/<name>/sensor.ts files and runs them in parallel.
// Each sensor is responsible for its own shouldRun() gating.
//
// Provides the shouldRun infrastructure (HookState, readHookState,
// writeHookState, claimSensorRun) used by individual sensor files.
//
// State files live in db/hook-state/{name}.json (already in .gitignore).

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "./skills.ts";
import { initDatabase } from "./db.ts";
import { getShutdownState } from "./shutdown.ts";
import { insertTask, pendingTaskExistsForSource, pendingTaskExistsForSubject, taskExistsForSource, getLastCompletedTaskBySource } from "./db.ts";
export { insertTask, pendingTaskExistsForSource, taskExistsForSource, getLastCompletedTaskBySource };
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

// ---- Identity resolution ----

/**
 * Resolve a sensor's internal SENSOR_NAME / TASK_SOURCE_PREFIX from its source file,
 * falling back to the directory name. Shared by arc-skill-manager's sensor-health-report
 * and any other consumer that needs to match hook-state files to a sensor's real identity
 * (directory name and internal SENSOR_NAME can diverge, e.g. arc0btc-pr-review vs
 * pr-review-attestation).
 */
export function resolveSensorIdentity(
  sensorPath: string,
  fallbackName: string
): { stateKey: string; sourcePrefix: string } {
  let stateKey = fallbackName;
  let sourcePrefix = `sensor:${fallbackName}`;
  try {
    const source = readFileSync(sensorPath, "utf-8");
    const nameMatch = source.match(/const\s+SENSOR_NAME\s*=\s*["'`]([^"'`]+)["'`]/);
    if (nameMatch) {
      stateKey = nameMatch[1];
      sourcePrefix = `sensor:${stateKey}`;
    }
    const prefixMatch = source.match(/const\s+TASK_SOURCE_PREFIX\s*=\s*["'`]([^"'`]+)["'`]/);
    if (prefixMatch) {
      sourcePrefix = prefixMatch[1];
    }
  } catch {
    // unreadable sensor source — fall back to the directory/frontmatter name
  }
  return { stateKey, sourcePrefix };
}

/**
 * Resolve the live consecutive_failures count for a sensor, using the same
 * identity-resolution + candidate-file matching as sensor-health-report
 * (task #21065). Avoids false positives from reading hook-state keyed on
 * a stale directory name instead of the sensor's real SENSOR_NAME.
 */
export function resolveSensorConsecutiveFailures(
  sensorPath: string,
  fallbackName: string
): number {
  const { stateKey } = resolveSensorIdentity(sensorPath, fallbackName);
  const nameKeys = stateKey === fallbackName ? [stateKey] : [stateKey, fallbackName];

  const candidateFiles: string[] = [];
  for (const key of nameKeys) {
    const exactFile = join(HOOK_STATE_DIR, `${key}.json`);
    if (existsSync(exactFile)) candidateFiles.push(exactFile);
  }
  if (candidateFiles.length === 0 && existsSync(HOOK_STATE_DIR)) {
    const dirEntries = readdirSync(HOOK_STATE_DIR);
    for (const key of nameKeys) {
      for (const f of dirEntries) {
        if (f.startsWith(`${key}-`) && f.endsWith(".json")) {
          candidateFiles.push(join(HOOK_STATE_DIR, f));
        }
      }
    }
  }

  let consecutiveFailures = 0;
  for (const stateFile of candidateFiles) {
    try {
      const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (typeof raw.consecutive_failures === "number" && raw.consecutive_failures > consecutiveFailures) {
        consecutiveFailures = raw.consecutive_failures;
      }
    } catch {
      // unreadable state
    }
  }

  return consecutiveFailures;
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
/** Default timeout for fetch calls in sensors. Use AbortSignal.timeout(SENSOR_FETCH_TIMEOUT_MS) for bare fetch. */
export const SENSOR_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries: number = 1,
  delayMs: number = 2000,
  timeoutMs: number = 30_000,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      // Apply default timeout if caller didn't provide an AbortSignal
      const fetchOptions = options?.signal
        ? options
        : { ...options, signal: AbortSignal.timeout(timeoutMs) };
      const res = await fetch(url, fetchOptions);
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

  // Preserve last_result/consecutive_failures from the previous run — the true
  // outcome of THIS run isn't known until runSensors() finishes executing it.
  await writeHookState(name, {
    ...state,
    last_ran: new Date().toISOString(),
    last_result: state?.last_result ?? "ok",
    version: state ? state.version + 1 : 1,
  });

  return true;
}

// ---- Beat status helpers ----

const AIBTC_NEWS_BEATS_URL = "https://aibtc.news/api/beats";

/**
 * Fetch currently active beat slugs from aibtc.news/api/beats.
 *
 * Returns the set of slugs with status "active". On any fetch or parse
 * failure the caller receives null — sensors should treat null as
 * "API unavailable" and fall back to their known-active defaults rather
 * than silently skipping signal work.
 *
 * `maxRetries`/`retryDelayMs` default to the original budget (1 retry, 2s
 * delay, 30s per-attempt timeout via fetchWithRetry) for existing callers.
 * Callers with a tight overall time budget (e.g. a sensor that also makes
 * its own slow upstream call under the 90s sensor watchdog) can pass a
 * smaller maxRetries to bound worst-case time.
 */
export async function fetchActiveBeatSlugs(
  maxRetries: number = 1,
  retryDelayMs: number = 2000,
  timeoutMs: number = 30_000,
): Promise<Set<string> | null> {
  try {
    const res = await fetchWithRetry(AIBTC_NEWS_BEATS_URL, undefined, maxRetries, retryDelayMs, timeoutMs);
    if (!res.ok) return null;
    const beats = (await res.json()) as Array<{ slug: string; status: string }>;
    return new Set(beats.filter((b) => b.status === "active").map((b) => b.slug));
  } catch {
    return null;
  }
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
  // Shutdown gate — no sensors fire while agent is down
  const shutdownState = getShutdownState();
  if (shutdownState) {
    process.stdout.write(`sensors: SHUTDOWN — skipping all sensors (${shutdownState.reason}, since ${shutdownState.since})\n`);
    return;
  }

  const skills = discoverSkills();
  const sensorsToRun = skills.filter((s) => s.hasSensor);

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

  // Persist the real per-sensor outcome so sensor-health-report's
  // consecutive_failures alert can actually fire. Skipped sensors never
  // executed their own gate this cycle, so their hook-state is left untouched.
  await Promise.all(
    results
      .filter((r) => !r.skipped)
      .map(async (r) => {
        const state = await readHookState(r.name);
        const prevFailures =
          state && typeof state.consecutive_failures === "number" ? state.consecutive_failures : 0;
        await writeHookState(r.name, {
          ...state,
          last_ran: state?.last_ran ?? new Date().toISOString(),
          last_result: r.ok ? "ok" : "error",
          consecutive_failures: r.ok ? 0 : prevFailures + 1,
          version: state ? state.version + 1 : 1,
        });
      }),
  );

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
