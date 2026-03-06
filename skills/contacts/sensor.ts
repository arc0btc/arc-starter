// skills/contacts/sensor.ts
// Discovers agents from AIBTC API and syncs them into the contacts table.
// Cadence: 60 minutes. Creates stubs for new agents, updates stale data.
// Future: chainhook on erc8004 identity registry mints for real-time discovery.

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  pendingTaskExistsForSource,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import {
  initContactsSchema,
  getAllContacts,
  insertContact,
  updateContact,
  searchContacts,
} from "./schema.ts";
import type { Contact } from "./schema.ts";

const SENSOR_NAME = "contacts-aibtc-discovery";
const INTERVAL_MINUTES = 60;
const API_BASE = "https://aibtc.com/api";
const PAGE_LIMIT = 50;

const log = createSensorLogger(SENSOR_NAME);

interface AibtcAgent {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey?: string;
  btcPublicKey?: string;
  taprootAddress?: string;
  nostrPublicKey?: string;
  bnsName?: string;
  erc8004AgentId?: string;
  displayName?: string;
  description?: string;
  owner?: string;
  verifiedAt?: string;
  lastActiveAt?: string;
  lastIdentityCheck?: string;
  checkInCount?: number;
  level?: number;
  levelName?: string;
  achievementCount?: number;
}

interface AgentListResponse {
  agents?: AibtcAgent[];
  pagination?: {
    total?: number;
    limit?: number;
    offset?: number;
    hasMore?: boolean;
  };
  error?: string;
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

function buildContactIndex(contacts: Contact[]): Map<string, Contact> {
  const index = new Map<string, Contact>();
  for (const c of contacts) {
    if (c.stx_address) index.set(c.stx_address, c);
    if (c.btc_address) index.set(c.btc_address, c);
  }
  return index;
}

function mapLevelName(levelName?: string): string | undefined {
  if (!levelName) return undefined;
  return levelName;
}

export default async function contactsDiscoverySensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    // Dedup: skip if a contacts-sync task is already pending (human-queued or prior cycle)
    const TASK_SOURCE = `sensor:${SENSOR_NAME}`;
    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("skip (pending task already queued)");
      return "skip";
    }

    log("run started — fetching AIBTC agent registry");

    const agents = await fetchAllAgents();
    if (agents.length === 0) {
      log("no agents returned from API");
      return "ok";
    }

    log(`fetched ${agents.length} agents from AIBTC API`);

    // Ensure contacts schema is initialized
    initContactsSchema();

    // Index existing contacts by address for fast lookup
    const existingContacts = getAllContacts();
    const index = buildContactIndex(existingContacts);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const agent of agents) {
      // Match by stx or btc address
      const existing = index.get(agent.stxAddress) ?? index.get(agent.btcAddress);

      if (!existing) {
        // Create stub contact
        const id = insertContact({
          display_name: agent.displayName || null,
          aibtc_name: agent.displayName || null,
          bns_name: agent.bnsName || null,
          type: "agent",
          status: "active",
          stx_address: agent.stxAddress,
          btc_address: agent.btcAddress,
          taproot_address: agent.taprootAddress || null,
          agent_id: agent.erc8004AgentId || null,
          aibtc_level: mapLevelName(agent.levelName),
          notes: agent.description
            ? `AIBTC: ${agent.description}. Owner: ${agent.owner ?? "unknown"}.`
            : agent.owner
              ? `AIBTC agent. Owner: ${agent.owner}.`
              : "AIBTC agent (auto-discovered).",
        });

        const name = agent.displayName ?? agent.stxAddress.slice(0, 10);
        log(`created contact #${id}: ${name}`);
        created++;
        continue;
      }

      // Check if existing contact needs updating
      const updates: Record<string, string | null> = {};

      if (agent.displayName && !existing.display_name) {
        updates.display_name = agent.displayName;
      }
      if (agent.displayName && !existing.aibtc_name) {
        updates.aibtc_name = agent.displayName;
      }
      if (agent.bnsName && !existing.bns_name) {
        updates.bns_name = agent.bnsName;
      }
      if (agent.taprootAddress && !existing.taproot_address) {
        updates.taproot_address = agent.taprootAddress;
      }
      if (agent.erc8004AgentId && !existing.agent_id) {
        updates.agent_id = agent.erc8004AgentId;
      }
      if (agent.levelName && existing.aibtc_level !== agent.levelName) {
        updates.aibtc_level = agent.levelName;
      }
      // Fill in missing addresses
      if (agent.stxAddress && !existing.stx_address) {
        updates.stx_address = agent.stxAddress;
      }
      if (agent.btcAddress && !existing.btc_address) {
        updates.btc_address = agent.btcAddress;
      }

      if (Object.keys(updates).length > 0) {
        updateContact(existing.id, updates);
        log(`updated contact #${existing.id} (${Object.keys(updates).join(", ")})`);
        updated++;
      } else {
        skipped++;
      }
    }

    log(`sync complete: ${created} created, ${updated} updated, ${skipped} unchanged (${agents.length} total)`);

    // Persist sync stats in hook state
    const state = await readHookState(SENSOR_NAME);
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: state ? state.version + 1 : 1,
      last_sync_total: agents.length,
      last_sync_created: created,
      last_sync_updated: updated,
    });

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
