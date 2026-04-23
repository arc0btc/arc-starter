// skills/aibtc-welcome/sensor.ts
// Detects newly registered AIBTC agents and creates welcome tasks.
// Cadence: 30 minutes. Pure detection — no LLM, no wallet ops.
// Welcome execution happens via script dispatch (cli.ts: stx-send -> x402 -> contacts log).

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  insertTaskIfNew,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import {
  completedTaskExistsForSourceSubstring,
  countCompletedTodayForSourcePrefix,
  getDatabase,
  recentTaskExistsForSource,
} from "../../src/db.ts";
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

/** Max welcome tasks created per sensor cycle — prevents queue flood after long freezes */
const BATCH_CAP = 3;

/** If more than this many welcome tasks completed today, skip creating more */
const DAILY_COMPLETED_CAP = 10;

/** Stable source prefix — does NOT include sensor name so it survives renames */
const SOURCE_PREFIX = "welcome:";


// Arc's own STX address — never welcome ourselves
const SELF_STX = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

// Known agent display name patterns — skip welcoming our own agents
const KNOWN_AGENT_NAMES: ReadonlySet<string> = new Set([
  "arc", "spark", "iris", "loom", "forge",
  "topaz centaur", "fractal hydra", "sapphire mars", // AIBTC identities
]);

/**
 * STX addresses confirmed valid by c32check but rejected by Hiro broadcast API.
 * These addresses are in the agent registry but any STX send to them returns Hiro 400.
 * Source: tasks #11448 and #11449 — x402 staged OK but STX send rejected.
 */
const HIRO_REJECTED_STX_ADDRESSES: ReadonlySet<string> = new Set([
  "SP29ZMVTK1HFJF44AK5RW8122AW1JFQCV1BJGEPG1",
  "SP11XB256JGVZ6XZDX65EF6JR89VK9SNM7ZN0P77W",
  // broadcast-invalid: valid c32 format but Hiro deny-list rejects broadcast (tasks #12336/#12348)
  "SP31YV5KJ87WAHSSX46K943XBTTAVZ5XQDMW6BK3H",
  "SP1GQYKZQ772K5H5667NDTRTNYKWKPZSSM8EVFRZT",
]);

/** Hook state key for the auto-populated dynamic Hiro-rejected address deny-list */
const HIRO_REJECTED_HOOK_KEY = "aibtc-welcome-hiro-rejected";

/**
 * Stacks mainnet SP address: "SP" + exactly 39 c32-encoding characters (41 chars total).
 * c32 alphabet: 0-9 A-H J K M N P-T V-Z (32 chars — no lowercase, no I L O U).
 * Catches wrong-length addresses and wrong-network addresses (ST = testnet, SM = mocknet).
 */
const STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/;

interface HiroRejectedState {
  addresses: string[];
  updated_at: string;
}

/**
 * Validates a STX mainnet address before queuing a welcome task.
 *
 * Three-layer check:
 * 1. Strict regex — SP prefix + exactly 39 c32 chars (41 total). Fast rejection without network calls.
 * 2. Hardcoded deny-list — addresses confirmed Hiro-rejected (tasks #11448/#11449).
 * 3. Dynamic deny-list — auto-populated from failed welcome tasks with Hiro 400 errors.
 *
 * Returns { valid: true } or { valid: false; reason: string }.
 */
function checkStxAddress(
  addr: string,
  dynamicDenyList: ReadonlySet<string>,
): { valid: true } | { valid: false; reason: string } {
  if (!STX_MAINNET_REGEX.test(addr)) {
    return {
      valid: false,
      reason: "failed strict SP-mainnet regex (must be SP + 39 c32 chars, 41 chars total)",
    };
  }
  if (HIRO_REJECTED_STX_ADDRESSES.has(addr)) {
    return { valid: false, reason: "in hardcoded Hiro-rejected deny-list (tasks #11448/#11449)" };
  }
  if (dynamicDenyList.has(addr)) {
    return {
      valid: false,
      reason: "in dynamic Hiro-rejected deny-list (auto-populated from task failures)",
    };
  }
  return { valid: true };
}

