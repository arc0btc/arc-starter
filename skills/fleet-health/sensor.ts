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
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
  isFleetSuspended,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-health";
const INTERVAL_MINUTES = 15;
const ALERT_SOURCE_PREFIX = "sensor:fleet-health";
const MAX_ALERTS_PER_AGENT_PER_DAY = 3;

const log = createSensorLogger(SENSOR_NAME);

const CONSECUTIVE_FAILURE_THRESHOLD = 5;

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const MAINTENANCE_FILE = new URL("../../db/fleet-maintenance.json", import.meta.url).pathname;

// ---- Maintenance mode ----

interface MaintenanceConfig {
  enabled: boolean;
  reason?: string;
  since?: string;
  suppress_agents?: string[]; // empty = all agents suppressed
}

async function isMaintenanceMode(): Promise<{ active: boolean; config: MaintenanceConfig | null }> {
  try {
    const file = Bun.file(MAINTENANCE_FILE);
    if (!await file.exists()) return { active: false, config: null };
    const config = await file.json() as MaintenanceConfig;
    if (config.enabled) {
      return { active: true, config };
    }
    return { active: false, config };
  } catch {
    return { active: false, config: null };
  }
}

function isAgentSuppressed(agent: string, config: MaintenanceConfig | null): boolean {
  if (!config?.enabled) return false;
  // If suppress_agents is empty or missing, all agents are suppressed
  if (!config.suppress_agents || config.suppress_agents.length === 0) return true;
  return config.suppress_agents.includes(agent);
}

// ---- Daily alert cap ----

interface AlertState {
  [agentDate: string]: number; // "spark:2026-03-10" → count
}

async function getAlertCount(agent: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${agent}:${today}`;
  try {
    const file = Bun.file(new URL("../../db/hook-state/fleet-health-alerts.json", import.meta.url).pathname);
    if (!await file.exists()) return 0;
    const state = await file.json() as AlertState;
    return state[key] ?? 0;
  } catch {
    return 0;
  }
}

async function incrementAlertCount(agent: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${agent}:${today}`;
  const filePath = new URL("../../db/hook-state/fleet-health-alerts.json", import.meta.url).pathname;
  let state: AlertState = {};
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      state = await file.json() as AlertState;
    }
  } catch { /* start fresh */ }

  // Prune old entries (keep only today)
  for (const k of Object.keys(state)) {
    if (!k.endsWith(today)) delete state[k];
  }
  state[key] = (state[key] ?? 0) + 1;
  await Bun.write(filePath, JSON.stringify(state, null, 2));
}

// ---- Health check logic ----

interface PeerStatus {
  agent: string;
  updated_at: string;
  idle: boolean;
  idle_since: string | null;
  last_task: {
    id: number;
    subject: string;
    status: string;
    priority: number;
  } | null;
  last_cycle: {
    duration_ms: number;
    cost_usd: number;
  } | null;
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
  pendingCount: number;
  peerStatus: PeerStatus | null;
  peerStatusStale: boolean;
  consecutiveFailureStreak: boolean;
  authMethod: string; // "api-key", "oauth:<hours>h", "oauth:EXPIRED", "none"
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
    pendingCount: 0,
    peerStatus: null,
    peerStatusStale: false,
    consecutiveFailureStreak: false,
    authMethod: "unknown",
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

