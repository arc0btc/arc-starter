/**
 * fleet-router sensor
 *
 * Every 30 minutes, scans Arc's pending queue and routes eligible tasks
 * to fleet agents based on skill-tag domain matching.
 *
 * Routing rules:
 * - P1-2: Always stay on Arc (Opus-tier)
 * - Skill tag match → route to domain agent
 * - P8+ unmatched → route to lowest-backlog agent
 * - Health gate: skip unhealthy agents
 * - Backlog cap: skip agents with >20 pending
 * - Batch limit: max 10 tasks per sensor cycle
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { getPendingTasks, markTaskCompleted } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-router";
const INTERVAL_MINUTES = 30;
const BATCH_LIMIT = 10;
const BACKLOG_CAP = 20;

const log = createSensorLogger(SENSOR_NAME);

// ---- Domain routing table ----

interface DomainRule {
  agent: string;
  patterns: string[]; // glob-like prefix patterns matched against skill names
}

const DOMAIN_RULES: DomainRule[] = [
  // Arc keeps these (no routing)
  // fleet-*, arc-ops-*, credentials, arc-skill-* → handled by ARC_KEEP_PATTERNS

  // Spark: protocol & on-chain
  {
    agent: "spark",
    patterns: [
      "stacks-js", "bitcoin-", "ordinals-", "x-", "aibtc-",
      "multisig", "sip-", "bip-",
    ],
  },
  // Iris: research & signals
  {
    agent: "iris",
    patterns: [
      "arc-research-", "blog-publishing", "arc-email-",
      "arc-newsletter", "arc-digest",
    ],
  },
  // Loom: integrations
  {
    agent: "loom",
    patterns: [
      "zest-", "bitflow-", "mcp-",
    ],
  },
  // Forge: infrastructure & delivery
  {
    agent: "forge",
    patterns: [
      "arc0btc-site-", "blog-deploy", "arc0me-",
    ],
  },
];

// Tasks with these skill patterns always stay on Arc
const ARC_KEEP_PATTERNS = [
  "fleet-", "arc-ops-", "credentials", "arc-skill-",
  "arc-architecture", "arc-roundtable",
];

// Tasks requiring GitHub cannot go to Spark
const GITHUB_PATTERNS = [
  "github", "pr-review", "arc-starter-publish",
];

// ---- Routing logic ----

function parseSkills(task: Task): string[] {
  if (!task.skills) return [];
  try {
    const parsed = JSON.parse(task.skills);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function skillMatchesAny(skills: string[], patterns: string[]): boolean {
  return skills.some((skill) =>
    patterns.some((p) =>
      p.endsWith("-") ? skill.startsWith(p) : skill === p
    )
  );
}

export interface RoutingDecision {
  task: Task;
  target: string; // agent name or "arc" (keep)
  reason: string;
}

export function routeTask(
  task: Task,
  agentBacklogs: Record<string, number>,
  healthyAgents: Set<string>,
): RoutingDecision {
  const skills = parseSkills(task);

  // Rule 1: P1-2 stay on Arc
  if (task.priority <= 2) {
    return { task, target: "arc", reason: "P1-2 stays on Arc" };
  }

  // Rule 2: Arc-domain skills stay on Arc
  if (skills.length > 0 && skillMatchesAny(skills, ARC_KEEP_PATTERNS)) {
    return { task, target: "arc", reason: "Arc-domain skill" };
  }

  // Rule 3: Match by domain
  for (const rule of DOMAIN_RULES) {
    if (!healthyAgents.has(rule.agent)) continue;
    if ((agentBacklogs[rule.agent] ?? 0) >= BACKLOG_CAP) continue;

    if (skills.length > 0 && skillMatchesAny(skills, rule.patterns)) {
      // GitHub check for Spark
      if (rule.agent === "spark" && skillMatchesAny(skills, GITHUB_PATTERNS)) {
        continue;
      }
      return { task, target: rule.agent, reason: `skill match → ${rule.agent}` };
    }
  }

  // Rule 4: P8+ unmatched go to lowest-backlog healthy agent
  if (task.priority >= 8 && skills.length === 0) {
    let bestAgent = "";
    let bestBacklog = Infinity;
    for (const agent of Object.keys(AGENTS)) {
      if (!healthyAgents.has(agent)) continue;
      const backlog = agentBacklogs[agent] ?? 0;
      if (backlog < BACKLOG_CAP && backlog < bestBacklog) {
        bestAgent = agent;
        bestBacklog = backlog;
      }
    }
    if (bestAgent) {
      return { task, target: bestAgent, reason: `P8+ lowest backlog → ${bestAgent}` };
    }
  }

  // Default: keep on Arc
  return { task, target: "arc", reason: "no matching domain" };
}

// ---- Fleet health & backlog queries ----

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;

interface FleetStatusMd {
  healthy: Set<string>;
}

function readFleetHealth(): FleetStatusMd {
  const healthy = new Set<string>();
  try {
    const content = require("fs").readFileSync(
      join(MEMORY_DIR, "fleet-status.md"), "utf-8"
    );
    // Parse the markdown table: look for "| <agent> | yes |"
    for (const agent of Object.keys(AGENTS)) {
      const re = new RegExp(`\\|\\s*${agent}\\s*\\|\\s*yes\\s*\\|`);
      if (re.test(content)) {
        healthy.add(agent);
      }
    }
  } catch {
    // No fleet-status.md → no healthy agents → no routing
  }
  return { healthy };
}

async function getRemoteBacklog(
  agent: string,
  password: string,
): Promise<number> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return Infinity;
  }

  const result = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const row = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\'pending\\'').get();
      console.log(row?.c ?? 0);
      db.close();
    " 2>/dev/null || echo "999"`
  );

  return parseInt(result.stdout.trim()) || 999;
}

// ---- Send task to remote agent ----

async function sendToAgent(
  agent: string,
  task: Task,
  password: string,
): Promise<boolean> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return false;
  }

  const escSubject = task.subject.replace(/'/g, "'\\''");
  let cmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${task.priority}`;

  const skills = parseSkills(task);
  if (skills.length > 0) {
    cmd += ` --skills ${skills.join(",")}`;
  }

  if (task.description) {
    const escDesc = task.description.replace(/'/g, "'\\''").slice(0, 500);
    cmd += ` --description '${escDesc}'`;
  }

  cmd += ` --source 'fleet:arc:router'`;

  const result = await ssh(ip, password, cmd);
  return result.ok;
}

// ---- Sensor entry point ----

export default async function fleetRouterSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    return "skip";
  }

  // Read fleet health
  const { healthy } = readFleetHealth();
  if (healthy.size === 0) {
    log("no healthy fleet agents — skipping routing");
    return "skip";
  }

  log(`healthy agents: ${[...healthy].join(", ")}`);

  // Get remote backlogs in parallel
  const backlogEntries = await Promise.allSettled(
    [...healthy].map(async (agent) => ({
      agent,
      count: await getRemoteBacklog(agent, password),
    }))
  );

  const backlogs: Record<string, number> = {};
  for (const entry of backlogEntries) {
    if (entry.status === "fulfilled") {
      backlogs[entry.value.agent] = entry.value.count;
      log(`${entry.value.agent} backlog: ${entry.value.count}`);
    }
  }

  // Get pending tasks
  const pending = getPendingTasks();
  log(`Arc pending: ${pending.length}`);

  // Route tasks
  let routed = 0;
  for (const task of pending) {
    if (routed >= BATCH_LIMIT) break;

    const decision = routeTask(task, backlogs, healthy);
    if (decision.target === "arc") continue;

    // Send to remote agent
    const sent = await sendToAgent(decision.target, task, password);
    if (sent) {
      markTaskCompleted(
        task.id,
        `Routed to ${decision.target} (${decision.reason})`
      );
      // Update local backlog tracking
      backlogs[decision.target] = (backlogs[decision.target] ?? 0) + 1;
      routed++;
      log(`routed task #${task.id} → ${decision.target}: ${task.subject.slice(0, 60)}`);
    } else {
      log(`failed to route task #${task.id} to ${decision.target}`);
    }
  }

  log(`routing complete: ${routed} tasks distributed`);
  return routed > 0 ? "ok" : "skip";
}
