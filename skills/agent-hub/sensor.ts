/**
 * agent-hub sensor
 *
 * Every 15 minutes, polls each fleet agent via SSH to collect:
 * - Agent status (from fleet-status.json)
 * - Skill list (from arc skills)
 * - Task counts
 *
 * Also registers Arc itself from local data.
 * Updates hub_agents and hub_capabilities tables.
 */

import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { AGENT_NAME } from "../../src/identity.ts";
import { discoverSkills } from "../../src/skills.ts";
import { getPendingTasks, getActiveTasks, getTodayCostUsd } from "../../src/db.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import {
  initHubSchema,
  upsertHubAgent,
  replaceAgentCapabilities,
  updateAgentStatus,
} from "./schema.ts";
import type { InsertHubCapability } from "./schema.ts";

const SENSOR_NAME = "agent-hub";
const INTERVAL_MINUTES = 15;

const log = createSensorLogger(SENSOR_NAME);

// ---- Agent IP map (includes Arc) ----

const FLEET_IPS: Record<string, string> = {
  arc: "192.168.1.10",
  spark: "192.168.1.12",
  iris: "192.168.1.13",
  loom: "192.168.1.14",
  forge: "192.168.1.15",
};

// ---- Local registration ----

function registerLocal(): void {
  const skills = discoverSkills();
  const pending = getPendingTasks();
  const active = getActiveTasks();
  const costToday = getTodayCostUsd();

  upsertHubAgent({
    agent_name: "arc",
    ip_address: FLEET_IPS.arc,
    stx_address: "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
    btc_address: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
    bns_name: "arc0.btc",
    status: "online",
    skill_count: skills.length,
    sensor_count: skills.filter((s) => s.hasSensor).length,
    pending_tasks: pending.length,
    active_tasks: active.length,
    cost_today_usd: costToday,
  });

  const capabilities: InsertHubCapability[] = skills.map((s) => ({
    agent_name: "arc",
    skill_name: s.name,
    has_sensor: s.hasSensor ? 1 : 0,
    has_cli: s.hasCli ? 1 : 0,
    has_agent_md: s.hasAgent ? 1 : 0,
    tags: s.tags && s.tags.length > 0 ? JSON.stringify(s.tags) : null,
  }));

  replaceAgentCapabilities("arc", capabilities);
  log(`Registered local: ${skills.length} skills, ${pending.length} pending, ${active.length} active`);
}

// ---- Remote collection ----

interface RemoteStatus {
  agent: string;
  idle: boolean;
  last_task?: { id: number; subject: string; status: string; priority: number };
  last_cycle?: { duration_ms: number; cost_usd: number };
  health?: { uptime_seconds: number };
}

interface RemoteSkillInfo {
  name: string;
  hasSensor: boolean;
  hasCli: boolean;
  hasAgent: boolean;
  tags?: string[];
}

async function collectRemoteAgent(agentKey: string, password: string): Promise<void> {
  const ip = await getAgentIp(agentKey);

  // Collect fleet-status.json
  const statusResult = await ssh(ip, password, `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null || echo '{}'`);
  let status: RemoteStatus | null = null;
  try {
    status = JSON.parse(statusResult.stdout.trim()) as RemoteStatus;
  } catch {
    log(`${agentKey}: failed to parse fleet-status.json`);
  }

  // Collect skill list via arc skills (JSON output)
  const skillsResult = await ssh(ip, password, `cd ${REMOTE_ARC_DIR} && bash bin/arc skills --json 2>/dev/null || echo '[]'`);
  let skills: RemoteSkillInfo[] = [];
  try {
    const parsed = JSON.parse(skillsResult.stdout.trim());
    if (Array.isArray(parsed)) {
      skills = parsed as RemoteSkillInfo[];
    }
  } catch {
    log(`${agentKey}: failed to parse skills list`);
  }

  // Collect task counts
  const countsResult = await ssh(ip, password,
    `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks --status pending --limit 1000 2>/dev/null | grep -c "^  #" || echo 0`
  );
  const pendingCount = parseInt(countsResult.stdout.trim(), 10) || 0;

  const activeResult = await ssh(ip, password,
    `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks --status active --limit 100 2>/dev/null | grep -c "^  #" || echo 0`
  );
  const activeCount = parseInt(activeResult.stdout.trim(), 10) || 0;

  // Determine agent status
  let agentStatus = "offline";
  if (statusResult.ok && status) {
    const lastHb = status.last_cycle?.duration_ms;
    agentStatus = lastHb !== undefined ? "online" : "degraded";
  }

  // Upsert agent
  upsertHubAgent({
    agent_name: agentKey,
    ip_address: ip,
    status: agentStatus,
    skill_count: skills.length,
    sensor_count: skills.filter((s) => s.hasSensor).length,
    pending_tasks: pendingCount,
    active_tasks: activeCount,
    cost_today_usd: status?.last_cycle?.cost_usd ?? 0,
  });

  // Upsert capabilities
  if (skills.length > 0) {
    const capabilities: InsertHubCapability[] = skills.map((s) => ({
      agent_name: agentKey,
      skill_name: s.name,
      has_sensor: s.hasSensor ? 1 : 0,
      has_cli: s.hasCli ? 1 : 0,
      has_agent_md: s.hasAgent ? 1 : 0,
      tags: s.tags && s.tags.length > 0 ? JSON.stringify(s.tags) : null,
    }));
    replaceAgentCapabilities(agentKey, capabilities);
  }

  log(`${agentKey}: ${agentStatus}, ${skills.length} skills, ${pendingCount}p/${activeCount}a tasks`);
}

// ---- Main ----

export default async function sensor(): Promise<string> {
  // Only Arc runs this sensor
  if (AGENT_NAME !== "arc0") return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initHubSchema();

  // Always register local first
  try {
    registerLocal();
  } catch (err) {
    log(`Local registration failed: ${(err as Error).message}`);
  }

  // Collect remote agents
  let password: string;
  try {
    password = await getSshPassword();
  } catch (err) {
    log(`SSH password unavailable: ${(err as Error).message}`);
    return "error";
  }

  const remoteAgents = Object.keys(AGENTS); // spark, iris, loom, forge
  const results = await Promise.allSettled(
    remoteAgents.map((agent) =>
      collectRemoteAgent(agent, password).catch((err: Error) => {
        log(`${agent}: collection failed — ${err.message}`);
        updateAgentStatus(agent, "offline");
      })
    )
  );

  const failures = results.filter((r) => r.status === "rejected").length;
  if (failures > 0) {
    log(`${failures}/${remoteAgents.length} remote agents failed collection`);
  }

  log(`Hub sync complete: 1 local + ${remoteAgents.length} remote agents`);
  return "ok";
}