/**
 * Loads the dynamic Hiro-rejected address deny-list from hook state and auto-populates
 * it by scanning failed welcome tasks for Hiro 400 errors.
 *
 * Replaces probeHiroStxAddress(): Hiro's GET /v2/accounts/{addr} returns HTTP 200 for
 * broadcast-invalid addresses (confirmed via curl on SP32GT7FT92Z5HTBMY5KKBBFFEZD0AZG5H1ZW8E61),
 * so per-address probing cannot detect broadcast-invalid addresses.
 *
 * Self-healing instead: when a welcome task fails with Hiro 400, the source STX address
 * is discovered here and added to the deny-list so the sensor skips it permanently.
 *
 * Returns the updated deny-list set and a dirty flag (true if new addresses were added).
 */
async function loadAndUpdateDenyList(): Promise<{ denyList: Set<string>; dirty: boolean }> {
  const state = (await readHookState(HIRO_REJECTED_HOOK_KEY)) as HiroRejectedState | null;
  const denyList = new Set<string>(state?.addresses ?? []);
  let dirty = false;

  const db = getDatabase();
  const failedTasks = db
    .query(
      `SELECT source, result_summary FROM tasks
       WHERE source LIKE ? || '%'
       AND status = 'failed'
       AND (
         result_summary LIKE '%Hiro 400%'
         OR result_summary LIKE '%400 Bad Request%'
         OR result_summary LIKE '%params/principal must match pattern%'
         OR result_summary LIKE '%broadcast-invalid%'
         OR result_summary LIKE '%FST_ERR_VALIDATION%'
         OR result_summary LIKE '%simulation:400%'
         OR result_summary LIKE '%simulation 400%'
         OR result_summary LIKE '%STX send failed%'
       )`,
    )
    .all(SOURCE_PREFIX) as { source: string; result_summary: string | null }[];

  for (const task of failedTasks) {
    const stx = task.source.replace(SOURCE_PREFIX, "");
    if (
      stx.startsWith("SP") &&
      !denyList.has(stx) &&
      !HIRO_REJECTED_STX_ADDRESSES.has(stx)
    ) {
      denyList.add(stx);
      dirty = true;
      log(`auto-deny-list: adding ${stx} (found in failed Hiro 400 welcome task)`);
    }
  }

  return { denyList, dirty };
}

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
  reconciled?: boolean; // true after one-time old-source migration
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

/**
 * One-time reconciliation: merge STX addresses from old-source completed tasks
 * (sensor:social-agent-engagement:welcome-*) into the welcomed_agents set.
 * Old source used BTC addresses as keys; we extract STX from task descriptions.
 */
function reconcileOldSourceTasks(welcomedSet: Set<string>): void {
  const db = getDatabase();

  // Old completed tasks with BTC-keyed source
  const oldTasks = db
    .query(
      `SELECT description FROM tasks
       WHERE source LIKE 'sensor:social-agent-engagement:welcome-%'
       AND status = 'completed'`
    )
    .all() as { description: string | null }[];

  let added = 0;
  for (const task of oldTasks) {
    if (!task.description) continue;
    const match = task.description.match(/STX: (SP[A-Z0-9]{38,40})/);
    if (match && !welcomedSet.has(match[1])) {
      welcomedSet.add(match[1]);
      added++;
    }
  }

  // Also reconcile new-source completed tasks (sensor:aibtc-welcome:*)
  const newTasks = db
    .query(
      `SELECT source FROM tasks
       WHERE source LIKE 'sensor:aibtc-welcome:%'
       AND status = 'completed'`
    )
    .all() as { source: string }[];

  for (const task of newTasks) {
    const stx = task.source.replace("sensor:aibtc-welcome:", "");
    if (stx.startsWith("SP") && !welcomedSet.has(stx)) {
      welcomedSet.add(stx);
      added++;
    }
  }

  log(`reconciliation: added ${added} STX addresses from old-source completed tasks`);
}


