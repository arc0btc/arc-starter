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
import { getPendingTasks, markTaskCompleted, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-router";
const INTERVAL_MINUTES = 30;
const BATCH_LIMIT = 10;
const BACKLOG_CAP = 20;
const SOFT_CAP = 12; // triggers overflow routing to alternate agent
const ACTIVE_WEIGHT = 5; // active task adds this to load score
const OFFLINE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour — treat as offline if no dispatch

const MAINTENANCE_FILE = new URL("../../db/fleet-maintenance.json", import.meta.url).pathname;

const log = createSensorLogger(SENSOR_NAME);

// ---- Maintenance mode gate ----

interface MaintenanceConfig {
  enabled: boolean;
  reason?: string;
  since?: string;
  suppress_agents?: string[]; // empty/missing = all agents suppressed
}

async function isAgentInMaintenance(agent: string): Promise<boolean> {
  try {
    const file = Bun.file(MAINTENANCE_FILE);
    if (!(await file.exists())) return false;
    const config = await file.json() as MaintenanceConfig;
    if (!config.enabled) return false;
    // Empty or missing suppress_agents means all workers suppressed
    if (!config.suppress_agents || config.suppress_agents.length === 0) return true;
    return config.suppress_agents.includes(agent);
  } catch {
    return false;
  }
}

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

// X/Twitter-related subject keywords — Loom and Forge have no X credentials
const X_SUBJECT_PATTERNS = [
  "x account", "twitter", "oauth 1.0a", "@loom0btc", "@forge0btc",
];

// Agents that must never receive X/Twitter tasks
const X_RESTRICTED_AGENTS = new Set(["loom", "forge"]);

// Overflow paths when primary agent exceeds SOFT_CAP
const OVERFLOW_TARGETS: Record<string, string[]> = {
  spark: ["arc"],           // on-chain needs Opus-tier fallback
  iris: ["arc"],            // research falls back to Arc
  loom: ["forge"],          // both do code work
  forge: ["loom"],          // bidirectional overflow
};

// ---- Load scoring ----

export interface AgentLoad {
  pending: number;
  active: number;
  score: number; // pending + (active * ACTIVE_WEIGHT)
}

export function computeLoadScore(pending: number, active: number): number {
  return pending + active * ACTIVE_WEIGHT;
}

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

function subjectMatchesAny(subject: string, patterns: string[]): boolean {
  const lower = subject.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
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
  agentLoads: Record<string, AgentLoad>,
  healthyAgents: Set<string>,
): RoutingDecision {
  const skills = parseSkills(task);

  // Helper: get load score for an agent (backwards-compat with plain backlog counts)
  const loadOf = (agent: string): number =>
    agentLoads[agent]?.score ?? Infinity;

  // Helper: check if agent is available (healthy + under hard cap)
  const isAvailable = (agent: string): boolean =>
    healthyAgents.has(agent) && loadOf(agent) < BACKLOG_CAP;

  // Rule 1: P1-2 stay on Arc
  if (task.priority <= 2) {
    return { task, target: "arc", reason: "P1-2 stays on Arc" };
  }

  // Rule 2: Arc-domain skills stay on Arc
  if (skills.length > 0 && skillMatchesAny(skills, ARC_KEEP_PATTERNS)) {
    return { task, target: "arc", reason: "Arc-domain skill" };
  }

  // Rule 3: Match by domain, with load-aware overflow
  for (const rule of DOMAIN_RULES) {
    if (skills.length === 0 || !skillMatchesAny(skills, rule.patterns)) continue;

    // GitHub check for Spark
    if (rule.agent === "spark" && skillMatchesAny(skills, GITHUB_PATTERNS)) {
      continue;
    }

    // X/Twitter check for Loom and Forge
    if (
      X_RESTRICTED_AGENTS.has(rule.agent) &&
      subjectMatchesAny(task.subject, X_SUBJECT_PATTERNS)
    ) {
      return { task, target: "arc", reason: "X-related task blocked from " + rule.agent };
    }

    // Primary agent available and under soft cap → route directly
    if (isAvailable(rule.agent) && loadOf(rule.agent) < SOFT_CAP) {
      return { task, target: rule.agent, reason: `skill match → ${rule.agent}` };
    }

    // Primary agent over soft cap or unavailable → try overflow
    const overflowCandidates = OVERFLOW_TARGETS[rule.agent] ?? [];
    for (const overflow of overflowCandidates) {
      if (overflow === "arc") {
        // Overflow to Arc means keep locally
        return { task, target: "arc", reason: `${rule.agent} overloaded (${loadOf(rule.agent)}) → keep on Arc` };
      }
      if (isAvailable(overflow) && loadOf(overflow) < SOFT_CAP) {
        return { task, target: overflow, reason: `${rule.agent} overloaded → overflow to ${overflow}` };
      }
    }

    // All overflow targets also busy — still route to primary if under hard cap
    if (isAvailable(rule.agent)) {
      return { task, target: rule.agent, reason: `skill match → ${rule.agent} (overflow full)` };
    }
  }

  // Rule 4: Unmatched P3+ tasks go to least-busy healthy agent
  if (task.priority >= 3) {
    const isXTask = subjectMatchesAny(task.subject, X_SUBJECT_PATTERNS);
    let bestAgent = "";
    let bestLoad = Infinity;
    for (const agent of Object.keys(AGENTS)) {
      if (!isAvailable(agent)) continue;
      // Don't route X tasks to agents without X credentials
      if (isXTask && X_RESTRICTED_AGENTS.has(agent)) continue;
      const load = loadOf(agent);
      if (load < bestLoad) {
        bestAgent = agent;
        bestLoad = load;
      }
    }
    if (bestAgent) {
      return { task, target: bestAgent, reason: `least-busy → ${bestAgent} (load: ${bestLoad})` };
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
    // Parse the markdown table: look for "| <agent> | yes |" (active agents only)
    for (const agent of getActiveAgentNames()) {
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

async function getRemoteLoad(
  agent: string,
  password: string,
): Promise<AgentLoad> {
  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    return { pending: 999, active: 0, score: 999 };
  }

  const result = await ssh(
    ip, password,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      const { Database } = require('bun:sqlite');
      const db = new Database('db/arc.sqlite', { readonly: true });
      const p = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'pending\\\\'').get();
      const a = db.query('SELECT COUNT(*) as c FROM tasks WHERE status = \\\\'active\\\\'').get();
      db.close();
      const fs = require('fs');
      let updatedAt = '';
      try {
        const s = JSON.parse(fs.readFileSync('memory/fleet-status.json', 'utf8'));
        updatedAt = s.updated_at ?? '';
      } catch {}
      console.log((p?.c ?? 0) + ':' + (a?.c ?? 0) + ':' + updatedAt);
    " 2>/dev/null || echo "999:0:"`
  );

  const raw = result.stdout.trim();
  // Format: "pending:active:ISO-timestamp" — split on first two colons only
  const firstColon = raw.indexOf(":");
  const secondColon = raw.indexOf(":", firstColon + 1);
  const pending = parseInt(raw.slice(0, firstColon)) || 999;
  const active = parseInt(raw.slice(firstColon + 1, secondColon < 0 ? undefined : secondColon)) || 0;
  const updatedAt = secondColon >= 0 ? raw.slice(secondColon + 1) : "";

  // Offline gate: if fleet-status.json hasn't been updated in >1h, treat as offline
  if (updatedAt) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs > OFFLINE_THRESHOLD_MS) {
      const staleMins = Math.round(ageMs / 60000);
      log(`${agent} offline: fleet-status.json stale (${staleMins}m) — skipping`);
      return { pending: 999, active: 0, score: 999 };
    }
  }

  return { pending, active, score: computeLoadScore(pending, active) };
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
  let command = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${task.priority}`;

  const skills = parseSkills(task);
  if (skills.length > 0) {
    command += ` --skills ${skills.join(",")}`;
  }

  if (task.description) {
    const escDesc = task.description.replace(/'/g, "'\\''").slice(0, 500);
    command += ` --description '${escDesc}'`;
  }

  command += ` --source 'fleet:arc:router'`;

  const result = await ssh(ip, password, command);
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
    const alertSource = `sensor:${SENSOR_NAME}:no-creds`;
    if (!pendingTaskExistsForSource(alertSource)) {
      insertTask({ subject: "fleet-router: SSH password not configured", priority: 8, source: alertSource });
    }
    return "skip";
  }

  // Read fleet health
  const { healthy } = readFleetHealth();
  if (healthy.size === 0) {
    log("no healthy fleet agents — skipping routing");
    return "skip";
  }

  // Remove maintenance-suppressed agents from healthy set
  const maintenanceChecks = await Promise.all(
    [...healthy].map(async (agent) => ({ agent, suppressed: await isAgentInMaintenance(agent) }))
  );
  for (const { agent, suppressed } of maintenanceChecks) {
    if (suppressed) {
      healthy.delete(agent);
      log(`${agent} suppressed by fleet-maintenance.json — skipping`);
    }
  }
  if (healthy.size === 0) {
    log("all agents in maintenance mode — skipping routing");
    return "skip";
  }

  log(`healthy agents: ${[...healthy].join(", ")}`);

  // Get remote loads in parallel (pending + active counts)
  const loadEntries = await Promise.allSettled(
    [...healthy].map(async (agent) => ({
      agent,
      load: await getRemoteLoad(agent, password),
    }))
  );

  const loads: Record<string, AgentLoad> = {};
  for (const entry of loadEntries) {
    if (entry.status === "fulfilled") {
      loads[entry.value.agent] = entry.value.load;
      const l = entry.value.load;
      log(`${entry.value.agent} load: ${l.pending}p + ${l.active}a = ${l.score}`);
    }
  }

  // Get pending tasks
  const pending = getPendingTasks();
  log(`Arc pending: ${pending.length}`);

  // Route tasks
  let routed = 0;
  for (const task of pending) {
    if (routed >= BATCH_LIMIT) break;

    const decision = routeTask(task, loads, healthy);
    if (decision.target === "arc") continue;

    // Send to remote agent
    const sent = await sendToAgent(decision.target, task, password);
    if (sent) {
      markTaskCompleted(
        task.id,
        `Routed to ${decision.target} (${decision.reason})`
      );
      // Update local load tracking
      const prev = loads[decision.target] ?? { pending: 0, active: 0, score: 0 };
      prev.pending++;
      prev.score = computeLoadScore(prev.pending, prev.active);
      loads[decision.target] = prev;
      routed++;
      log(`routed task #${task.id} → ${decision.target}: ${task.subject.slice(0, 60)}`);
    } else {
      log(`failed to route task #${task.id} to ${decision.target}`);
    }
  }

  log(`routing complete: ${routed} tasks distributed`);
  return routed > 0 ? "ok" : "skip";
}
