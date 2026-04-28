// sensors.ts
//
// Discovers all skills/<name>/sensor.ts files and runs them in parallel.
// Each sensor is responsible for its own shouldRun() gating.
//
// Provides the shouldRun infrastructure (HookState, readHookState,
// writeHookState, claimSensorRun) used by individual sensor files.
//
// State files live in db/hook-state/{name}.json (already in .gitignore).

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "./skills.ts";
import { initDatabase } from "./db.ts";
import { isShutdown, getShutdownState } from "./shutdown.ts";
import { insertTask, pendingTaskExistsForSource, pendingTaskExistsForSubject, taskExistsForSource, checkRecentFailures } from "./db.ts";
export { insertTask, pendingTaskExistsForSource, taskExistsForSource };
import type { InsertTask } from "./db.ts";

// ---- Constants ----

const HOOK_STATE_DIR = new URL("../db/hook-state", import.meta.url).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const RUNTIME_CANARY_PATH = join(REPO_ROOT, ".arc-runtime");
const EXPECTED_AGENT = "loom";

// Ensure state directory exists once at module load
mkdirSync(HOOK_STATE_DIR, { recursive: true });

// ---- Working-tree guards ----
//
// The sensor service discovers sensors dynamically from skills/<name>/sensor.ts.
// If the working tree is in a transient state (mid-rebase, mid-cherry-pick,
// mid-merge) or pointing at a foreign branch (e.g., upstream main during a
// throwaway checkout), discoverSkills will return whatever is on disk —
// including sensors that don't belong to this agent. Those sensors then
// queue tasks referencing skills that don't exist post-checkout. A 12-second
// `git checkout origin/main` window on 2026-04-28 produced 26 such tasks.
//
// These guards exit early when the tree isn't in a safe state.

export function detectMidGitOperation(repoRoot: string): string | null {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) return null;
  const fileMarkers: Record<string, string> = {
    MERGE_HEAD: "merge in progress",
    CHERRY_PICK_HEAD: "cherry-pick in progress",
    REVERT_HEAD: "revert in progress",
    REBASE_HEAD: "rebase in progress",
  };
  for (const [name, label] of Object.entries(fileMarkers)) {
    if (existsSync(join(gitDir, name))) return label;
  }
  if (existsSync(join(gitDir, "rebase-merge"))) return "interactive rebase in progress";
  if (existsSync(join(gitDir, "rebase-apply"))) return "rebase-apply in progress";
  return null;
}

export function checkRuntimeCanary(canaryPath: string, expected: string): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(canaryPath)) {
    return { ok: false, reason: `.arc-runtime missing — working tree may be from a foreign branch state` };
  }
  let content = "";
  try {
    content = readFileSync(canaryPath, "utf-8").trim();
  } catch (err) {
    return { ok: false, reason: `.arc-runtime read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (content !== expected) {
    return { ok: false, reason: `.arc-runtime mismatch (expected '${expected}', got '${content}')` };
  }
  return { ok: true };
}

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

/** Create a prefixed logger for a sensor. Usage: `const log = createSensorLogger("service-health");` */
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
  // Failure-aware dedup: if >3 recent failures on the same topic, suppress creation.
  // Prevents retry storms like the X syndication incident (9 retries, same article).
  const failures = checkRecentFailures(taskConfig.subject);
  if (failures.exceeded) {
    console.log(
      `[failure-dedup] Suppressed task "${taskConfig.subject}" — ${failures.count} recent failures in last 24h (threshold: 3)`,
    );
    return null;
  }
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

  // Working-tree guard — refuse to discover sensors during a transient git state
  const midOp = detectMidGitOperation(REPO_ROOT);
  if (midOp) {
    process.stdout.write(`sensors: SKIP — ${midOp}; will retry next cycle\n`);
    return;
  }
  const canary = checkRuntimeCanary(RUNTIME_CANARY_PATH, EXPECTED_AGENT);
  if (!canary.ok) {
    process.stdout.write(`sensors: SKIP — ${canary.reason}\n`);
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
