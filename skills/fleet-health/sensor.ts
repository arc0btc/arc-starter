/**
 * fleet-health sensor
 *
 * Every 15 minutes, SSH into each fleet VM and check:
 * - sensor timer active
 * - dispatch timer active
 * - last dispatch cycle age (stall if >30min)
 * - disk usage (>80%)
 * - error rate (>50% failed tasks in last hour)
 *
 * Creates alert tasks for unreachable VMs or dead services.
 * Writes summary to memory/fleet-status.md.
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-health";
const INTERVAL_MINUTES = 15;
const ALERT_SOURCE_PREFIX = "sensor:fleet-health";

const log = createSensorLogger(SENSOR_NAME);

const CONSECUTIVE_FAILURE_THRESHOLD = 5;

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

// ---- Health check logic ----

interface PeerStatus {
  agent: string;
  updated_at: string;
  last_task: {
    id: number;
    subject: string;
    status: string;
    priority: number;
  };
  last_cycle: {
    duration_ms: number;
    cost_usd: number;
  };
  health: {
    uptime_seconds: number;
    disk_total_bytes: number;
    disk_avail_bytes: number;
  };
}

interface AgentHealth {
  agent: string;
  reachable: boolean;
  sensorTimer: string;
  dispatchTimer: string;
  lastDispatchAge: string;
  diskUsage: string;
  peerStatus: PeerStatus | null;
  peerStatusStale: boolean;
  consecutiveFailureStreak: boolean;
  issues: string[];
}

async function checkAgent(
  agent: string,
  password: string,
): Promise<AgentHealth> {
  const health: AgentHealth = {
    agent,
    reachable: false,
    sensorTimer: "unknown",
    dispatchTimer: "unknown",
    lastDispatchAge: "unknown",
    diskUsage: "unknown",
    peerStatus: null,
    peerStatusStale: false,
    consecutiveFailureStreak: false,
    issues: [],
  };

  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    health.issues.push("No IP configured");
    return health;
  }

  // Connectivity check
  const ping = await ssh(ip, password, "echo ok");
  if (!ping.ok) {
    health.issues.push("SSH unreachable");
    return health;
  }
  health.reachable = true;

  // Service timers
  const sensorResult = await ssh(
    ip, password,
    "systemctl --user is-active arc-sensors.timer 2>/dev/null || echo inactive"
  );
  health.sensorTimer = sensorResult.stdout.trim() || "unknown";
  if (health.sensorTimer !== "active") {
    health.issues.push(`sensor timer ${health.sensorTimer}`);
  }

  const dispatchResult = await ssh(
    ip, password,
    "systemctl --user is-active arc-dispatch.timer 2>/dev/null || echo inactive"
  );
  health.dispatchTimer = dispatchResult.stdout.trim() || "unknown";
  if (health.dispatchTimer !== "active") {
    health.issues.push(`dispatch timer ${health.dispatchTimer}`);
  }

  // Last dispatch cycle age
  const cycleResult = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1').get();
      if (row && row.completed_at) {
        const age = Date.now() - new Date(row.completed_at).getTime();
        const mins = Math.round(age / 60000);
        console.log(mins + 'm ago');
      } else {
        console.log('no cycles');
      }
      db.close();
    " 2>/dev/null || echo "query failed"`
  );
  health.lastDispatchAge = cycleResult.stdout.trim() || "unknown";

  // Flag if last dispatch was >30 minutes ago (dispatch stall detection)
  const ageMatch = health.lastDispatchAge.match(/^(\d+)m ago$/);
  if (ageMatch && parseInt(ageMatch[1]) > 30) {
    health.issues.push(`dispatch stall: last cycle ${health.lastDispatchAge}`);
  } else if (health.lastDispatchAge === "no cycles" || health.lastDispatchAge === "query failed") {
    health.issues.push(`dispatch: ${health.lastDispatchAge}`);
  }

  // Disk usage
  const diskResult = await ssh(ip, password, "df -h / | awk 'NR==2 {print $5}'");
  health.diskUsage = diskResult.stdout.trim() || "unknown";

  // Flag if disk >80%
  const diskPct = parseInt(health.diskUsage);
  if (!isNaN(diskPct) && diskPct > 80) {
    health.issues.push(`disk ${health.diskUsage}`);
  }

  // High error rate: >50% failed tasks in last hour
  const errorRateResult = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const since = new Date(Date.now() - 3600000).toISOString();
      const total = db.query('SELECT COUNT(*) as c FROM tasks WHERE completed_at >= ?').get(since);
      const failed = db.query('SELECT COUNT(*) as c FROM tasks WHERE completed_at >= ? AND status = \\\\'failed\\\\'').get(since);
      const t = total?.c ?? 0;
      const f = failed?.c ?? 0;
      console.log(t + ',' + f);
      db.close();
    " 2>/dev/null || echo "0,0"`
  );
  const rateParts = errorRateResult.stdout.trim().split(",");
  const totalTasks = parseInt(rateParts[0]) || 0;
  const failedTasks = parseInt(rateParts[1]) || 0;
  if (totalTasks >= 4 && failedTasks / totalTasks > 0.5) {
    health.issues.push(`high error rate: ${failedTasks}/${totalTasks} failed in last hour`);
  }

  // Consecutive failure streak: last N tasks all failed → circuit breaker
  const streakResult = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const rows = db.query(
        'SELECT status FROM tasks WHERE status IN (\\\\'completed\\\\', \\\\'failed\\\\') ORDER BY completed_at DESC LIMIT ${CONSECUTIVE_FAILURE_THRESHOLD}'
      ).all();
      const allFailed = rows.length >= ${CONSECUTIVE_FAILURE_THRESHOLD} && rows.every(r => r.status === 'failed');
      console.log(allFailed ? 'streak' : 'ok');
      db.close();
    " 2>/dev/null || echo "ok"`
  );
  if (streakResult.stdout.trim() === "streak") {
    health.issues.push(`circuit breaker: ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive task failures`);
    health.consecutiveFailureStreak = true;
  }

  // Read peer's fleet-status.json for self-reported state
  const statusResult = await ssh(
    ip, password,
    `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null`
  );
  if (statusResult.ok && statusResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(statusResult.stdout) as PeerStatus;
      health.peerStatus = parsed;

      // Check staleness: >30min since updated_at
      if (parsed.updated_at) {
        const ageMs = Date.now() - new Date(parsed.updated_at).getTime();
        const STALE_THRESHOLD_MS = 30 * 60 * 1000;
        if (ageMs > STALE_THRESHOLD_MS) {
          health.peerStatusStale = true;
          const staleMins = Math.round(ageMs / 60000);
          health.issues.push(`fleet-status.json stale (${staleMins}m old)`);
        }
      }
    } catch {
      // JSON parse failed — not critical
    }
  }

  return health;
}

// ---- Summary generation ----

function formatSummary(results: AgentHealth[], timestamp: string): string {
  const lines: string[] = [
    "# Fleet Status",
    "",
    `*Last checked: ${timestamp}*`,
    "",
    "| Agent | Reachable | Sensors | Dispatch | Last Cycle | Disk | Issues |",
    "|-------|-----------|---------|----------|------------|------|--------|",
  ];

  for (const h of results) {
    const reachable = h.reachable ? "yes" : "**NO**";
    const sensors = h.sensorTimer === "active" ? "ok" : `**${h.sensorTimer}**`;
    const dispatch = h.dispatchTimer === "active" ? "ok" : `**${h.dispatchTimer}**`;
    const issues = h.issues.length > 0 ? h.issues.join("; ") : "none";
    lines.push(
      `| ${h.agent} | ${reachable} | ${sensors} | ${dispatch} | ${h.lastDispatchAge} | ${h.diskUsage} | ${issues} |`
    );
  }

  // Peer self-reported status section
  const peersWithStatus = results.filter((h) => h.peerStatus !== null);
  if (peersWithStatus.length > 0) {
    lines.push("");
    lines.push("## Peer Self-Reported Status");
    lines.push("");
    lines.push("| Agent | Last Task | Task Status | Cycle Cost | Updated | Stale |");
    lines.push("|-------|-----------|-------------|------------|---------|-------|");

    for (const h of peersWithStatus) {
      const ps = h.peerStatus!;
      const taskInfo = ps.last_task
        ? `#${ps.last_task.id}: ${ps.last_task.subject.slice(0, 40)}`
        : "—";
      const taskStatus = ps.last_task?.status ?? "—";
      const cycleCost = ps.last_cycle
        ? `$${ps.last_cycle.cost_usd.toFixed(3)}`
        : "—";
      const updated = ps.updated_at
        ? ps.updated_at.replace("T", " ").slice(0, 19) + "Z"
        : "—";
      const stale = h.peerStatusStale ? "**YES**" : "no";
      lines.push(`| ${h.agent} | ${taskInfo} | ${taskStatus} | ${cycleCost} | ${updated} | ${stale} |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---- Sensor entry point ----

export default async function fleetHealthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Get SSH password
  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    return "skip";
  }

  const timestamp = new Date().toISOString();
  log("checking fleet health...");

  // Check all agents in parallel
  const results = await Promise.allSettled(
    Object.keys(AGENTS).map((agent) => checkAgent(agent, password))
  );

  const healths: AgentHealth[] = results.map((r, i) => {
    const agent = Object.keys(AGENTS)[i];
    if (r.status === "fulfilled") return r.value;
    return {
      agent,
      reachable: false,
      sensorTimer: "unknown",
      dispatchTimer: "unknown",
      lastDispatchAge: "unknown",
      diskUsage: "unknown",
      consecutiveFailureStreak: false,
      issues: [`check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`],
    } as AgentHealth;
  });

  // Write summary to memory/fleet-status.md
  const summary = formatSummary(healths, timestamp);
  await Bun.write(join(MEMORY_DIR, "fleet-status.md"), summary);

  // Circuit breaker: pause agents with consecutive failure streaks
  for (const h of healths) {
    if (!h.consecutiveFailureStreak || !h.reachable) continue;

    log(`circuit breaker triggered for ${h.agent} — stopping dispatch timer`);
    await ssh(await getAgentIp(h.agent), password, "systemctl --user stop arc-dispatch.timer 2>/dev/null");
  }

  // Create alert tasks for agents with issues
  let alertCount = 0;
  for (const h of healths) {
    if (h.issues.length === 0) continue;

    const source = `${ALERT_SOURCE_PREFIX}:${h.agent}`;

    // Circuit breaker alerts get P2 (escalation) instead of P3
    const isCircuitBreaker = h.consecutiveFailureStreak;
    const subject = isCircuitBreaker
      ? `Fleet circuit breaker: ${h.agent} — ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive task failures, dispatch paused`
      : h.reachable
        ? `Fleet alert: ${h.agent} service issues — ${h.issues.join(", ")}`
        : `Fleet alert: ${h.agent} unreachable`;

    const created = insertTaskIfNew(source, {
      subject,
      description: `Agent ${h.agent} health check failed.\n\nIssues:\n${h.issues.map((i) => `- ${i}`).join("\n")}${isCircuitBreaker ? "\n\n**Dispatch timer has been stopped.** Investigate the failure pattern, fix the root cause, then restart:\n```\narc skills run --name arc-remote-setup -- ssh ${h.agent} systemctl --user start arc-dispatch.timer\n```" : ""}\n\nFull status at memory/fleet-status.md`,
      priority: isCircuitBreaker ? 2 : 3,
      skills: '["fleet-health", "arc-remote-setup"]',
    });

    if (created !== null) {
      log(`alert created for ${h.agent}: ${h.issues.join(", ")}`);
      alertCount++;
    }
  }

  const healthy = healths.filter((h) => h.issues.length === 0).length;
  log(`fleet check complete: ${healthy}/${healths.length} healthy, ${alertCount} new alerts`);

  return "ok";
}