  // Pending task count — used to distinguish idle (empty queue) from stalled
  const pendingResult = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'pending\\\\'').get();
      console.log(row?.c ?? 0);
      db.close();
    " 2>/dev/null || echo "0"`
  );
  health.pendingCount = parseInt(pendingResult.stdout.trim()) || 0;

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

  // Read peer's fleet-status.json for self-reported state (before dispatch age check — used as fallback)
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
          // Only alert if queue has work — empty queue means agent is legitimately idle
          if (health.pendingCount > 0) {
            health.issues.push(`fleet-status.json stale (${staleMins}m old)`);
          }
        }
      }
    } catch {
      // JSON parse failed — not critical
    }
  }

  // Last dispatch cycle age — query cycle_log; distinguish no-rows, active cycle, and completed cycle
  const cycleResult = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT completed_at, started_at FROM cycle_log ORDER BY id DESC LIMIT 1').get();
      if (!row) {
        console.log('no cycles');
      } else if (!row.completed_at) {
        const age = Date.now() - new Date(row.started_at).getTime();
        const mins = Math.round(age / 60000);
        console.log('active ' + mins + 'm');
      } else {
        const age = Date.now() - new Date(row.completed_at).getTime();
        const mins = Math.round(age / 60000);
        console.log(mins + 'm ago');
      }
      db.close();
    " 2>/dev/null || echo "query failed"`
  );
  health.lastDispatchAge = cycleResult.stdout.trim() || "unknown";

  // If DB query returned no cycles or failed, cross-check peer status before alerting
  if (health.lastDispatchAge === "no cycles" || health.lastDispatchAge === "query failed") {
    const ps = health.peerStatus;
    if (ps && !health.peerStatusStale) {
      // Peer status is fresh — derive dispatch state from idle flag and updated_at
      if (ps.idle === false) {
        // Dispatch is actively running a task — DB query likely caught mid-cycle
        health.lastDispatchAge = "active (self-reported)";
      } else {
        // Dispatch is idle but alive — use updated_at as dispatch age proxy
        const peerAgeMs = Date.now() - new Date(ps.updated_at).getTime();
        const peerAgeMins = Math.round(peerAgeMs / 60000);
        health.lastDispatchAge = `${peerAgeMins}m ago (self-reported)`;
      }
    } else if (ps?.updated_at) {
      // Peer status exists but is stale — still use updated_at as fallback, mark stale
      const peerAgeMs = Date.now() - new Date(ps.updated_at).getTime();
      const peerAgeMins = Math.round(peerAgeMs / 60000);
      health.lastDispatchAge = `${peerAgeMins}m ago (self-reported, stale)`;
    }
    // If no peer status at all: lastDispatchAge stays as "no cycles" or "query failed"
  }

  // Flag dispatch issues
  const activeMatch = health.lastDispatchAge.match(/^active (\d+)m/);
  const ageMatch = health.lastDispatchAge.match(/^(\d+)m ago/);
  if (health.lastDispatchAge === "active (self-reported)") {
    // Dispatch is in progress per peer — not stalled, no alert
  } else if (activeMatch) {
    // Active cycle detected via DB — alert only if running >60min (runaway)
    const activeMins = parseInt(activeMatch[1]);
    if (activeMins > 60) {
      health.issues.push(`dispatch runaway: active for ${activeMins}m (>60m threshold)`);
    }
  } else if (ageMatch && parseInt(ageMatch[1]) > 30) {
    if (health.pendingCount > 0) {
      health.issues.push(`dispatch stall: last cycle ${health.lastDispatchAge}`);
    }
    // else: empty queue — agent is idle, not stalled
  } else if (health.lastDispatchAge === "no cycles" || health.lastDispatchAge === "query failed") {
    // Only alert if dispatch timer is inactive — if timer is running, agent is healthy but idle
    if (health.dispatchTimer !== "active") {
      health.issues.push(`dispatch: ${health.lastDispatchAge}`);
    }
  }

  // Disk usage
  const diskResult = await ssh(ip, password, "df -h / | awk 'NR==2 {print $5}'");
  health.diskUsage = diskResult.stdout.trim() || "unknown";

  // Flag if disk >80%
  const diskPct = parseInt(health.diskUsage);
  if (!isNaN(diskPct) && diskPct > 80) {
    health.issues.push(`disk ${health.diskUsage}`);
  }

  // Auth method check: prefer API key in .env, fall back to OAuth token
  const apiKeyResult = await ssh(
    ip, password,
    `grep -q '^ANTHROPIC_API_KEY=' ${REMOTE_ARC_DIR}/.env 2>/dev/null && echo "present" || echo "absent"`
  );
  if (apiKeyResult.stdout.trim() === "present") {
    health.authMethod = "api-key";
  } else {
    // Fall back to OAuth check for VMs not yet migrated
    const oauthResult = await ssh(
      ip, password,
      `cat ~/.claude/.credentials.json 2>/dev/null || echo "{}"`
    );
    try {
      const creds = JSON.parse(oauthResult.stdout);
      const expiresAt = creds?.claudeAiOauth?.expiresAt;
      const hasRefreshToken = Boolean(creds?.claudeAiOauth?.refreshToken);
      if (typeof expiresAt === "number") {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0 && !hasRefreshToken) {
          health.authMethod = "oauth:EXPIRED";
          health.issues.push("OAuth token expired with no refresh token — re-auth required");
        } else if (remaining <= 0) {
          // Expired but has refresh token — Claude Code will auto-refresh
          health.authMethod = "oauth:auto-refresh";
        } else {
          const hoursLeft = Math.round(remaining / 3600000);
          health.authMethod = hasRefreshToken ? `oauth:ok` : `oauth:${hoursLeft}h`;
          // Only alert if no refresh token and expiry is soon
          if (!hasRefreshToken && remaining <= 12 * 60 * 60 * 1000) {
            health.issues.push(`OAuth expires in ${hoursLeft}h — no refresh token, re-auth needed`);
          }
        }
      } else if (creds?.claudeAiOauth?.accessToken) {
        health.authMethod = "oauth:no-expiry";
      } else {
        health.authMethod = "none";
        health.issues.push("No auth configured — set ANTHROPIC_API_KEY in .env");
      }
    } catch {
      health.authMethod = "none";
      health.issues.push("No auth configured — set ANTHROPIC_API_KEY in .env");
    }
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

  return health;
}

