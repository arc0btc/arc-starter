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

// ---- Constants ----

const HOOK_STATE_DIR = new URL("../db/hook-state", import.meta.url).pathname;

// Ensure state directory exists once at module load
mkdirSync(HOOK_STATE_DIR, { recursive: true });

// ---- Types ----

export interface HookState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  consecutive_failures: number;
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

// ---- Scheduling ----

// Returns true if the sensor should run based on its interval.
//
// A sensor should run when:
//   - It has never run (state is null), OR
//   - At least intervalMinutes minutes have passed since last_ran
export async function shouldRun(name: string, intervalMinutes: number): Promise<boolean> {
  const state = await readHookState(name);
  if (state === null) return true;
  const intervalMs = intervalMinutes * 60 * 1000;
  const nextAllowed = new Date(state.last_ran).getTime() + intervalMs;
  return Date.now() >= nextAllowed;
}

// Combines interval gating + state claim into a single call.
// Returns false if the sensor should not run. Returns true and writes
// an "ok" state claim if the sensor should proceed.
export async function claimSensorRun(name: string, intervalMinutes: number): Promise<boolean> {
  const state = await readHookState(name);

  // Check interval gating inline to avoid a redundant readHookState call
  if (state !== null) {
    const intervalMs = intervalMinutes * 60 * 1000;
    const nextAllowed = new Date(state.last_ran).getTime() + intervalMs;
    if (Date.now() < nextAllowed) return false;
  }

  await writeHookState(name, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: state ? state.version + 1 : 1,
    consecutive_failures: 0,
  });

  return true;
}

// ---- Sensor runner ----

interface SensorResult {
  name: string;
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  error?: string;
}

// Discover all skills/<name>/sensor.ts files and run them in parallel.
// Each sensor is responsible for its own shouldRun() gating.
// Logs per-sensor result: name, ok/error/skip, duration.
export async function runSensors(): Promise<void> {
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
      const result = await fn();
      const durationMs = Date.now() - t0;
      // Sensors can return "skip" string to signal they were gated out
      if (result === "skip") {
        return { name: skill.name, ok: true, skipped: true, durationMs };
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

  const results = await Promise.all(promises);

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
