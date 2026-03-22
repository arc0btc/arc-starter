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

/** Self-healing gates: prevent clearing sentinel when x402 is still broken */
const SELF_HEAL_COOLDOWN_HOURS = 4;
const SELF_HEAL_FAILURE_THRESHOLD = 3;

/** Sentinel file: if present, x402 relay has a nonce conflict — skip creating welcome tasks */
const NONCE_SENTINEL = "x402-nonce-conflict";
const RELAY_URL = "https://x402-relay.aibtc.com";
const SPONSOR_ADDRESS = "SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7";

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
  reconciled?: boolean; // true after one-time old-source migration
}

/**
 * Self-healing: check if x402 relay is actually healthy despite a stale sentinel.
 * Returns true if relay is reachable AND sponsor has no nonce gaps.
 */
async function isRelayHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(`${RELAY_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return false;

    // Check sponsor nonce status for gaps
    const nc = new AbortController();
    const nt = setTimeout(() => nc.abort(), 10_000);
    const nonceResp = await fetch(
      `https://api.mainnet.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/nonces`,
      { signal: nc.signal },
    );
    clearTimeout(nt);
    if (!nonceResp.ok) return false;

    const nonces = (await nonceResp.json()) as {
      detected_missing_nonces: number[];
      detected_mempool_nonces: number[];
    };

    // Healthy = no missing nonces and mempool not congested
    return nonces.detected_missing_nonces.length === 0 && nonces.detected_mempool_nonces.length <= 5;
  } catch {
    return false;
  }
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
    const match = task.description.match(/STX: (SP[A-Z0-9]+)/);
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

/**
 * Count recent welcome task failures mentioning NONCE_CONFLICT.
 * Used to prevent self-healing when x402 is still broken despite relay /health saying OK.
 */
function countRecentNonceFailures(withinHours: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
  const row = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE source LIKE ? || '%'
       AND status = 'failed'
       AND result_summary LIKE '%NONCE%CONFLICT%'
       AND completed_at >= ?`,
    )
    .get(SOURCE_PREFIX, cutoff) as { count: number } | null;
  return row?.count ?? 0;
}

export default async function aibtcWelcomeSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    // Circuit breaker: skip if x402 relay has nonce conflict — with self-healing
    const nonceSentinel = await readHookState(NONCE_SENTINEL);
    if (nonceSentinel && nonceSentinel.last_result === "error") {
      const sentinelAgeMs = Date.now() - new Date(nonceSentinel.last_ran).getTime();
      const healAttempts = (nonceSentinel.heal_attempts as number) ?? 0;
      // Exponential backoff: 4h base, doubles each failed self-heal (max 64h)
      const effectiveCooldownMs =
        SELF_HEAL_COOLDOWN_HOURS * 60 * 60 * 1000 * Math.pow(2, Math.min(healAttempts, 4));

      // Gate 1: cooldown — don't attempt self-heal if sentinel is too fresh
      if (sentinelAgeMs < effectiveCooldownMs) {
        const hoursLeft = ((effectiveCooldownMs - sentinelAgeMs) / 3_600_000).toFixed(1);
        log(`nonce sentinel active (${hoursLeft}h cooldown remaining, ${healAttempts} failed heals) — skipping`);
        return "skip";
      }

      // Gate 2: recent failure rate — don't clear sentinel if tasks are still failing
      const recentFailures = countRecentNonceFailures(SELF_HEAL_COOLDOWN_HOURS);
      if (recentFailures >= SELF_HEAL_FAILURE_THRESHOLD) {
        log(`${recentFailures} NONCE_CONFLICT failures in last ${SELF_HEAL_COOLDOWN_HOURS}h — keeping sentinel, incrementing backoff`);
        await writeHookState(NONCE_SENTINEL, {
          ...nonceSentinel,
          last_ran: new Date().toISOString(),
          heal_attempts: healAttempts + 1,
        });
        return "skip";
      }

      // Gate 3: relay health — structural check
      log("x402 nonce conflict sentinel active — checking relay health for self-healing");
      const healthy = await isRelayHealthy();
      if (!healthy) {
        log("relay still unhealthy — skipping welcome task creation");
        return "skip";
      }

      // All gates passed — clear sentinel and proceed
      log("relay healthy + no recent failures — clearing nonce sentinel");
      await writeHookState(NONCE_SENTINEL, {
        last_ran: new Date().toISOString(),
        last_result: "ok",
        version: (nonceSentinel.version ?? 1) + 1,
        cleared_by: "sensor:aibtc-welcome:self-heal",
        heal_attempts: 0,
      });
    }

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

    let tasksCreated = 0;

    for (const agent of agents) {
      // Batch cap: stop creating tasks once we hit the per-cycle limit
      if (tasksCreated >= BATCH_CAP) {
        log(`batch cap reached (${BATCH_CAP}) — remaining agents deferred to next cycle`);
        break;
      }

      // Skip if missing addresses
      if (!agent.stxAddress || !agent.btcAddress) continue;

      // Skip self
      if (agent.stxAddress === SELF_STX) continue;

      // Skip fleet agents by name match
      const lowerName = (agent.displayName ?? "").toLowerCase();
      if ([...FLEET_NAMES].some((n) => lowerName.includes(n))) continue;

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
            "",
            "For any other x402/STX failure, close as **failed** with a note about what failed.",
            "",
            "## DO NOT create retry or follow-up tasks",
            "",
            "**Under no circumstances should you create a retry, follow-up, or re-queue task.**",
            "The sensor automatically re-creates welcome tasks for agents that were not",
            "successfully welcomed. Manual retries cause task floods.",
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
