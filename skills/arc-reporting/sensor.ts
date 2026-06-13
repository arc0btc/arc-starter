// reporting/sensor.ts
//
// Unified reporting sensor with two time-gated variants:
// 1. Watch report — every 6 hours during active hours (6am–8pm Pacific), P6, HTML
// 2. Overnight brief — once daily at 6am Pacific, P2, markdown
//
// Each variant uses its own sensor claim to avoid interference.
// Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, recentTaskExistsForSource, insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";
import {
  ARTIFACT_TYPES,
  countByType,
  countConsumedByChannel,
  type ArtifactType,
  type ArtifactChannel,
} from "../../src/artifacts.ts";

// ---- Shared helpers ----

const log = createSensorLogger("arc-reporting");

/** Current hour in America/Los_Angeles (handles PST/PDT automatically). */
function getPacificHour(): number {
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).format(now);
  return parseInt(hourStr, 10);
}

/** True when current time is in quiet hours (8pm–6am Pacific). */
function isQuietHours(): boolean {
  const hour = getPacificHour();
  return hour >= 20 || hour < 6;
}

// ---- Watch report variant ----

const INTERVAL_MINUTES = 60; // minimum polling interval; variants use their own intervals internally

const WATCH_SENSOR = "arc-reporting-watch";
const WATCH_INTERVAL = 360; // 6 hours
const WATCH_SOURCE = "sensor:arc-reporting-watch";
const WATCH_PRIORITY = 6;

/**
 * Compute a quick text summary of the inflow pool over the past N hours.
 * Embedded into the watch-report task description so the dispatched session
 * can drop it under "## Inflow pool" verbatim. Pure DB query; safe to call
 * even when the pool is empty.
 */
function buildInflowSummary(sinceHours: number): string {
  const produced = countByType(sinceHours);
  const consumed = countConsumedByChannel(sinceHours);
  const lines: string[] = [];
  lines.push(`Inflow pool — last ${sinceHours}h`);
  lines.push("");
  lines.push("Produced (source-artifact pool):");
  let totalProduced = 0;
  for (const type of ARTIFACT_TYPES) {
    lines.push(`  ${type}: ${produced[type]}`);
    totalProduced += produced[type];
  }
  lines.push(`  total: ${totalProduced}`);
  lines.push("");
  lines.push("Consumed (by channel):");
  let totalConsumed = 0;
  for (const channel of Object.keys(consumed) as ArtifactChannel[]) {
    lines.push(`  ${channel}: ${consumed[channel]}`);
    totalConsumed += consumed[channel];
  }
  lines.push(`  total: ${totalConsumed}`);

  // Stuck-distill alert: any type with 0 produced in 36h while gates are ON.
  const STUCK_HOURS = 36;
  const stuckProduced = countByType(STUCK_HOURS);
  const stuckTypes: ArtifactType[] = [];
  for (const type of ARTIFACT_TYPES) {
    if (stuckProduced[type] === 0) stuckTypes.push(type);
  }
  if (stuckTypes.length > 0) {
    lines.push("");
    lines.push(`⚠️  No fresh artifacts in ${STUCK_HOURS}h: ${stuckTypes.join(", ")}`);
    lines.push("    (gates off, sensor stalled, or upstream source is quiet)");
  }

  return lines.join("\n");
}

async function watchReportSensor(): Promise<string> {
  if (isQuietHours()) return "skip";

  const claimed = await claimSensorRun(WATCH_SENSOR, WATCH_INTERVAL);
  if (!claimed) return "skip";

  // Time-bounded dedup: ignore stale tasks older than 8h to prevent indefinite blocking
  if (recentTaskExistsForSource(WATCH_SOURCE, 480)) return "skip";

  const now = new Date().toISOString();
  const inflowSummary = buildInflowSummary(24);

  insertTask({
    subject: `Watch report — ${now.slice(0, 16)}Z`,
    description:
      "Generate an HTML watch report covering all activity since the last report.\n\n" +
      "Follow the instructions in skills/arc-reporting/AGENT.md (Watch Report section).\n" +
      "Use the template at templates/status-report.html.\n" +
      "Include prediction market positions from stacks-market skill.\n" +
      "Write output to reports/ directory as .html.\n\n" +
      `Report period ends: ${now}\n\n` +
      "## Inflow pool (embed this verbatim under its own section in the report)\n\n" +
      "```\n" +
      inflowSummary +
      "\n```\n\n" +
      "Add a one-line interpretive cap to the section: comment on the producer/consumer ratio " +
      "(healthy ≈ 1:1 over time; if produced >> consumed, consumers are starved; if consumed >> produced, producers are stalled) " +
      "and call out any stuck-distill alerts above.",
    skills: '["arc-reporting"]',
    source: WATCH_SOURCE,
    priority: WATCH_PRIORITY,
    model: "sonnet",
  });

  return "ok";
}

// ---- Overnight brief variant ----

const OVERNIGHT_SENSOR = "arc-reporting-overnight";
const OVERNIGHT_INTERVAL = 60; // check every hour, but only fire at 6am PST
const OVERNIGHT_SOURCE = "sensor:arc-reporting-overnight";
const OVERNIGHT_PRIORITY = 2;

async function overnightBriefSensor(): Promise<string> {
  const hour = getPacificHour();
  if (hour !== 6) return "skip";

  const claimed = await claimSensorRun(OVERNIGHT_SENSOR, OVERNIGHT_INTERVAL);
  if (!claimed) return "skip";

  // Time-bounded dedup: ignore stale tasks older than 24h to prevent indefinite blocking
  if (recentTaskExistsForSource(OVERNIGHT_SOURCE, 1440)) return "skip";

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Use workflow for brief→retrospective chain tracking
  const wfKey = `overnight-brief:${today}`;
  if (getWorkflowByInstanceKey(wfKey)) return "skip";

  insertWorkflow({
    template: "overnight-brief",
    instance_key: wfKey,
    current_state: "pending",
    context: JSON.stringify({ date: today }),
  });

  return "ok";
}

// ---- Entry point: run both variants ----

export default async function reportingSensor(): Promise<string> {
  const watchResult = await watchReportSensor();
  const overnightResult = await overnightBriefSensor();

  // Return "ok" if either created a task, "skip" if both skipped
  if (watchResult === "ok" || overnightResult === "ok") return "ok";
  return "skip";
}
