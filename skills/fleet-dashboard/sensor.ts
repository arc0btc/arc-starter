/**
 * fleet-dashboard sensor
 *
 * Every 30 minutes, SSH into each fleet VM and collect:
 * - Task counts: pending, active, completed today, failed today
 * - Today's cost spend (sum of cost_usd from tasks completed today)
 *
 * Writes aggregate dashboard to memory/fleet-dashboard.md.
 * Creates alert tasks if:
 * - Any agent has 0 completed tasks in the last hour
 * - Any agent's today's spend exceeds the configured threshold
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-dashboard";
const INTERVAL_MINUTES = 30;
const ALERT_SOURCE_PREFIX = "sensor:fleet-dashboard";

// Alert thresholds
const SPEND_THRESHOLD_USD = 30; // alert if any peer exceeds $30/day
const ARC_SPEND_THRESHOLD_USD = 80; // Arc has a larger budget allocation

const log = createSensorLogger(SENSOR_NAME);

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

// ---- Types ----

interface AgentMetrics {
  agent: string;
  reachable: boolean;
  taskCounts: {
    pending: number;
    active: number;
    completedToday: number;
    failedToday: number;
    completedLastHour: number;
  };
  costToday: number;
  lastCycleAge: string; // e.g. "5m ago"
  issues: string[];
}

// ---- Data collection ----

async function collectMetrics(
  agent: string,
  password: string,
): Promise<AgentMetrics> {
  const metrics: AgentMetrics = {
    agent,
    reachable: false,
    taskCounts: {
      pending: 0,
      active: 0,
      completedToday: 0,
      failedToday: 0,
      completedLastHour: 0,
    },
    costToday: 0,
    lastCycleAge: "unknown",
    issues: [],
  };

  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    metrics.issues.push("No IP configured");
    return metrics;
  }

  const ping = await ssh(ip, password, "echo ok");
  if (!ping.ok) {
    metrics.issues.push("SSH unreachable");
    return metrics;
  }
  metrics.reachable = true;

  // Query all metrics in one Bun snippet to minimize SSH round-trips
  const queryResult = await ssh(
    ip,
    password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const today = new Date().toISOString().slice(0, 10);
      const hourAgo = new Date(Date.now() - 3600000).toISOString();

      const pending = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'\\").get()?.c ?? 0;
      const active = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'active'\\").get()?.c ?? 0;
      const completedToday = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at >= ?\\").get(today + 'T00:00:00')?.c ?? 0;
      const failedToday = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'failed' AND completed_at >= ?\\").get(today + 'T00:00:00')?.c ?? 0;
      const completedLastHour = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at >= ?\\").get(hourAgo)?.c ?? 0;
      const costToday = db.query(\\"SELECT COALESCE(SUM(cost_usd), 0) as s FROM tasks WHERE completed_at >= ?\\").get(today + 'T00:00:00')?.s ?? 0;

      const lastCycle = db.query(\\"SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1\\").get();
      let lastCycleAge = 'no cycles';
      if (lastCycle && lastCycle.completed_at) {
        const age = Math.round((Date.now() - new Date(lastCycle.completed_at).getTime()) / 60000);
        lastCycleAge = age + 'm ago';
      }

      console.log(JSON.stringify({ pending, active, completedToday, failedToday, completedLastHour, costToday, lastCycleAge }));
      db.close();
    " 2>/dev/null || echo '{}'`,
  );

  try {
    const data = JSON.parse(queryResult.stdout.trim()) as {
      pending: number;
      active: number;
      completedToday: number;
      failedToday: number;
      completedLastHour: number;
      costToday: number;
      lastCycleAge: string;
    };
    metrics.taskCounts.pending = data.pending ?? 0;
    metrics.taskCounts.active = data.active ?? 0;
    metrics.taskCounts.completedToday = data.completedToday ?? 0;
    metrics.taskCounts.failedToday = data.failedToday ?? 0;
    metrics.taskCounts.completedLastHour = data.completedLastHour ?? 0;
    metrics.costToday = typeof data.costToday === "number" ? data.costToday : 0;
    metrics.lastCycleAge = data.lastCycleAge ?? "unknown";
  } catch {
    metrics.issues.push("query failed");
  }

  return metrics;
}

// ---- Arc's own metrics (local DB, no SSH) ----

async function collectArcMetrics(): Promise<AgentMetrics> {
  const metrics: AgentMetrics = {
    agent: "arc",
    reachable: true,
    taskCounts: {
      pending: 0,
      active: 0,
      completedToday: 0,
      failedToday: 0,
      completedLastHour: 0,
    },
    costToday: 0,
    lastCycleAge: "unknown",
    issues: [],
  };

  try {
    const { Database } = await import("bun:sqlite");
    const dbPath = new URL("../../db/arc.sqlite", import.meta.url).pathname;
    const db = new Database(dbPath, { readonly: true });

    const today = new Date().toISOString().slice(0, 10);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const todayStart = today + "T00:00:00";

    metrics.taskCounts.pending =
      (
        db
          .query("SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'")
          .get() as { c: number }
      )?.c ?? 0;
    metrics.taskCounts.active =
      (
        db
          .query("SELECT COUNT(*) as c FROM tasks WHERE status = 'active'")
          .get() as { c: number }
      )?.c ?? 0;
    metrics.taskCounts.completedToday =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at >= ?",
          )
          .get(todayStart) as { c: number }
      )?.c ?? 0;
    metrics.taskCounts.failedToday =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM tasks WHERE status = 'failed' AND completed_at >= ?",
          )
          .get(todayStart) as { c: number }
      )?.c ?? 0;
    metrics.taskCounts.completedLastHour =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at >= ?",
          )
          .get(hourAgo) as { c: number }
      )?.c ?? 0;

    const costRow = db
      .query(
        "SELECT COALESCE(SUM(cost_usd), 0) as s FROM tasks WHERE completed_at >= ?",
      )
      .get(todayStart) as { s: number };
    metrics.costToday = costRow?.s ?? 0;

    const lastCycle = db
      .query("SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1")
      .get() as { completed_at: string } | null;
    if (lastCycle?.completed_at) {
      const age = Math.round(
        (Date.now() - new Date(lastCycle.completed_at).getTime()) / 60_000,
      );
      metrics.lastCycleAge = `${age}m ago`;
    } else {
      metrics.lastCycleAge = "no cycles";
    }

    db.close();
  } catch (error) {
    metrics.issues.push(
      `local query failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return metrics;
}

// ---- Dashboard generation ----

function formatDashboard(
  allMetrics: AgentMetrics[],
  timestamp: string,
): string {
  // Totals
  const totalPending = allMetrics.reduce(
    (s, m) => s + m.taskCounts.pending,
    0,
  );
  const totalActive = allMetrics.reduce((s, m) => s + m.taskCounts.active, 0);
  const totalCompletedToday = allMetrics.reduce(
    (s, m) => s + m.taskCounts.completedToday,
    0,
  );
  const totalFailedToday = allMetrics.reduce(
    (s, m) => s + m.taskCounts.failedToday,
    0,
  );
  const totalCostToday = allMetrics.reduce((s, m) => s + m.costToday, 0);

  const lines: string[] = [
    "# Fleet Dashboard",
    "",
    `*Last updated: ${timestamp}*`,
    "",
    "## Fleet Summary",
    "",
    `| | Pending | Active | Done Today | Failed Today | Spend Today |`,
    `|---|---------|--------|------------|--------------|-------------|`,
    `| **TOTAL** | ${totalPending} | ${totalActive} | ${totalCompletedToday} | ${totalFailedToday} | **$${totalCostToday.toFixed(2)}** |`,
    "",
    "## Per-Agent Metrics",
    "",
    "| Agent | Reachable | Pending | Active | Done Today | Failed Today | Last Hour | Spend Today | Last Cycle |",
    "|-------|-----------|---------|--------|------------|--------------|-----------|-------------|------------|",
  ];

  for (const m of allMetrics) {
    const reachable = m.reachable ? "yes" : "**NO**";
    const spendStr =
      m.costToday > 0 ? `$${m.costToday.toFixed(2)}` : "$0.00";
    const issues =
      m.issues.length > 0 ? ` ⚠ ${m.issues.join("; ")}` : "";
    const lastHour = m.taskCounts.completedLastHour === 0 && m.reachable
      ? `**${m.taskCounts.completedLastHour}**`
      : `${m.taskCounts.completedLastHour}`;
    lines.push(
      `| ${m.agent}${issues} | ${reachable} | ${m.taskCounts.pending} | ${m.taskCounts.active} | ${m.taskCounts.completedToday} | ${m.taskCounts.failedToday} | ${lastHour} | ${spendStr} | ${m.lastCycleAge} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

// ---- Sensor entry point ----

export default async function fleetDashboardSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("collecting fleet dashboard metrics...");

  const timestamp = new Date().toISOString();

  // Collect Arc's own metrics locally
  const arcMetrics = await collectArcMetrics();

  // Collect peer metrics via SSH (in parallel)
  let peerMetrics: AgentMetrics[] = [];
  try {
    const password = await getSshPassword();
    const agentNames = getActiveAgentNames();
    const results = await Promise.allSettled(
      agentNames.map((agent) => collectMetrics(agent, password)),
    );
    peerMetrics = results.map((r, i) => {
      const agent = agentNames[i];
      if (r.status === "fulfilled") return r.value;
      return {
        agent,
        reachable: false,
        taskCounts: {
          pending: 0,
          active: 0,
          completedToday: 0,
          failedToday: 0,
          completedLastHour: 0,
        },
        costToday: 0,
        lastCycleAge: "unknown",
        issues: [
          `check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        ],
      } satisfies AgentMetrics;
    });
  } catch {
    log("no SSH password configured — peer metrics unavailable");
  }

  const allMetrics = [arcMetrics, ...peerMetrics];

  // Write dashboard
  const dashboard = formatDashboard(allMetrics, timestamp);
  await Bun.write(join(MEMORY_DIR, "fleet-dashboard.md"), dashboard);

  // Create alert tasks
  let alertCount = 0;
  for (const m of allMetrics) {
    if (!m.reachable) continue;

    const threshold =
      m.agent === "arc" ? ARC_SPEND_THRESHOLD_USD : SPEND_THRESHOLD_USD;

    // Alert: 0 completed tasks in last hour (skip if agent is newly started)
    if (
      m.taskCounts.completedLastHour === 0 &&
      m.taskCounts.completedToday > 0
    ) {
      const source = `${ALERT_SOURCE_PREFIX}:${m.agent}:idle`;
      const subject = `Fleet idle alert: ${m.agent} — 0 completed tasks in last hour`;
      const created = insertTaskIfNew(source, {
        subject,
        description: `Agent **${m.agent}** has completed 0 tasks in the last hour despite having completed ${m.taskCounts.completedToday} tasks today. May indicate a stall or stuck dispatch.\n\nCurrent queue: ${m.taskCounts.pending} pending, ${m.taskCounts.active} active.\n\nCheck fleet status: \`arc skills run --name fleet-health -- status\``,
        priority: 4,
        skills: '["fleet-health", "fleet-dashboard"]',
      });
      if (created !== null) {
        log(`idle alert created for ${m.agent}`);
        alertCount++;
      }
    }

    // Alert: spend threshold exceeded
    if (m.costToday >= threshold) {
      const source = `${ALERT_SOURCE_PREFIX}:${m.agent}:spend`;
      const subject = `Fleet spend alert: ${m.agent} — $${m.costToday.toFixed(2)} today (threshold $${threshold})`;
      const created = insertTaskIfNew(source, {
        subject,
        description: `Agent **${m.agent}** has spent $${m.costToday.toFixed(2)} today, exceeding the $${threshold} alert threshold.\n\nConsider reviewing task priorities and sensor cadences to reduce unnecessary dispatches.`,
        priority: 3,
        skills: '["fleet-dashboard"]',
      });
      if (created !== null) {
        log(
          `spend alert created for ${m.agent}: $${m.costToday.toFixed(2)} today`,
        );
        alertCount++;
      }
    }
  }

  const reachable = allMetrics.filter((m) => m.reachable).length;
  log(
    `dashboard written: ${reachable}/${allMetrics.length} reachable, ${alertCount} new alerts`,
  );

  return "ok";
}
