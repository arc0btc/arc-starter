/**
 * fleet-comms sensor
 *
 * Detects agents that have gone silent — no dispatch cycle and no
 * fleet-status.json update for >1 hour. Creates P2 alert tasks.
 *
 * Runs every 30 minutes. Complements fleet-health (15min, service checks)
 * with a focused silence detection at a higher threshold.
 */

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

const SENSOR_NAME = "fleet-comms";
const INTERVAL_MINUTES = 30;
const SILENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const log = createSensorLogger(SENSOR_NAME);

interface SilenceCheck {
  agent: string;
  reachable: boolean;
  lastDispatchMs: number | null; // ms since last dispatch completion
  lastSelfReportMs: number | null; // ms since fleet-status.json updated_at
  silent: boolean;
}

async function checkAgentSilence(
  agent: string,
  password: string,
): Promise<SilenceCheck> {
  const result: SilenceCheck = {
    agent,
    reachable: false,
    lastDispatchMs: null,
    lastSelfReportMs: null,
    silent: false,
  };

  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return result; // no IP configured — skip
  }

  // Quick connectivity check
  const ping = await ssh(ip, password, "echo ok");
  if (!ping.ok) return result; // unreachable — fleet-health handles this
  result.reachable = true;

  const now = Date.now();

  // Check last dispatch cycle age
  const cycleResult = await ssh(
    ip,
    password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1').get();
      if (row && row.completed_at) console.log(new Date(row.completed_at).getTime());
      else console.log('none');
      db.close();
    " 2>/dev/null || echo "error"`,
  );

  const cycleTs = cycleResult.stdout.trim();
  if (cycleTs !== "none" && cycleTs !== "error") {
    const timestamp = parseInt(cycleTs);
    if (!isNaN(timestamp)) {
      result.lastDispatchMs = now - timestamp;
    }
  }

  // Check fleet-status.json self-report age
  const statusResult = await ssh(
    ip,
    password,
    `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null`,
  );

  if (statusResult.ok && statusResult.stdout.trim()) {
    try {
      const parsed = JSON.parse(statusResult.stdout);
      if (parsed.updated_at) {
        result.lastSelfReportMs = now - new Date(parsed.updated_at).getTime();
      }
    } catch {
      // parse failure — treat as no self-report
    }
  }

  // Silent = both signals are stale (or missing)
  const dispatchStale =
    result.lastDispatchMs === null ||
    result.lastDispatchMs > SILENT_THRESHOLD_MS;
  const reportStale =
    result.lastSelfReportMs === null ||
    result.lastSelfReportMs > SILENT_THRESHOLD_MS;

  result.silent = dispatchStale && reportStale;

  return result;
}

function formatAge(ms: number | null): string {
  if (ms === null) return "unknown";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export default async function fleetCommsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    return "skip";
  }

  log("checking fleet communication silence...");

  const results = await Promise.allSettled(
    Object.keys(AGENTS).map((agent) => checkAgentSilence(agent, password)),
  );

  let silentCount = 0;
  let alertCount = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const agent = Object.keys(AGENTS)[i];

    if (r.status !== "fulfilled") {
      log(`${agent}: check failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      continue;
    }

    const check = r.value;

    if (!check.reachable) {
      log(`${agent}: unreachable (fleet-health handles this)`);
      continue;
    }

    if (!check.silent) {
      log(`${agent}: active (dispatch: ${formatAge(check.lastDispatchMs)}, report: ${formatAge(check.lastSelfReportMs)})`);
      continue;
    }

    silentCount++;
    log(`${agent}: SILENT (dispatch: ${formatAge(check.lastDispatchMs)}, report: ${formatAge(check.lastSelfReportMs)})`);

    const source = `sensor:fleet-comms:${agent}`;
    const created = insertTaskIfNew(source, {
      subject: `Fleet silent: ${agent} has not dispatched or reported in >1h`,
      description: [
        `Agent **${agent}** appears silent.`,
        "",
        `- Last dispatch: ${formatAge(check.lastDispatchMs)} ago`,
        `- Last self-report: ${formatAge(check.lastSelfReportMs)} ago`,
        `- Threshold: 1 hour`,
        "",
        "Investigate: SSH into the VM, check services, review logs.",
        "Run: `arc skills run --name fleet-health -- status` for full health check.",
      ].join("\n"),
      priority: 2,
      skills: '["fleet-health", "arc-remote-setup"]',
    });

    if (created !== null) {
      alertCount++;
    }
  }

  const reachable = results.filter(
    (r) => r.status === "fulfilled" && r.value.reachable,
  ).length;
  log(
    `done: ${reachable} reachable, ${silentCount} silent, ${alertCount} new alerts`,
  );

  return "ok";
}
