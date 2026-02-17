/**
 * AIBTC Balance Sensor
 *
 * Monitors STX, BTC, and sBTC balances every 30 minutes, emitting
 * sensor:observation only when a balance has changed since the last check.
 *
 * Pattern:
 * - Fetch current balances from Stacks API (or AIBTC MCP tools)
 * - Compare against last known balances stored in agent_state (SQLite)
 * - Emit sensor:observation only if any balance changed
 * - Update agent_state with new balances
 *
 * Balance sources:
 * This sensor uses the public Stacks Blockchain API by default.
 * For production, prefer using @aibtc/mcp-server MCP tools which handle
 * authentication and provide richer data. See: https://github.com/aibtcdev/aibtc-mcp-server
 *
 * MCP tool alternatives:
 * - `get_stx_balance`  → STX balance for a Stacks address
 * - `get_btc_balance`  → BTC balance for a Bitcoin address
 * - `sbtc_get_balance` → sBTC balance for a Stacks address
 *
 * Registration (add to src/index.ts):
 * ```typescript
 * import { observeBalances } from "./sensors/aibtc-balance";
 * import { scheduler, minutes } from "./server/scheduler";
 *
 * scheduler.register({
 *   name: "aibtc-balance",
 *   intervalMs: minutes(30),
 *   fn: observeBalances,
 * });
 * ```
 */

import { eventBus } from "../server/events";
import { getDb } from "../memory/db";
import { writeEvent } from "../memory/event-history";

/**
 * AIBTC config shape (subset of config/example-config.json)
 */
interface AibtcConfig {
  stxAddress?: string;
  btcAddress?: string;
  aibtcApiBase?: string;
}

/**
 * Balance snapshot for a single check
 */
export interface BalanceSnapshot {
  stx: string | null; // microSTX as string (large integer)
  btc: string | null; // satoshis as string
  sbtc: string | null; // sBTC in microSTX-equivalent units
  fetchedAt: string;
}

/**
 * Data emitted in a sensor:observation on balance change
 */
export interface BalanceObservationData {
  stxAddress: string;
  btcAddress?: string;
  previous: BalanceSnapshot | null;
  current: BalanceSnapshot;
  changed: {
    stx: boolean;
    btc: boolean;
    sbtc: boolean;
  };
  error?: string;
}

/**
 * Observation returned by this sensor
 */
export interface BalanceObservation {
  source: "aibtc-balance";
  timestamp: number;
  data: BalanceObservationData & { noChange?: boolean };
}

/**
 * Load AIBTC config from the project config file.
 * Falls back gracefully if the file doesn't exist or is missing keys.
 */
async function loadConfig(): Promise<AibtcConfig> {
  try {
    const configPath = new URL("../../config/config.json", import.meta.url);
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      const examplePath = new URL(
        "../../config/example-config.json",
        import.meta.url
      );
      const example = await Bun.file(examplePath).json();
      return (example.aibtc as AibtcConfig) ?? {};
    }
    const config = await file.json();
    return (config.aibtc as AibtcConfig) ?? {};
  } catch {
    return {};
  }
}

/**
 * Read the last known balances from agent_state.
 * Returns null if no previous snapshot exists.
 */
function loadPreviousSnapshot(): BalanceSnapshot | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM agent_state WHERE key = 'balance_snapshot'")
      .get() as { value: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.value) as BalanceSnapshot;
  } catch {
    return null;
  }
}

/**
 * Persist the current balance snapshot to agent_state.
 */
function saveSnapshot(snapshot: BalanceSnapshot): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO agent_state (key, value, updated_at)
     VALUES ('balance_snapshot', ?, ?)`
  ).run(JSON.stringify(snapshot), new Date().toISOString());
}

/**
 * Fetch STX balance for a Stacks address from the public Stacks API.
 * Returns balance in microSTX as a string, or null on error.
 *
 * Production note: Replace this with an MCP tool call for better
 * reliability and access to testnet/mainnet switching:
 *   const result = await mcpClient.callTool("get_stx_balance", { address });
 */
async function fetchStxBalance(stxAddress: string): Promise<string | null> {
  try {
    const url = `https://api.hiro.so/v2/accounts/${encodeURIComponent(stxAddress)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    // API returns { balance: "0x...", ... } — convert hex to decimal string
    const balanceHex = data.balance as string;
    if (!balanceHex) return null;
    return BigInt(balanceHex).toString();
  } catch {
    return null;
  }
}

