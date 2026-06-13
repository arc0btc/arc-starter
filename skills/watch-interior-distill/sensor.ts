// skills/watch-interior-distill/sensor.ts
//
// 12h cadence. Detects the newest reports/*_watch_report.html and, if it's
// newer than the last distilled report (hook-state), queues ONE sonnet task
// that produces 1-2 "interior observation" nuggets in
// artifacts/distilled/watch-interior/.
//
// Interior observations are concrete operating deltas — cost trends,
// failure clusters, sensor anomalies, relationship deltas, or surprises that
// surfaced in the watch report. The paid-room synthesis lane reads these for
// the $50/mo value gradient: paying members see Arc's interior reasoning
// material; free-forum digest does NOT pull these (it already has the public
// watch-report surface).

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

export const SENSOR_NAME = "watch-interior-distill";
const INTERVAL_MINUTES = 12 * 60;
const REPORTS_DIR = resolve(import.meta.dir, "../../reports");
const log = createSensorLogger(SENSOR_NAME);

/** Newest `*_watch_report.html` filename (basename only). null when none exist. */
function newestWatchReportBasename(): string | null {
  if (!existsSync(REPORTS_DIR)) return null;
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith("_watch_report.html") || f.endsWith("_watch_report.md"))
    .sort();
  return files.at(-1) ?? null;
}

export async function pollWatchInteriorDistill(): Promise<"ok" | "skip"> {
  if (Bun.env.WATCH_INTERIOR_ENABLED !== "true" && Bun.env.ARC_DISTILL_FORCE !== "1") {
    log("disabled (WATCH_INTERIOR_ENABLED=false) — awaiting first smoke + sign-off");
    return "skip";
  }

  const newest = newestWatchReportBasename();
  if (!newest) {
    log("no watch report on disk — skip");
    return "skip";
  }

  const state = await readHookState(SENSOR_NAME);
  const lastDistilled = state?.lastDistilledReport as string | undefined;
  if (lastDistilled === newest) {
    log(`already distilled ${newest} — skip`);
    return "skip";
  }

  // Filename pattern: 2026-06-13T01_01_25Z_watch_report.html
  // Extract the timestamp (with underscores; consumers compare by basename).
  const reportIso = newest.replace(/_watch_report\.(html|md)$/, "").replace(/_/g, ":");
  const source = `sensor:arc-reporting-watch:interior-${reportIso}`;
  if (pendingTaskExistsForSource(source)) {
    log(`distill task already queued for ${reportIso} — skip`);
    return "skip";
  }

  const reportPath = resolve(REPORTS_DIR, newest);
  const taskId = insertTask({
    subject: `Distill watch report ${reportIso} into 1-2 interior observation nuggets`,
    description: [
      `Source report: ${reportPath}`,
      "",
      "## Goal",
      "Read the watch report. Extract 1-2 INTERIOR OBSERVATIONS — concrete operating",
      "deltas that paying $50/mo members would want to hear about. Each becomes one",
      "nugget in artifacts/distilled/watch-interior/ via writeDistilled (in src/artifacts.ts).",
      "",
      "## Fixed topic taxonomy (use exactly these)",
      "  - cost                 (today's spend trend, opus burn, $/task drift)",
      "  - failure-cluster      (a group of related failures or one big one)",
      "  - sensor-anomaly       (a sensor fired unexpectedly or stayed silent)",
      "  - relationship-delta   (a counterparty pattern that shifted)",
      "  - surprise             (anything signal-rich that doesn't fit the others)",
      "",
      "Pick the 1-2 strongest. If the report is operationally quiet (high success rate,",
      "boring cost, no anomalies), write 0-1 nuggets — quality > quota.",
      "",
      "## Per-nugget constraints (writeDistilled enforces)",
      "- type: \"watch-interior\"",
      "- topic: one of the five slugs above",
      "- nugget: ≤ 1200 chars. Concrete numbers + 1-sentence framing.",
      "    Format: `<observation with specific numbers>. <Why a member would care>`.",
      "    Selection over invention — quote the report's metrics directly.",
      "- citation: `watch-report:<iso>` (e.g. `watch-report:2026-06-13T01:01:25Z`)",
      "- suggested_channels: [\"whop-chat\", \"reactive\"]  ← PAID-ROOM PREMIUM ONLY",
      "  (do NOT include public-forum or x — those have separate surfaces)",
      "",
      "## Asymmetry rule",
      "These nuggets fuel the paid-room synthesis and reactive lane to give paying",
      "members context the free-forum readers don't get. Stay close to the operational",
      "story — what Arc noticed, learned, almost broke — not press-release prose.",
      "",
      "## Steps",
      "1. Read the watch report at the path above.",
      "2. For each picked observation, write a nugget via:",
      "   `import { writeDistilled } from \"../../src/artifacts.ts\"; writeDistilled({...});`",
      "3. Verify on disk: `ls -la artifacts/distilled/watch-interior/`",
      "4. Close completed with --summary describing topics picked and skips.",
      "",
      "## Skipping is OK",
      "Quiet day → 0 nuggets. The pool stays sharper without filler.",
    ].join("\n"),
    skills: JSON.stringify(["watch-interior-distill", "arc-reporting"]),
    priority: 5,
    model: "sonnet",
    status: "pending",
    source,
  });

  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: state?.last_ran ?? new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastDistilledReport: newest,
  } as Parameters<typeof writeHookState>[1]);

  log(`queued distill task ${taskId} for ${newest}`);
  return "ok";
}

export default async function watchInteriorDistillSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    return await pollWatchInteriorDistill();
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    return "skip";
  }
}
