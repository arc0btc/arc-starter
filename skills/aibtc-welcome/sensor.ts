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

/**
 * Self-healing: check if x402 relay is actually functional — not just reachable.
 *
 * Three-layer probe:
 * 1. /health — relay process is alive
 * 2. /supported — relay is actively serving requests (not just a static health response)
 * 3. /status/sponsor — covers all 10 pool wallets; replaces per-wallet Hiro nonce check.
 *    Returns canSponsor:bool + status:'healthy'|'degraded'. Pass only if both are affirmative.
 *    This avoids direct Hiro API calls from arc-starter and covers the full pool, not just wallet 0.
 *
 * Returns true only when all three probes pass.
 */
async function isRelayHealthy(): Promise<boolean> {
  try {
    // Probe 1: relay /health endpoint
    const hc = new AbortController();
    const ht = setTimeout(() => hc.abort(), 10_000);
    const healthResp = await fetch(`${RELAY_URL}/health`, { signal: hc.signal });
    clearTimeout(ht);
    if (!healthResp.ok) return false;

    // Probe 2: relay /supported endpoint — proves relay is actively serving beyond a static ping.
    // This endpoint returns supported payment kinds and is cheap (no side-effects).
    const sc = new AbortController();
    const st = setTimeout(() => sc.abort(), 10_000);
    const supportedResp = await fetch(`${RELAY_URL}/supported`, { signal: sc.signal });
    clearTimeout(st);
    if (!supportedResp.ok) return false;

    // Probe 3: /status/sponsor — relay-aggregated health across all 10 pool wallets.
    // Replaces direct Hiro nonce check (wallet 0 only). Relay computes canSponsor and
    // status from its full pool state — single call, no Hiro dependency from arc-starter.
    const nc = new AbortController();
    const nt = setTimeout(() => nc.abort(), 10_000);
    const sponsorResp = await fetch(`${RELAY_URL}/status/sponsor`, { signal: nc.signal });
    clearTimeout(nt);
    if (!sponsorResp.ok) return false;

    const sponsor = (await sponsorResp.json()) as {
      canSponsor: boolean;
      status: string;
    };

    if (sponsor.status !== "healthy" || !sponsor.canSponsor) return false;

    return true;
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
    // Re-enabled 2026-04-10: task flood safeguards in place (BATCH_CAP=3, DAILY_CAP=10, 24h dedup, relay circuit-breaker)
    // STX address pre-validation + HIRO_REJECTED_STX_ADDRESSES prevents credit burn on invalid addresses
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

      // Gate 2: failures since sentinel was written — not just the last 4h.
      // Bug: using a fixed 4h window meant failures from the triggering batch fell
      // outside the window by the time the 4h cooldown expired, so Gate 2 always passed.
      // Fix: count failures across the full period since the sentinel was written (+1h buffer).
      const sentinelAgeHours = sentinelAgeMs / 3_600_000;
      const failureWindowHours = Math.max(sentinelAgeHours + 1, SELF_HEAL_COOLDOWN_HOURS);
      const recentFailures = countRecentNonceFailures(failureWindowHours);
      if (recentFailures >= SELF_HEAL_FAILURE_THRESHOLD) {
        log(`${recentFailures} NONCE_CONFLICT failures in last ${failureWindowHours.toFixed(1)}h — keeping sentinel, incrementing backoff`);
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

    // Load dynamic deny-list and auto-populate from failed tasks
    const { denyList: dynamicDenyList, dirty: denyListDirty } = await loadAndUpdateDenyList();

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
            "**CRITICAL ORDER: STX send MUST run before x402. If STX fails, do NOT attempt x402.**",
            "Reason: x402 burns credits on undeliverable agents. A failed STX send means the address",
            "is invalid or Hiro-rejected — do not pay for inbox delivery to an unreachable recipient.",
            "",
            "1. Send 0.1 STX welcome transfer FIRST (validates address before spending x402):",
            "```",
            `arc skills run --name bitcoin-wallet -- stx-send \\`,
            `  --recipient ${agent.stxAddress} \\`,
            `  --amount-stx 0.1 \\`,
            `  --memo "welcome from arc0.btc"`,
            "```",
            "",
            "If STX send fails for ANY reason, close this task as **failed** immediately — do NOT proceed to x402.",
            "",
            "2. Only if STX succeeded — send x402 welcome message:",
            "```",
            `arc skills run --name bitcoin-wallet -- x402 send-inbox-message \\`,
            `  --recipient-btc-address ${agent.btcAddress} \\`,
            `  --recipient-stx-address ${agent.stxAddress} \\`,
            `  --content "${welcomeMessage}"`,
            "```",
            "",
            "3. Log the interaction in contacts:",
            "```",
            `arc skills run --name contacts -- interact \\`,
            `  --contact-id ${contact?.id ?? "?"} \\`,
            `  --type message \\`,
            `  --summary "Sent 0.1 STX welcome transfer + x402 welcome message"`,
            "```",
            "",
            "## IMPORTANT — failure handling",
            "",
            "If STX send fails with Hiro 400 or address validation error:",
            "- Close immediately as **failed** — do NOT attempt x402",
            "- Include the EXACT JSON error output verbatim in the summary",
            "",
            "If x402 send fails with NONCE_CONFLICT or ConflictingNonceInMempool:",
            "- Write sentinel: `echo '{\"last_ran\":\"'$(date -u +%FT%TZ)'\",\"last_result\":\"error\",\"version\":1}' > db/hook-state/x402-nonce-conflict.json`",
            "- Close this task as **failed** with summary mentioning NONCE_CONFLICT",
            "",
            "For any other failure, close as **failed** with the EXACT JSON output from the failed command — do NOT paraphrase. Include the `error` and `detail` fields verbatim so root cause is diagnosable.",
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
          model: "sonnet",
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
