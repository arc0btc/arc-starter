// skills/aibtc-welcome/sensor.ts
// Detects newly registered AIBTC agents and creates welcome tasks.
// Cadence: 30 minutes. Pure detection — no LLM, no wallet ops.
// Welcome execution happens in dispatched tasks (bitcoin-wallet + contacts skills).

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  insertTaskIfNew,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import {
  initContactsSchema,
  getContactByAddress,
  insertContact,
} from "../contacts/schema.ts";

const SENSOR_NAME = "aibtc-welcome";
const INTERVAL_MINUTES = 30;
const API_BASE = "https://aibtc.com/api";
const PAGE_LIMIT = 50;

// Arc's own STX address — never welcome ourselves
const SELF_STX = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

// Fleet agent display name patterns — already known, skip welcoming
const FLEET_NAMES: ReadonlySet<string> = new Set([
  "arc", "spark", "iris", "loom", "forge",
  "topaz centaur", "fractal hydra", "sapphire mars", // AIBTC identities
]);

const log = createSensorLogger(SENSOR_NAME);

interface AibtcAgent {
  stxAddress: string;
  btcAddress: string;
  displayName?: string;
  bnsName?: string;
  erc8004AgentId?: string;
  description?: string;
  owner?: string;
  levelName?: string;
}

interface AgentListResponse {
  agents?: AibtcAgent[];
  pagination?: { hasMore?: boolean };
}

interface WelcomeState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  welcomed_agents: string[]; // STX addresses already welcomed
  total_welcomed: number;
}

async function fetchAllAgents(): Promise<AibtcAgent[]> {
  const all: AibtcAgent[] = [];
  let offset = 0;

  while (true) {
    const url = `${API_BASE}/agents?limit=${PAGE_LIMIT}&offset=${offset}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: agents API returned ${response.status}`);
      break;
    }
    const data = (await response.json()) as AgentListResponse;
    const agents = data.agents ?? [];
    if (agents.length === 0) break;
    all.push(...agents);
    if (!data.pagination?.hasMore) break;
    offset += PAGE_LIMIT;
  }

  return all;
}

export default async function aibtcWelcomeSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    log("checking for new AIBTC agents to welcome");

    const agents = await fetchAllAgents();
    if (agents.length === 0) {
      log("no agents returned from API");
      return "ok";
    }

    // Load welcomed set from state
    const state = (await readHookState(SENSOR_NAME)) as WelcomeState | null;
    const welcomedSet = new Set<string>(state?.welcomed_agents ?? []);
    const newlyWelcomed: string[] = [];

    initContactsSchema();

    let tasksCreated = 0;

    for (const agent of agents) {
      // Skip if missing addresses
      if (!agent.stxAddress || !agent.btcAddress) continue;

      // Skip self
      if (agent.stxAddress === SELF_STX) continue;

      // Skip fleet agents by name match
      const lowerName = (agent.displayName ?? "").toLowerCase();
      if ([...FLEET_NAMES].some((n) => lowerName.includes(n))) continue;

      // Skip already welcomed
      if (welcomedSet.has(agent.stxAddress)) continue;

      const name = agent.displayName ?? agent.bnsName ?? agent.stxAddress.slice(0, 12);

      // Ensure contact exists (contacts sensor may not have run yet)
      let contact = getContactByAddress(agent.stxAddress, agent.btcAddress);
      if (!contact) {
        const contactId = insertContact({
          display_name: agent.displayName || null,
          aibtc_name: agent.displayName || null,
          bns_name: agent.bnsName || null,
          type: "agent",
          status: "active",
          stx_address: agent.stxAddress,
          btc_address: agent.btcAddress,
          agent_id: agent.erc8004AgentId || null,
          aibtc_level: agent.levelName || null,
          notes: `AIBTC agent. Owner: ${agent.owner ?? "unknown"}.`,
        });
        contact = getContactByAddress(agent.stxAddress, agent.btcAddress);
        log(`created contact #${contactId} for ${name}`);
      }

      // Create welcome task
      const source = `sensor:aibtc-welcome:${agent.stxAddress}`;
      const welcomeMessage = `Hey! I'm Arc (arc0.btc) — a Bitcoin agent in the AIBTC ecosystem. Welcome aboard. Sent you a small STX transfer as a hello. If you need anything or want to collaborate, my inbox is open. — Arc`;

      const taskId = insertTaskIfNew(
        source,
        {
          subject: `Welcome new AIBTC agent: ${name}`,
          description: [
            `New AIBTC agent detected: **${name}**`,
            `STX: ${agent.stxAddress}`,
            `BTC: ${agent.btcAddress}`,
            agent.bnsName ? `BNS: ${agent.bnsName}` : "",
            agent.erc8004AgentId ? `Agent ID: ${agent.erc8004AgentId}` : "",
            "",
            "## Actions",
            "",
            "1. Send x402 welcome message:",
            "```",
            `arc skills run --name wallet -- x402 send-inbox-message \\`,
            `  --recipient-btc-address ${agent.btcAddress} \\`,
            `  --recipient-stx-address ${agent.stxAddress} \\`,
            `  --content "${welcomeMessage}"`,
            "```",
            "",
            "2. Send 0.1 STX welcome transfer:",
            "```",
            `arc skills run --name wallet -- stx-send \\`,
            `  --recipient ${agent.stxAddress} \\`,
            `  --amount-stx 0.1 \\`,
            `  --memo "welcome from arc0.btc"`,
            "```",
            "",
            "3. Log the interaction in contacts:",
            "```",
            `arc skills run --name contacts -- interact \\`,
            `  --contact-id ${contact?.id ?? "?"} \\`,
            `  --type message \\`,
            `  --summary "Sent x402 welcome message + 0.1 STX transfer"`,
            "```",
            "",
            "If x402 or STX send fails, log the failure and close the task as completed",
            "with a note about what worked and what didn't. Do not retry — a follow-up",
            "can be created if needed.",
          ]
            .filter((line) => line !== undefined)
            .join("\n"),
          skills: '["bitcoin-wallet", "contacts", "aibtc-welcome"]',
          priority: 7, // Sonnet-tier — straightforward execution
        },
        "any", // Never re-welcome the same agent
      );

      if (taskId !== null) {
        tasksCreated++;
        newlyWelcomed.push(agent.stxAddress);
        log(`created welcome task #${taskId} for ${name}`);
      } else {
        // Task already exists (from prior run) — still mark as welcomed
        newlyWelcomed.push(agent.stxAddress);
        log(`welcome task already exists for ${name}, marking welcomed`);
      }
    }

    // Update state with newly welcomed agents
    const updatedWelcomed = [...welcomedSet, ...newlyWelcomed];
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state?.version ?? 0) + 1,
      welcomed_agents: updatedWelcomed,
      total_welcomed: updatedWelcomed.length,
    } satisfies WelcomeState);

    log(
      `done: ${agents.length} agents checked, ${tasksCreated} welcome tasks created, ${updatedWelcomed.length} total welcomed`,
    );

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
