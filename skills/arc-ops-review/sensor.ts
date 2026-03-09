/**
 * arc-ops-review sensor
 *
 * Every 4 hours, analyzes task queue metrics:
 * - Creation vs completion rate (4h window)
 * - Backlog trend (pending count)
 * - Fleet utilization (from memory/fleet-status.json)
 * - Cost per useful output
 *
 * Writes snapshot to memory/ops-metrics.json.
 * Creates a review task when thresholds are breached.
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "arc-ops-review";
const INTERVAL_MINUTES = 240; // 4 hours
const TASK_SOURCE = "sensor:arc-ops-review";
const LOOKBACK_HOURS = 4;

const log = createSensorLogger(SENSOR_NAME);
const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

// ---- Thresholds ----

const BACKLOG_GROWTH_RATIO = 1.5; // created > completed by 50%+
const COST_PER_COMPLETION_LIMIT = 1.0; // $1.00 per completed task
const FAILURE_RATE_LIMIT = 0.3; // 30% failure rate

// ---- Metrics collection ----

interface OpsMetrics {
  timestamp: string;
  window_hours: number;
  created: number;
  completed: number;
  failed: number;
  pending_count: number;
  active_count: number;
  total_cost_usd: number;
  cost_per_completion: number;
  failure_rate: number;
  creation_completion_ratio: number;
  fleet: FleetSnapshot | null;
  issues: string[];
}

interface FleetSnapshot {
  agent: string;
  updated_at: string;
  last_task_id: number | null;
  last_cycle_cost: number | null;
  stale: boolean;
}

function collectMetrics(): OpsMetrics {
  const db = getDatabase();
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString();

  // Tasks created in window
  const createdRow = db.query(
    "SELECT COUNT(*) as c FROM tasks WHERE created_at >= ?",
  ).get(since) as { c: number };
  const created = createdRow.c;

  // Tasks completed in window
  const completedRow = db.query(
    "SELECT COUNT(*) as c FROM tasks WHERE completed_at >= ? AND status = 'completed'",
  ).get(since) as { c: number };
  const completed = completedRow.c;

  // Tasks failed in window
  const failedRow = db.query(
    "SELECT COUNT(*) as c FROM tasks WHERE completed_at >= ? AND status = 'failed'",
  ).get(since) as { c: number };
  const failed = failedRow.c;

  // Current backlog
  const pendingRow = db.query(
    "SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'",
  ).get() as { c: number };
  const pending_count = pendingRow.c;

  const activeRow = db.query(
    "SELECT COUNT(*) as c FROM tasks WHERE status = 'active'",
  ).get() as { c: number };
  const active_count = activeRow.c;

  // Total cost in window (from cycle_log for accuracy)
  const costRow = db.query(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cycle_log WHERE started_at >= ?",
  ).get(since) as { total: number };
  const total_cost_usd = costRow.total;

  // Derived metrics
  const cost_per_completion = completed > 0 ? total_cost_usd / completed : 0;
  const finished = completed + failed;
  const failure_rate = finished > 0 ? failed / finished : 0;
  const creation_completion_ratio = completed > 0 ? created / completed : created > 0 ? Infinity : 0;

  // Fleet self-reported status
  let fleet: FleetSnapshot | null = null;
  try {
    const statusFile = Bun.file(join(MEMORY_DIR, "fleet-status.json"));
    // Synchronous check not available; read and handle error
    const text = readFleetStatusSync();
    if (text) {
      const parsed = JSON.parse(text);
      const ageMs = Date.now() - new Date(parsed.updated_at).getTime();
      fleet = {
        agent: parsed.agent,
        updated_at: parsed.updated_at,
        last_task_id: parsed.last_task?.id ?? null,
        last_cycle_cost: parsed.last_cycle?.cost_usd ?? null,
        stale: ageMs > 30 * 60_000,
      };
    }
  } catch {
    // fleet status unavailable — not critical
  }

  // Detect issues
  const issues: string[] = [];

  if (completed > 0 && creation_completion_ratio >= BACKLOG_GROWTH_RATIO) {
    issues.push(
      `backlog growing: ${created} created vs ${completed} completed (${creation_completion_ratio.toFixed(1)}x ratio)`,
    );
  } else if (created > 0 && completed === 0) {
    issues.push(`zero completions in ${LOOKBACK_HOURS}h window (${created} created)`);
  }

  if (completed > 0 && cost_per_completion > COST_PER_COMPLETION_LIMIT) {
    issues.push(
      `high cost/completion: $${cost_per_completion.toFixed(2)} ($${total_cost_usd.toFixed(2)} / ${completed} tasks)`,
    );
  }

  if (finished >= 5 && failure_rate > FAILURE_RATE_LIMIT) {
    issues.push(
      `high failure rate: ${(failure_rate * 100).toFixed(0)}% (${failed}/${finished})`,
    );
  }

  if (pending_count > 100) {
    issues.push(`large backlog: ${pending_count} pending tasks`);
  }

  return {
    timestamp: now.toISOString(),
    window_hours: LOOKBACK_HOURS,
    created,
    completed,
    failed,
    pending_count,
    active_count,
    total_cost_usd: Math.round(total_cost_usd * 1000) / 1000,
    cost_per_completion: Math.round(cost_per_completion * 1000) / 1000,
    failure_rate: Math.round(failure_rate * 1000) / 1000,
    creation_completion_ratio: creation_completion_ratio === Infinity
      ? -1
      : Math.round(creation_completion_ratio * 100) / 100,
    fleet,
    issues,
  };
}

function readFleetStatusSync(): string | null {
  try {
    const path = join(MEMORY_DIR, "fleet-status.json");
    const file = Bun.file(path);
    // Use synchronous read via node:fs for sensor context
    const { readFileSync, existsSync } = require("node:fs");
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

// ---- Sensor entry point ----

export default async function opsReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const metrics = collectMetrics();

  // Write snapshot
  await Bun.write(
    join(MEMORY_DIR, "ops-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );

  // Persist previous backlog count in hook state for trend tracking
  const state = await readHookState(SENSOR_NAME);
  const prevPending = (state?.prev_pending as number) ?? null;
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    prev_pending: metrics.pending_count,
    prev_cost_per_completion: metrics.cost_per_completion,
  });

  // Add backlog trend issue if we have history
  if (prevPending !== null && metrics.pending_count > prevPending + 20) {
    metrics.issues.push(
      `backlog trending up: ${prevPending} → ${metrics.pending_count} pending`,
    );
  }

  log(
    `metrics: ${metrics.created} created, ${metrics.completed} completed, ${metrics.failed} failed, ` +
    `${metrics.pending_count} pending, $${metrics.total_cost_usd.toFixed(2)} cost, ` +
    `$${metrics.cost_per_completion.toFixed(2)}/completion`,
  );

  // Create review task only if issues detected
  if (metrics.issues.length === 0) {
    log("all metrics within thresholds");
    return "ok";
  }

  const issueList = metrics.issues.map((i) => `- ${i}`).join("\n");
  log(`issues detected:\n${issueList}`);

  const created = insertTaskIfNew(TASK_SOURCE, {
    subject: `Ops review: ${metrics.issues[0]}`,
    description: [
      `Ops review sensor detected ${metrics.issues.length} issue(s) in the last ${LOOKBACK_HOURS}h:\n`,
      issueList,
      "",
      "Metrics snapshot:",
      `- Created: ${metrics.created}`,
      `- Completed: ${metrics.completed}`,
      `- Failed: ${metrics.failed}`,
      `- Pending backlog: ${metrics.pending_count}`,
      `- Active: ${metrics.active_count}`,
      `- Total cost: $${metrics.total_cost_usd.toFixed(2)}`,
      `- Cost/completion: $${metrics.cost_per_completion.toFixed(2)}`,
      `- Failure rate: ${(metrics.failure_rate * 100).toFixed(0)}%`,
      "",
      "Full snapshot at memory/ops-metrics.json",
    ].join("\n"),
    priority: 7,
    skills: '["arc-ops-review"]',
  });

  if (created !== null) {
    log(`created review task #${created}`);
  }

  return "ok";
}
