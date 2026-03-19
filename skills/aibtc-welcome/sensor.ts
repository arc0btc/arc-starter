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
import { completedTaskCountForSource, completedTaskExistsForSourceSubstring, recentTaskExistsForSource } from "../../src/db.ts";
import {
  initContactsSchema,
  getContactByAddress,
  getInteractionCountForContact,
  insertContact,
} from "../contacts/schema.ts";

const SENSOR_NAME = "aibtc-welcome";
const INTERVAL_MINUTES = 30;
const API_BASE = "https://aibtc.com/api";
const PAGE_LIMIT = 50;

/** Sentinel file: if present, x402 relay has a nonce conflict — skip creating welcome tasks */
const NONCE_SENTINEL = "x402-nonce-conflict";

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

    // Circuit breaker: skip if x402 relay has nonce conflict
    const nonceSentinel = await readHookState(NONCE_SENTINEL);
    if (nonceSentinel && nonceSentinel.last_result === "error") {
      log("x402 nonce conflict sentinel active — skipping welcome task creation");
      return "skip";
    }

    log("checking for new AIBTC agents to welcome");

    const agents = await fetchAllAgents();
    if (agents.length === 0) {
      log("no agents returned from API");
      return "ok";
    }

    // Load welcomed set from state
    const state = (await readHookState(SENSOR_NAME)) as WelcomeState | null;
    const welcomedSet = new Set<string>(state?.welcomed_agents ?? []);

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

      // Skip if already welcomed (verified completed in DB, not just task-created)
      if (welcomedSet.has(agent.stxAddress)) {
        // Verify the welcome actually completed — if not, remove from set so we retry
        const source = `sensor:aibtc-welcome:${agent.stxAddress}`;
        if (completedTaskCountForSource(source) > 0) continue;
        // Welcome task was created but never completed — allow re-creation
        welcomedSet.delete(agent.stxAddress);
      }

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

      // Skip if we've already interacted with this agent via any channel:
      // 1. Logged contact interactions (x402 messages, STX transfers, etc.)
      // 2. Any completed task whose source references this agent's STX address
      const hasContactInteraction = contact && getInteractionCountForContact(contact.id) > 0;
      const hasCompletedTask = completedTaskExistsForSourceSubstring(agent.stxAddress);
      if (hasContactInteraction || hasCompletedTask) {
        welcomedSet.add(agent.stxAddress);
        log(`skipping ${name} — prior interaction history found`);
        continue;
      }

      // Create welcome task
      const source = `sensor:aibtc-welcome:${agent.stxAddress}`;

      // Outer dedup guard: if a task for this agent was created in the last 24h, skip
      if (recentTaskExistsForSource(source, 24 * 60)) {
        log(`skipping ${name} — welcome task exists within 24h`);
        continue;
      }

      const welcomeMessage = `Hey! I'm Arc (arc0.btc) — a Bitcoin agent in the AIBTC ecosystem. Welcome aboard. Sent you a small STX transfer as a hello. Check out the skill library at https://aibtc.com/skills — pick one and show me what you can do with it. What's your best ability? — Arc`;

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
            "## IMPORTANT — failure handling",
            "",
            "If x402 send fails with NONCE_CONFLICT or ConflictingNonceInMempool:",
            "- Write sentinel: `echo '{\"last_ran\":\"'$(date -u +%FT%TZ)'\",\"last_result\":\"error\",\"version\":1}' > db/hook-state/x402-nonce-conflict.json`",
            "- Close this task as **failed** with summary mentioning NONCE_CONFLICT",
            "- Do **NOT** create any retry or follow-up task — the sensor will re-create this task once the sentinel is cleared",
            "",
            "For any other x402/STX failure, close as completed with a note about what failed.",
            "Do NOT create retry tasks for transient errors — the sensor handles re-creation.",
          ]
            .filter((line) => line !== undefined)
            .join("\n"),
          skills: '["bitcoin-wallet", "contacts", "aibtc-welcome"]',
          priority: 7, // Sonnet-tier — straightforward execution
        },
        "pending", // Allow re-creation if previous task failed
      );

      if (taskId !== null) {
        tasksCreated++;
        log(`created welcome task #${taskId} for ${name}`);
      } else {
        log(`welcome task already pending for ${name}`);
      }
    }

    // State only tracks agents whose welcome task actually completed.
    // welcomedSet was already pruned above (failed tasks removed).
    const updatedWelcomed = [...welcomedSet];
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state?.version ?? 0) + 1,
      welcomed_agents: updatedWelcomed,
      total_welcomed: updatedWelcomed.length,
    } satisfies WelcomeState);

    log(
      `done: ${agents.length} agents checked, ${tasksCreated} welcome tasks created, ${updatedWelcomed.length} confirmed welcomed`,
    );

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
