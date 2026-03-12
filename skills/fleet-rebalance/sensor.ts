/**
 * fleet-rebalance sensor
 *
 * Every 5 minutes, reads fleet-status.json from all agents via SSH.
 * Identifies idle agents (idle=true, ≥2min) and busy agents (pending>5).
 * Steals P5+ pending tasks from busy agents and creates them on idle agents.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import {
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
  isFleetSuspended,
} from "../../src/ssh.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "fleet-rebalance";
const INTERVAL_MINUTES = 5;

const log = createSensorLogger(SENSOR_NAME);

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const REBALANCE_LOG = join(MEMORY_DIR, "fleet-rebalance.log");

// ---- Config ----

const IDLE_MIN_MS = 2 * 60 * 1000; // 2 minutes minimum idle before eligible
const BUSY_THRESHOLD = 5; // agent must have >5 pending to be steal-eligible
const MAX_STEALS_PER_IDLE = 3;
const MAX_STEALS_PER_CYCLE = 10;
const MIN_STEALABLE_PRIORITY = 5; // only steal P5+

// Domain rules — mirrors fleet-router for compatibility checking
interface DomainRule {
  agent: string;
  patterns: string[];
}

const DOMAIN_RULES: DomainRule[] = [
  { agent: "spark", patterns: ["stacks-js", "bitcoin-", "ordinals-", "x-", "aibtc-", "multisig", "sip-", "bip-"] },
  { agent: "iris", patterns: ["arc-research-", "blog-publishing", "arc-email-", "arc-newsletter", "arc-digest"] },
  { agent: "loom", patterns: ["zest-", "bitflow-", "mcp-"] },
  { agent: "forge", patterns: ["arc0btc-site-", "blog-deploy", "arc0me-"] },
];

const GITHUB_PATTERNS = ["github", "pr-review", "arc-starter-publish"];

// ---- Types ----

interface FleetStatus {
  agent: string;
  updated_at: string;
  idle: boolean;
  idle_since: string | null;
  last_task: { id: number; subject: string; status: string; priority: number } | null;
  last_cycle: { duration_ms: number; cost_usd: number } | null;
}

interface RemoteTask {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;
  priority: number;
  source: string | null;
  model: string | null;
}

interface StealAction {
  from_agent: string;
  to_agent: string;
  task_id: number;
  subject: string;
  priority: number;
}

// ---- Domain matching ----

function getTaskSkills(task: RemoteTask): string[] {
  if (!task.skills) return [];
  try {
    const parsed = JSON.parse(task.skills);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function agentCanHandle(agent: string, task: RemoteTask): boolean {
  const skills = getTaskSkills(task);

  // P8+ with no skills → anyone can handle
  if (task.priority >= 8 && skills.length === 0) return true;

  // No skills tag → only the original domain owner should handle
  if (skills.length === 0) return false;

  // Spark can't do GitHub-dependent work
  if (agent === "spark") {
    for (const skill of skills) {
      if (GITHUB_PATTERNS.some((p) => skill.startsWith(p))) return false;
    }
  }

  // Check if agent's domain matches any skill
  const agentRules = DOMAIN_RULES.find((r) => r.agent === agent);
  if (!agentRules) return false; // unknown agent

  for (const skill of skills) {
    for (const pattern of agentRules.patterns) {
      if (skill.startsWith(pattern) || skill === pattern) return true;
    }
  }

  // Cross-domain: P8+ untagged tasks anyone can do (already handled above)
  // For P5-7 with skills that don't match → not compatible
  return false;
}

// ---- SSH queries ----

async function readFleetStatus(
  agent: string,
  ip: string,
  password: string,
): Promise<FleetStatus | null> {
  const result = await ssh(ip, password, `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null`);
  if (!result.ok || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout) as FleetStatus;
  } catch {
    return null;
  }
}

async function queryPendingTasks(
  ip: string,
  password: string,
): Promise<RemoteTask[]> {
  const query = `
    const { Database } = require('bun:sqlite');
    const db = new Database('db/arc.sqlite', { readonly: true });
    const rows = db.query(
      "SELECT id, subject, description, skills, priority, source, model FROM tasks WHERE status = 'pending' ORDER BY priority ASC, id ASC LIMIT 20"
    ).all();
    console.log(JSON.stringify(rows));
    db.close();
  `.trim();

  const result = await ssh(ip, password, `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "${query}" 2>/dev/null`);
  if (!result.ok || !result.stdout.trim()) return [];
  try {
    return JSON.parse(result.stdout) as RemoteTask[];
  } catch {
    return [];
  }
}

async function executeSteal(
  fromIp: string,
  toIp: string,
  password: string,
  task: RemoteTask,
  fromAgent: string,
  toAgent: string,
): Promise<boolean> {
  // Create task on idle agent
  const skills = task.skills ? `--skills '${task.skills.replace(/'/g, "'\\''")}'` : "";
  const subject = task.subject.replace(/'/g, "'\\''");
  const source = `fleet:${fromAgent}:stolen`;
  const model = task.model ? `--model '${task.model}'` : "";

  const createCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${subject}' --priority ${task.priority} --source '${source}' ${skills} ${model}`.trim();
  const createResult = await ssh(toIp, password, createCmd);
  if (!createResult.ok) {
    log(`failed to create task on ${toAgent}: ${createResult.stderr.slice(0, 100)}`);
    return false;
  }

  // Close task on busy agent
  const summary = `rebalanced to ${toAgent}`;
  const closeCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks close --id ${task.id} --status completed --summary '${summary}'`;
  const closeResult = await ssh(fromIp, password, closeCmd);
  if (!closeResult.ok) {
    log(`failed to close task #${task.id} on ${fromAgent}: ${closeResult.stderr.slice(0, 100)}`);
    // Task was already created on target — not ideal but not catastrophic
    return true;
  }

  return true;
}

// ---- Rebalance logic ----

function isStealable(task: RemoteTask): boolean {
  // Only P5+
  if (task.priority < MIN_STEALABLE_PRIORITY) return false;
  // Don't re-steal
  if (task.source && /^fleet:.*:stolen$/.test(task.source)) return false;
  return true;
}

// ---- Sensor entry point ----

export default async function fleetRebalanceSensor(): Promise<string> {
  if (isFleetSuspended()) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    const alertSource = `sensor:${SENSOR_NAME}:no-creds`;
    if (!pendingTaskExistsForSource(alertSource)) {
      insertTask({ subject: "fleet-rebalance: SSH password not configured", priority: 8, source: alertSource });
    }
    return "skip";
  }

  log("checking fleet for rebalance opportunities...");

  // 1. Read fleet-status.json from all agents in parallel (suspended excluded)
  const agentNames = getActiveAgentNames();
  const statusResults = await Promise.allSettled(
    agentNames.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const status = await readFleetStatus(agent, ip, password);
      return { agent, ip, status };
    }),
  );

  const agentStatuses: Array<{ agent: string; ip: string; status: FleetStatus }> = [];
  for (const r of statusResults) {
    if (r.status === "fulfilled" && r.value.status) {
      agentStatuses.push({ agent: r.value.agent, ip: r.value.ip, status: r.value.status });
    }
  }

  // 2. Identify idle and busy agents
  const now = Date.now();
  const idleAgents: Array<{ agent: string; ip: string }> = [];
  const busyCandidates: Array<{ agent: string; ip: string }> = [];

  for (const { agent, ip, status } of agentStatuses) {
    if (status.idle && status.idle_since) {
      const idleDuration = now - new Date(status.idle_since).getTime();
      if (idleDuration >= IDLE_MIN_MS) {
        idleAgents.push({ agent, ip });
      }
    }
  }

  if (idleAgents.length === 0) {
    log("no idle agents — skipping");
    return "ok";
  }

  // Query pending counts for all non-idle agents to find busy ones
  const pendingCounts = await Promise.allSettled(
    agentStatuses
      .filter((a) => !idleAgents.some((i) => i.agent === a.agent))
      .map(async ({ agent, ip }) => {
        const countResult = await ssh(
          ip, password,
          `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
            const { Database } = require('bun:sqlite');
            const db = new Database('db/arc.sqlite', { readonly: true });
            const row = db.query(\\"SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'\\").get();
            console.log(row?.c ?? 0);
            db.close();
          " 2>/dev/null`,
        );
        const count = parseInt(countResult.stdout.trim()) || 0;
        return { agent, ip, pendingCount: count };
      }),
  );

  for (const r of pendingCounts) {
    if (r.status === "fulfilled" && r.value.pendingCount > BUSY_THRESHOLD) {
      busyCandidates.push({ agent: r.value.agent, ip: r.value.ip });
    }
  }

  // Sort by descending pending count (busiest first) — approximated by position
  if (busyCandidates.length === 0) {
    log(`${idleAgents.length} idle agent(s) but no busy agents (threshold: >${BUSY_THRESHOLD} pending) — skipping`);
    return "ok";
  }

  log(`idle: ${idleAgents.map((a) => a.agent).join(", ")} | busy: ${busyCandidates.map((a) => a.agent).join(", ")}`);

  // 3. Execute steals
  const steals: StealAction[] = [];
  let totalSteals = 0;

  for (const idle of idleAgents) {
    if (totalSteals >= MAX_STEALS_PER_CYCLE) break;
    let agentSteals = 0;

    for (const busy of busyCandidates) {
      if (agentSteals >= MAX_STEALS_PER_IDLE) break;
      if (totalSteals >= MAX_STEALS_PER_CYCLE) break;

      // Query busy agent's pending queue
      const tasks = await queryPendingTasks(busy.ip, password);
      const stealable = tasks.filter((t) => isStealable(t) && agentCanHandle(idle.agent, t));

      if (stealable.length === 0) continue;

      // Steal lowest-priority first (highest number = least important)
      stealable.sort((a, b) => b.priority - a.priority);

      for (const task of stealable) {
        if (agentSteals >= MAX_STEALS_PER_IDLE) break;
        if (totalSteals >= MAX_STEALS_PER_CYCLE) break;

        const success = await executeSteal(busy.ip, idle.ip, password, task, busy.agent, idle.agent);
        if (success) {
          steals.push({
            from_agent: busy.agent,
            to_agent: idle.agent,
            task_id: task.id,
            subject: task.subject,
            priority: task.priority,
          });
          agentSteals++;
          totalSteals++;
          log(`stole task #${task.id} (P${task.priority}) from ${busy.agent} → ${idle.agent}: ${task.subject.slice(0, 60)}`);
        }
      }
    }
  }

  // 4. Write rebalance log
  const logEntry = {
    timestamp: new Date().toISOString(),
    idle_agents: idleAgents.map((a) => a.agent),
    busy_agents: busyCandidates.map((a) => a.agent),
    steals,
    total_steals: totalSteals,
  };

  try {
    const logLine = JSON.stringify(logEntry) + "\n";
    const { appendFileSync } = await import("node:fs");
    appendFileSync(REBALANCE_LOG, logLine);
  } catch {
    // non-critical
  }

  log(`rebalance complete: ${totalSteals} task(s) stolen`);
  return "ok";
}
