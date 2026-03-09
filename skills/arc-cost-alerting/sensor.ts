// cost-alerting/sensor.ts
//
// Monitors daily spend across the full fleet every 10 minutes.
// Tracks multi-provider costs: Claude Code + OpenAI Codex (o3, o4-mini, gpt-4.1, gpt-5.4).
// Creates a priority-3 alert task when daily total exceeds the threshold.
// One alert per day max (date-stamped source key).

import { claimSensorRun, createSensorLogger, pendingTaskExistsForSource, insertTask } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "arc-cost-alerting";
const INTERVAL_MINUTES = 10;
const DAILY_THRESHOLD_USD = 150.0; // warn at $150 of $200/day cap
const DAILY_CAP_USD = 200.0;

const log = createSensorLogger(SENSOR_NAME);

// ---- Fleet config (mirrors fleet-health sensor) ----

const FLEET_AGENTS: Record<string, string> = {
  spark: "192.168.1.12",
  iris: "192.168.1.13",
  loom: "192.168.1.14",
  forge: "192.168.1.15",
};

const SSH_USER = "dev";
const REMOTE_ARC_DIR = "/home/dev/arc-starter";

// ---- Helpers ----

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

interface DailySpend {
  costUsd: number;
  apiCostUsd: number;
  codexCostUsd: number;
}

function getLocalDailySpend(): DailySpend {
  const db = getDatabase();
  // Claude Code tasks (model is null, opus, sonnet, haiku — anything not starting with "codex")
  const claude = db
    .query(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost
       FROM tasks WHERE date(created_at) = date('now')
       AND (model IS NULL OR model NOT LIKE 'codex%')`
    )
    .get() as { cost: number; api_cost: number };

  // Codex tasks (model starts with "codex")
  const codex = db
    .query(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost
       FROM tasks WHERE date(created_at) = date('now')
       AND model LIKE 'codex%'`
    )
    .get() as { cost: number; api_cost: number };

  return {
    costUsd: claude.cost + codex.cost,
    apiCostUsd: claude.api_cost + codex.api_cost,
    codexCostUsd: codex.cost,
  };
}

interface FleetAgentSpend {
  agent: string;
  costUsd: number;
  codexCostUsd: number;
  reachable: boolean;
}

async function getRemoteAgentSpend(
  agent: string,
  ip: string,
  password: string,
): Promise<FleetAgentSpend> {
  const result: FleetAgentSpend = { agent, costUsd: 0, codexCostUsd: 0, reachable: false };

  try {
    const ipOverride = await getCredential("vm-fleet", `${agent}-ip`);
    const actualIp = ipOverride || ip;

    const proc = Bun.spawn(
      [
        "sshpass", "-e", "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=no",
        `${SSH_USER}@${actualIp}`,
        `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
          const { Database } = require('bun:sqlite');
          const db = new Database('db/arc.sqlite', { readonly: true });
          const total = db.query(\"SELECT COALESCE(SUM(cost_usd), 0) as cost FROM tasks WHERE date(created_at) = date('now')\").get();
          const codex = db.query(\"SELECT COALESCE(SUM(cost_usd), 0) as cost FROM tasks WHERE date(created_at) = date('now') AND model LIKE 'codex%'\").get();
          console.log(JSON.stringify({ cost: total.cost, codex: codex.cost }));
          db.close();
        " 2>/dev/null`,
      ],
      {
        env: { ...process.env, SSHPASS: password },
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0 && stdout.trim()) {
      const parsed = JSON.parse(stdout.trim()) as { cost: number; codex: number };
      result.costUsd = parsed.cost;
      result.codexCostUsd = parsed.codex;
      result.reachable = true;
    }
  } catch {
    // SSH or parse failure — agent spend stays at 0, reachable stays false
  }

  return result;
}

export default async function costAlertingSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const today = todayDateString();
  const source = `sensor:arc-cost-alerting:${today}`;

  // Already alerted today?
  if (pendingTaskExistsForSource(source)) return "skip";

  // Local spend (Arc)
  const local = getLocalDailySpend();

  // Fleet spend (SSH into remote agents)
  const fleetSpends: FleetAgentSpend[] = [];
  const sshPassword = await getCredential("vm-fleet", "ssh-password");

  if (sshPassword) {
    const results = await Promise.allSettled(
      Object.entries(FLEET_AGENTS).map(([agent, ip]) =>
        getRemoteAgentSpend(agent, ip, sshPassword)
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") fleetSpends.push(r.value);
    }
  }

  // Sum fleet-wide totals
  const fleetCost = fleetSpends.reduce((sum, a) => sum + a.costUsd, 0);
  const fleetCodexCost = fleetSpends.reduce((sum, a) => sum + a.codexCostUsd, 0);
  const totalCost = local.costUsd + fleetCost;
  const totalCodexCost = local.codexCostUsd + fleetCodexCost;

  log(`daily spend: arc=$${local.costUsd.toFixed(2)} fleet=$${fleetCost.toFixed(2)} total=$${totalCost.toFixed(2)} (codex=$${totalCodexCost.toFixed(2)})`);

  if (totalCost < DAILY_THRESHOLD_USD) return "ok";

  // Build breakdown for alert description
  const breakdown: string[] = [];
  breakdown.push(`**Arc (local):** $${local.costUsd.toFixed(2)} (codex: $${local.codexCostUsd.toFixed(2)})`);
  for (const agent of fleetSpends) {
    const status = agent.reachable
      ? `$${agent.costUsd.toFixed(2)} (codex: $${agent.codexCostUsd.toFixed(2)})`
      : "unreachable";
    breakdown.push(`**${agent.agent}:** ${status}`);
  }

  const urgency = totalCost >= DAILY_CAP_USD ? "OVER CAP" : "approaching cap";

  insertTask({
    subject: `cost alert: fleet spend $${totalCost.toFixed(2)}/${DAILY_CAP_USD} — ${urgency}`,
    description:
      `Daily fleet spend has reached $${totalCost.toFixed(2)} (threshold: $${DAILY_THRESHOLD_USD.toFixed(2)}, cap: $${DAILY_CAP_USD.toFixed(2)}/day).\n\n` +
      `**Breakdown:**\n${breakdown.map((b) => `- ${b}`).join("\n")}\n\n` +
      `Total Codex (OpenAI) spend: $${totalCodexCost.toFixed(2)}\n\n` +
      `Review active tasks and consider deferring low-priority work. Run \`arc status\` for details.`,
    skills: '["arc-cost-alerting"]',
    priority: 3,
    model: "sonnet",
    source: source,
  });

  log(`alert created: total=$${totalCost.toFixed(2)}, codex=$${totalCodexCost.toFixed(2)}`);
  return "ok";
}
