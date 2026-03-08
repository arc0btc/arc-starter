/**
 * fleet-health sensor
 *
 * Every 15 minutes, SSH into each fleet VM and check:
 * - sensor timer active
 * - dispatch timer active
 * - last dispatch cycle age
 * - disk usage
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
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "fleet-health";
const INTERVAL_MINUTES = 15;
const ALERT_SOURCE_PREFIX = "sensor:fleet-health";

const log = createSensorLogger(SENSOR_NAME);

// ---- Fleet config (mirrors arc-remote-setup) ----

interface AgentConfig {
  ip: string;
  hostname: string;
}

const AGENTS: Record<string, AgentConfig> = {
  spark: { ip: "192.168.1.12", hostname: "spark" },
  iris: { ip: "192.168.1.13", hostname: "iris" },
  loom: { ip: "192.168.1.14", hostname: "loom" },
  forge: { ip: "192.168.1.15", hostname: "forge" },
};

const SSH_USER = "dev";
const REMOTE_ARC_DIR = "/home/dev/arc-starter";
const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

// ---- SSH helper ----

interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  return AGENTS[agent].ip;
}

async function ssh(ip: string, password: string, command: string): Promise<SshResult> {
  const proc = Bun.spawn(
    [
      "sshpass", "-e", "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      "-o", "BatchMode=no",
      `${SSH_USER}@${ip}`,
      command,
    ],
    {
      env: { ...process.env, SSHPASS: password },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr, exitCode };
}

// ---- Health check logic ----

interface AgentHealth {
  agent: string;
  reachable: boolean;
  sensorTimer: string;
  dispatchTimer: string;
  lastDispatchAge: string;
  diskUsage: string;
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

  // Flag if last dispatch was >60 minutes ago
  const ageMatch = health.lastDispatchAge.match(/^(\d+)m ago$/);
  if (ageMatch && parseInt(ageMatch[1]) > 60) {
    health.issues.push(`last dispatch ${health.lastDispatchAge}`);
  } else if (health.lastDispatchAge === "no cycles" || health.lastDispatchAge === "query failed") {
    health.issues.push(`dispatch: ${health.lastDispatchAge}`);
  }

  // Disk usage
  const diskResult = await ssh(ip, password, "df -h / | awk 'NR==2 {print $5}'");
  health.diskUsage = diskResult.stdout.trim() || "unknown";

  // Flag if disk >85%
  const diskPct = parseInt(health.diskUsage);
  if (!isNaN(diskPct) && diskPct > 85) {
    health.issues.push(`disk ${health.diskUsage}`);
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

  lines.push("");
  return lines.join("\n");
}

// ---- Sensor entry point ----

export default async function fleetHealthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Get SSH password
  const password = await getCredential("vm-fleet", "ssh-password");
  if (!password) {
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
      issues: [`check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`],
    };
  });

  // Write summary to memory/fleet-status.md
  const summary = formatSummary(healths, timestamp);
  await Bun.write(join(MEMORY_DIR, "fleet-status.md"), summary);

  // Create alert tasks for agents with issues
  let alertCount = 0;
  for (const h of healths) {
    if (h.issues.length === 0) continue;

    const source = `${ALERT_SOURCE_PREFIX}:${h.agent}`;
    const subject = h.reachable
      ? `Fleet alert: ${h.agent} service issues — ${h.issues.join(", ")}`
      : `Fleet alert: ${h.agent} unreachable`;

    const created = insertTaskIfNew(source, {
      subject,
      description: `Agent ${h.agent} health check failed.\n\nIssues:\n${h.issues.map((i) => `- ${i}`).join("\n")}\n\nFull status at memory/fleet-status.md`,
      priority: 3,
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