export default async function aibtcWelcomeSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    // Daily completed gate: if >10 welcome tasks completed today, skip
    const completedToday = countCompletedTodayForSourcePrefix(SOURCE_PREFIX);
    if (completedToday >= DAILY_COMPLETED_CAP) {
      log(`daily cap reached: ${completedToday} welcome tasks completed today (cap=${DAILY_COMPLETED_CAP}) — skipping`);
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

    // One-time reconciliation: merge old-source completed tasks into welcomed set
    if (!state?.reconciled) {
      reconcileOldSourceTasks(welcomedSet);
    }

    initContactsSchema();

    // Load dynamic deny-list and auto-populate from failed tasks
    let { denyList: dynamicDenyList, dirty: denyListDirty } = await loadAndUpdateDenyList();

    let tasksCreated = 0;

    for (const agent of agents) {
      // Batch cap: stop creating tasks once we hit the per-cycle limit
      if (tasksCreated >= BATCH_CAP) {
        log(`batch cap reached (${BATCH_CAP}) — remaining agents deferred to next cycle`);
        break;
      }

      // Skip if missing addresses
      if (!agent.stxAddress || !agent.btcAddress) continue;

      // Validate STX address before creating any task — prevents Hiro 400 failures at dispatch.
      // Three layers: strict regex (Layer 1) + hardcoded deny-list (Layer 2) + dynamic deny-list (Layer 3).
      const stxCheck = checkStxAddress(agent.stxAddress, dynamicDenyList);
      if (!stxCheck.valid) {
        welcomedSet.add(agent.stxAddress); // mark so we don't log every cycle
        // Also add to dynamic deny-list for resilience — double-guards against hook-state resets.
        // This covers addresses that fail the regex at sensor time (never dispatched, so
        // loadAndUpdateDenyList() would never discover them from failed-task scanning alone).
        if (!dynamicDenyList.has(agent.stxAddress) && !HIRO_REJECTED_STX_ADDRESSES.has(agent.stxAddress)) {
          dynamicDenyList.add(agent.stxAddress);
          denyListDirty = true;
        }
        log(`skipping ${agent.stxAddress}: invalid STX address — ${stxCheck.reason}`);
        continue;
      }

      // Skip self
      if (agent.stxAddress === SELF_STX) continue;

      // Skip known agents by name match
      const lowerName = (agent.displayName ?? "").toLowerCase();
      if ([...KNOWN_AGENT_NAMES].some((n) => lowerName.includes(n))) continue;

      // Skip if already in welcomed set
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

      // Stable source key: welcome:{stxAddress} — survives sensor renames
      const source = `${SOURCE_PREFIX}${agent.stxAddress}`;

      // Dedup: if a task for this agent was created in the last 24h, skip
      if (recentTaskExistsForSource(source, 24 * 60)) {
        log(`skipping ${name} — welcome task exists within 24h`);
        continue;
      }

      const scriptCmd = [
        `arc skills run --name aibtc-welcome -- welcome`,
        `--stx-address ${agent.stxAddress}`,
        `--btc-address ${agent.btcAddress}`,
        `--contact-id ${contact?.id ?? "?"}`,
        `--name "${name.replace(/"/g, '\\"')}"`,
      ].join(" ");

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
          ]
            .filter((line) => line !== "")
            .join("\n"),
          script: scriptCmd,
          model: "script",
          priority: 7,
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

    // Persist updated deny-list if new addresses were discovered from failed tasks
    if (denyListDirty) {
      await writeHookState(HIRO_REJECTED_HOOK_KEY, {
        addresses: [...dynamicDenyList],
        updated_at: new Date().toISOString(),
      } satisfies HiroRejectedState);
      log(`auto-deny-list: persisted ${dynamicDenyList.size} Hiro-rejected addresses`);
    }

    // Persist state with reconciliation flag
    const updatedWelcomed = [...welcomedSet];
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state?.version ?? 0) + 1,
      welcomed_agents: updatedWelcomed,
      total_welcomed: updatedWelcomed.length,
      reconciled: true,
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