/**
 * Fetch sBTC balance for a Stacks address.
 * Uses the AIBTC API endpoint. Returns null on error.
 *
 * Production note: Replace with MCP tool call:
 *   const result = await mcpClient.callTool("sbtc_get_balance", { address });
 */
async function fetchSbtcBalance(
  apiBase: string,
  stxAddress: string
): Promise<string | null> {
  try {
    const url = `${apiBase}/sbtc/balance/${encodeURIComponent(stxAddress)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const balance = data.balance ?? data.amount;
    return balance !== undefined ? String(balance) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch BTC balance for a Bitcoin address.
 * Uses the mempool.space API. Returns null on error.
 *
 * Production note: Replace with MCP tool call:
 *   const result = await mcpClient.callTool("get_btc_balance", { address });
 */
async function fetchBtcBalance(btcAddress: string): Promise<string | null> {
  try {
    const url = `https://mempool.space/api/address/${encodeURIComponent(btcAddress)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    // mempool.space returns { chain_stats: { funded_txo_sum, spent_txo_sum } }
    const stats = data.chain_stats as
      | Record<string, number>
      | undefined;
    if (!stats) return null;
    const balance = (stats.funded_txo_sum ?? 0) - (stats.spent_txo_sum ?? 0);
    return balance.toString();
  } catch {
    return null;
  }
}

/**
 * Observe: check balances and emit if any have changed.
 *
 * Compares current balances against the last snapshot in agent_state.
 * If nothing changed, returns an observation with noChange=true
 * and does NOT emit a sensor:observation event (to avoid noise).
 *
 * Skips gracefully if stxAddress is not configured.
 */
export async function observeBalances(): Promise<BalanceObservation> {
  const config = await loadConfig();
  const now = Date.now();
  const fetchedAt = new Date(now).toISOString();

  // Fail gracefully if not configured
  if (!config.stxAddress) {
    const observation: BalanceObservation = {
      source: "aibtc-balance",
      timestamp: now,
      data: {
        stxAddress: "",
        previous: null,
        current: { stx: null, btc: null, sbtc: null, fetchedAt },
        changed: { stx: false, btc: false, sbtc: false },
        error: "not configured: missing aibtc.stxAddress in config",
      },
    };
    return observation;
  }

  const apiBase = config.aibtcApiBase ?? "https://aibtc.com/api";
  const stxAddress = config.stxAddress;
  const btcAddress = config.btcAddress;

  // Load previous snapshot before fetching
  const previous = loadPreviousSnapshot();

  // Fetch current balances (in parallel for speed)
  const [stx, sbtc, btc] = await Promise.all([
    fetchStxBalance(stxAddress),
    fetchSbtcBalance(apiBase, stxAddress),
    btcAddress ? fetchBtcBalance(btcAddress) : Promise.resolve(null),
  ]);

  const current: BalanceSnapshot = { stx, btc, sbtc, fetchedAt };

  // Detect changes
  const changed = {
    stx: previous?.stx !== stx,
    btc: previous?.btc !== btc,
    sbtc: previous?.sbtc !== sbtc,
  };

  const anyChanged = changed.stx || changed.btc || changed.sbtc;

  // Always save the latest snapshot
  saveSnapshot(current);

  const observationData: BalanceObservationData = {
    stxAddress,
    ...(btcAddress ? { btcAddress } : {}),
    previous,
    current,
    changed,
  };

  const observation: BalanceObservation = {
    source: "aibtc-balance",
    timestamp: now,
    data: {
      ...observationData,
      // Flag no-change observations so callers can skip them
      ...(anyChanged ? {} : { noChange: true }),
    },
  };

  // Only emit and record if something changed
  if (anyChanged) {
    eventBus.emit("sensor:observation", {
      source: observation.source,
      data: observation.data,
    });

    writeEvent({
      timestamp: fetchedAt,
      eventType: "sensor:observation",
      source: "aibtc-balance",
      payload: { stx, btc, sbtc, changed },
    });
  }

  return observation;
}
