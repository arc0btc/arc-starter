/**
 * fleet-log-pull sensor
 *
 * Every 30 minutes, SSH into each fleet VM and pull:
 * - Last 5 cycle_log entries
 * - Task completion stats (pending/active/completed/failed)
 *
 * Writes summary to memory/fleet-logs.md.
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "fleet-log-pull";
const INTERVAL_MINUTES = 30;

const log = createSensorLogger(SENSOR_NAME);
const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

// ---- Types ----

interface CycleEntry {
  task_id: number | null;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  subject: string | null;
  status: string | null;
}

interface TaskStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  cost24h: number;
}

interface AgentLogs {
  agent: string;
  reachable: boolean;
  cycles: CycleEntry[];
  stats: TaskStats | null;
}

// ---- Data fetching ----

async function pullAgentData(
  agent: string,
  password: string,
): Promise<AgentLogs> {
  const result: AgentLogs = {
    agent,
    reachable: false,
    cycles: [],
    stats: null,
  };

  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return result;
  }

  const ping = await ssh(ip, password, "echo ok");
  if (!ping.ok) return result;
  result.reachable = true;

  // Pull last 5 cycles + task stats in one SSH call
  const query = await ssh(
    ip,
    password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });

      const cycles = db.query(\\\`
        SELECT cl.task_id, cl.completed_at, cl.duration_ms, cl.cost_usd, t.subject, t.status
        FROM cycle_log cl LEFT JOIN tasks t ON t.id = cl.task_id
        ORDER BY cl.id DESC LIMIT 5
      \\\`).all();

      const counts = db.query(\\\`
        SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status
      \\\`).all();

      const cost24h = db.query(\\\`
        SELECT COALESCE(SUM(cost_usd), 0) as total
        FROM cycle_log WHERE started_at > datetime('now', '-24 hours')
      \\\`).get();

      console.log(JSON.stringify({ cycles, counts, cost24h: cost24h.total }));
      db.close();
    " 2>/dev/null`,
  );

  if (!query.ok || !query.stdout.trim()) return result;

  try {
    const data = JSON.parse(query.stdout) as {
      cycles: CycleEntry[];
      counts: Array<{ status: string; cnt: number }>;
      cost24h: number;
    };

    result.cycles = data.cycles;

    const get = (s: string): number =>
      data.counts.find((c) => c.status === s)?.cnt ?? 0;
    result.stats = {
      pending: get("pending"),
      active: get("active"),
      completed: get("completed"),
      failed: get("failed"),
      total: data.counts.reduce((sum, c) => sum + c.cnt, 0),
      cost24h: data.cost24h,
    };
  } catch {
    // parse failed — result stays empty
  }

  return result;
}

// ---- Summary formatting ----

function formatSummary(results: AgentLogs[], timestamp: string): string {
  const lines: string[] = [
    "# Fleet Logs",
    "",
    `*Last pulled: ${timestamp}*`,
    "",
    "## Task Stats",
    "",
    "| Agent | Pending | Active | Completed | Failed | Total | Cost 24h |",
    "|-------|---------|--------|-----------|--------|-------|----------|",
  ];

  for (const r of results) {
    if (!r.reachable || !r.stats) {
      lines.push(`| ${r.agent} | — | — | — | — | — | — |`);
      continue;
    }
    const s = r.stats;
    lines.push(
      `| ${r.agent} | ${s.pending} | ${s.active} | ${s.completed} | ${s.failed} | ${s.total} | $${s.cost24h.toFixed(2)} |`,
    );
  }

  lines.push("");
  lines.push("## Recent Cycles");

  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.agent}`);
    lines.push("");

    if (!r.reachable) {
      lines.push("*(unreachable)*");
      continue;
    }

    if (r.cycles.length === 0) {
      lines.push("*(no cycles)*");
      continue;
    }

    lines.push("| Task | Completed | Duration | Cost | Subject |");
    lines.push("|------|-----------|----------|------|---------|");

    for (const c of r.cycles) {
      const dur = c.duration_ms ? `${Math.round(c.duration_ms / 1000)}s` : "?";
      const cost = c.cost_usd != null ? `$${c.cost_usd.toFixed(3)}` : "$?";
      const subject = c.subject ? c.subject.slice(0, 40) : "(no task)";
      const completed = c.completed_at
        ? c.completed_at.replace("T", " ").slice(0, 19)
        : "in-progress";
      lines.push(
        `| #${c.task_id ?? "?"} | ${completed} | ${dur} | ${cost} | ${subject} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---- Sensor entry point ----

export default async function fleetLogPullSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    const alertSource = `sensor:${SENSOR_NAME}:no-creds`;
    if (!pendingTaskExistsForSource(alertSource)) {
      insertTask({ subject: "fleet-log-pull: SSH password not configured", priority: 8, source: alertSource });
    }
    return "skip";
  }

  const timestamp = new Date().toISOString();
  log("pulling fleet logs...");

  const results = await Promise.allSettled(
    Object.keys(AGENTS).map((agent) => pullAgentData(agent, password)),
  );

  const logs: AgentLogs[] = results.map((r, i) => {
    const agent = Object.keys(AGENTS)[i];
    if (r.status === "fulfilled") return r.value;
    return { agent, reachable: false, cycles: [], stats: null };
  });

  const summary = formatSummary(logs, timestamp);
  await Bun.write(join(MEMORY_DIR, "fleet-logs.md"), summary);

  const reachable = logs.filter((l) => l.reachable).length;
  log(`fleet logs pulled: ${reachable}/${logs.length} reachable`);

  return "ok";
}
