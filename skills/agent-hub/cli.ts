// skills/agent-hub/cli.ts
// CLI for agent hub: list, show, register, capabilities, route, health, stats

import {
  initHubSchema,
  getAllHubAgents,
  getHubAgent,
  upsertHubAgent,
  getHubCapabilities,
  findAgentForSkill,
  getFleetHealth,
  getRoutingStats,
  getRecentRoutes,
} from "./schema";
import type { HubAgent, HubCapability } from "./schema";

function log(message: string): void {
  console.log(`[agent-hub] ${message}`);
}

function logError(message: string): void {
  console.error(`[agent-hub] error: ${message}`);
}

function parseArgs(args: string[]): { command: string; params: Record<string, string>; help: boolean } {
  const command = (args[0] || "") as string;
  const params: Record<string, string> = {};
  let help = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--help") {
      help = true;
    } else if (args[i]?.startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }

  return { command, params, help };
}

function printAgent(agent: HubAgent, verbose: boolean = false): void {
  const statusIcon = agent.status === "online" ? "●" : agent.status === "degraded" ? "◐" : "○";
  console.log(`  ${statusIcon} ${agent.agent_name} (${agent.ip_address}) [${agent.status}]`);

  if (verbose) {
    if (agent.display_name) console.log(`    Display: ${agent.display_name}`);
    if (agent.bns_name) console.log(`    BNS: ${agent.bns_name}`);
    if (agent.stx_address) console.log(`    STX: ${agent.stx_address}`);
    if (agent.btc_address) console.log(`    BTC: ${agent.btc_address}`);
    if (agent.version) console.log(`    Version: ${agent.version}`);
    console.log(`    Skills: ${agent.skill_count} | Sensors: ${agent.sensor_count}`);
    console.log(`    Tasks: ${agent.pending_tasks} pending, ${agent.active_tasks} active`);
    console.log(`    Cost today: $${agent.cost_today_usd.toFixed(2)}`);
    if (agent.last_heartbeat) console.log(`    Last heartbeat: ${agent.last_heartbeat}`);
    console.log(`    Registered: ${agent.registered_at}`);
  }
}

function printCapability(cap: HubCapability): void {
  const flags: string[] = [];
  if (cap.has_sensor) flags.push("sensor");
  if (cap.has_cli) flags.push("cli");
  if (cap.has_agent_md) flags.push("agent");
  const tags = cap.tags ? JSON.parse(cap.tags) as string[] : [];
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  console.log(`    ${cap.skill_name} (${flags.join(", ")})${tagStr}`);
}

const USAGE = `Usage: arc skills run --name agent-hub -- <command> [options]

Commands:
  list                              List registered agents
  show --agent <name>               Agent detail + capabilities
  register --agent <name> --ip <addr> [--stx <addr>] [--btc <addr>] [--bns <name>]
  capabilities --agent <name>       List agent capabilities
  route --skill <name>              Find best agent for a skill
  health                            Fleet health summary
  stats                             Task routing stats (7-day)`;

async function main(): Promise<void> {
  initHubSchema();
  const { command, params, help } = parseArgs(process.argv.slice(2));

  if (help || !command) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "list": {
      const agents = getAllHubAgents();
      if (agents.length === 0) {
        log("No agents registered. Use 'register' to add agents.");
        return;
      }
      log(`${agents.length} agent(s) registered:`);
      for (const agent of agents) {
        printAgent(agent, true);
      }
      break;
    }

    case "show": {
      const name = params.agent;
      if (!name) { logError("--agent required"); return; }
      const agent = getHubAgent(name);
      if (!agent) { logError(`Agent '${name}' not found`); return; }
      printAgent(agent, true);
      const caps = getHubCapabilities(name);
      if (caps.length > 0) {
        console.log(`  Capabilities (${caps.length}):`);
        for (const cap of caps) printCapability(cap);
      }
      break;
    }

    case "register": {
      const name = params.agent;
      const ip = params.ip;
      if (!name || !ip) { logError("--agent and --ip required"); return; }
      upsertHubAgent({
        agent_name: name,
        ip_address: ip,
        stx_address: params.stx || undefined,
        btc_address: params.btc || undefined,
        bns_name: params.bns || undefined,
        status: "online",
      });
      log(`Registered/updated agent '${name}' at ${ip}`);
      break;
    }

    case "capabilities": {
      const name = params.agent;
      if (!name) { logError("--agent required"); return; }
      const caps = getHubCapabilities(name);
      if (caps.length === 0) {
        log(`No capabilities registered for '${name}'`);
        return;
      }
      log(`${caps.length} capabilities for '${name}':`);
      for (const cap of caps) printCapability(cap);
      break;
    }

    case "route": {
      const skill = params.skill;
      if (!skill) { logError("--skill required"); return; }
      const matches = findAgentForSkill(skill);
      if (matches.length === 0) {
        log(`No online agent has skill '${skill}'`);
        return;
      }
      log(`Agents with '${skill}' (sorted by load):`);
      for (const m of matches) {
        const agent = getHubAgent(m.agent_name);
        const load = agent ? `${agent.pending_tasks}p/${agent.active_tasks}a` : "?";
        console.log(`    ${m.agent_name} (load: ${load})`);
      }
      break;
    }

    case "health": {
      const health = getFleetHealth();
      log(`Fleet health: ${health.online}/${health.total} online, ${health.degraded} degraded, ${health.offline} offline`);
      const agents = getAllHubAgents();
      for (const agent of agents) {
        printAgent(agent);
      }
      break;
    }

    case "stats": {
      const stats = getRoutingStats();
      if (stats.length === 0) {
        log("No routing data in the last 7 days");
        return;
      }
      log("Task routing stats (7-day):");
      for (const s of stats) {
        console.log(`    ${s.to_agent}: ${s.route_count} tasks routed`);
      }
      const recent = getRecentRoutes(10);
      if (recent.length > 0) {
        console.log("\n  Recent routes:");
        for (const r of recent) {
          console.log(`    task:${r.task_id} → ${r.to_agent} (${r.reason || r.skill_match || "direct"})`);
        }
      }
      break;
    }

    default:
      logError(`Unknown command: ${command}`);
      console.log(USAGE);
  }
}

main().catch((err: Error) => {
  logError(err.message);
  process.exit(1);
});
