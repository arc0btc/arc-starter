/**
 * arc-typecheck-guard sensor.
 *
 * Catches the #22717 failure class: an unattended `chore(loop): auto-commit`
 * ships a .ts file that transpiles cleanly but is type-broken (wrong arg type,
 * dropped required field), so it throws at runtime and silently halts a sensor.
 * Bun's transpile-only pre-commit guard cannot see type errors; this sensor runs
 * a real `tsc --noEmit` on a cadence and flags per-file error-count INCREASES
 * introduced by auto-commits, ignoring the project's pre-existing errors.
 */

import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { runGuard } from "./check.ts";

const SENSOR_NAME = "arc-typecheck-guard";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE = "sensor:arc-typecheck-guard";

const log = createSensorLogger(SENSOR_NAME);

export default async function typecheckGuardSensor(): Promise<string> {
  if (!(await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES))) return "skip";

  const outcome = await runGuard();

  if (outcome.status === "tsc-unavailable") {
    log("tsc could not run (binary missing or crashed) — baseline left untouched");
    return "ok";
  }
  if (outcome.status !== "regressions") {
    log(`no new type errors from auto-commits (${outcome.status})`);
    return "ok";
  }

  const regressions = outcome.regressions ?? [];
  const summary = regressions
    .map((regression) => `${regression.file}: ${regression.before} → ${regression.after} errors`)
    .join("\n");
  const detail = regressions
    .map((regression) => `### ${regression.file}\n${regression.lines.slice(0, 20).join("\n")}`)
    .join("\n\n");

  const description =
    "An unattended `chore(loop): auto-commit` introduced new TypeScript errors that " +
    "Bun's transpile-only pre-commit guard cannot catch (root cause #22717).\n\n" +
    `Files whose tsc error count increased (baseline → current):\n${summary}\n\n` +
    "Fix the type errors below. If they are intentional or pre-existing-style noise, " +
    "explain why and let the next guard pass absorb them into the baseline.\n\n" +
    detail;

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Fix type errors from unattended auto-commit (${regressions.length} file(s))`,
    description,
    priority: 3,
    model: "sonnet",
    skills: JSON.stringify(["arc-skill-manager"]),
  });

  if (id !== null) {
    log(`created type-error follow-up task #${id} for ${regressions.length} file(s)`);
  } else {
    log("type-error follow-up already queued — skipping");
  }
  return "ok";
}
