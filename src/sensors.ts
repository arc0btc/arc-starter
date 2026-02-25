// sensors.ts
//
// Discovers all skills/<name>/sensor.ts files and runs them in parallel.
// Each sensor is responsible for its own shouldRun() gating.
//
// Also provides the shouldRun infrastructure (HookState, readHookState,
// writeHookState) ported from v4's hook-state.ts, adapted for arc-agent-v5.
//
// State files live in db/hook-state/{name}.json (already in .gitignore).

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "./skills.ts";
import { initDatabase } from "./db.ts";

// ---- Constants ----

const HOOK_STATE_DIR = new URL("../db/hook-state", import.meta.url).pathname;

// ---- Types ----

export interface HookState {
  // ISO-8601 timestamp of the last execution attempt
  last_ran: string;
  // Outcome of the last run
  last_result: "ok" | "error" | "skip";
  // Monotonic counter — increments on every writeHookState call
  version: number;
  // Number of consecutive errors — resets to 0 on "ok" or "skip"
  consecutive_failures: number;
}

// ---- Read ----

// Read hook state from db/hook-state/{name}.json.
// Returns null if the file does not exist or cannot be parsed.
export async function readHookState(name: string): Promise<HookState | null> {
  mkdirSync(HOOK_STATE_DIR, { recursive: true });
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

// Write hook state to db/hook-state/{name}.json.
// Ensures the directory exists before writing.
export async function writeHookState(name: string, state: HookState): Promise<void> {
  mkdirSync(HOOK_STATE_DIR, { recursive: true });
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

  const settled = await Promise.allSettled(promises);
  const results: SensorResult[] = settled.map((r) => {
    if (r.status === "fulfilled") return r.value;
    return { name: "unknown", ok: false, skipped: false, durationMs: 0, error: String(r.reason) };
  });

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