// ---- Summary generation ----

function formatSummary(results: AgentHealth[], timestamp: string): string {
  const lines: string[] = [
    "# Fleet Status",
    "",
    `*Last checked: ${timestamp}*`,
    "",
    "| Agent | Reachable | Sensors | Dispatch | Last Cycle | Disk | Auth | Issues |",
    "|-------|-----------|---------|----------|------------|------|------|--------|",
  ];

  for (const h of results) {
    const reachable = h.reachable ? "yes" : "**NO**";
    const sensors = h.sensorTimer === "active" ? "ok" : `**${h.sensorTimer}**`;
    const dispatch = h.dispatchTimer === "active" ? "ok" : `**${h.dispatchTimer}**`;
    const issues = h.issues.length > 0 ? h.issues.join("; ") : "none";
    // Show "idle (queue empty)" when the agent has no pending tasks and last cycle was long ago
    const ageMatch = h.lastDispatchAge.match(/^(\d+)m ago/);
    const lastCycle =
      h.reachable && h.pendingCount === 0 && ageMatch && parseInt(ageMatch[1]) > 30
        ? `idle (${h.lastDispatchAge})`
        : h.lastDispatchAge;
    const auth = h.authMethod === "api-key" ? "api-key" :
      h.authMethod === "none" ? "**NONE**" :
      h.authMethod.startsWith("oauth:EXPIRED") ? "**EXPIRED**" :
      h.authMethod;
    lines.push(
      `| ${h.agent} | ${reachable} | ${sensors} | ${dispatch} | ${lastCycle} | ${h.diskUsage} | ${auth} | ${issues} |`
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
  if (isFleetSuspended()) return "skip";

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

  // Check all agents in parallel (suspended agents excluded)
  const agentNames = getActiveAgentNames();
  const results = await Promise.allSettled(
    agentNames.map((agent) => checkAgent(agent, password))
  );

  const healths: AgentHealth[] = results.map((r, i) => {
    const agent = agentNames[i];
    if (r.status === "fulfilled") return r.value;
    return {
      agent,
      reachable: false,
      sensorTimer: "unknown",
      dispatchTimer: "unknown",
      lastDispatchAge: "unknown",
      diskUsage: "unknown",
      pendingCount: 0,
      peerStatus: null,
      peerStatusStale: false,
      consecutiveFailureStreak: false,
      authMethod: "unknown",
      issues: [`check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`],
    } satisfies AgentHealth;
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

  // Check maintenance mode
  const { active: maintenanceActive, config: maintenanceConfig } = await isMaintenanceMode();
  if (maintenanceActive) {
    log(`maintenance mode active: ${maintenanceConfig?.reason ?? "no reason"} — suppressing alerts`);
  }

  // Create alert tasks for agents with issues
  let alertCount = 0;
  for (const h of healths) {
    if (h.issues.length === 0) continue;

    // Skip alert creation if agent is in maintenance mode
    if (maintenanceActive && isAgentSuppressed(h.agent, maintenanceConfig)) {
      log(`suppressed alert for ${h.agent} (maintenance mode): ${h.issues.join(", ")}`);
      continue;
    }

    // Skip if daily alert cap reached for this agent
    const todayCount = await getAlertCount(h.agent);
    if (todayCount >= MAX_ALERTS_PER_AGENT_PER_DAY) {
      log(`suppressed alert for ${h.agent} (daily cap ${MAX_ALERTS_PER_AGENT_PER_DAY} reached): ${h.issues.join(", ")}`);
      continue;
    }

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
      model: "sonnet",
      skills: '["fleet-health", "arc-remote-setup"]',
    });

    if (created !== null) {
      await incrementAlertCount(h.agent);
      log(`alert created for ${h.agent}: ${h.issues.join(", ")}`);
      alertCount++;
    }
  }

  const healthy = healths.filter((h) => h.issues.length === 0).length;
  log(`fleet check complete: ${healthy}/${healths.length} healthy, ${alertCount} new alerts`);

  return "ok";
}
