// skills/defi-balance/sensor.ts
//
// Monitors STX and sBTC balances via Hiro API every 5 minutes.
// Creates tasks on: first-run baseline, balance drops below threshold,
// or significant change detected (>5% shift from previous run).
//
// State between runs is stored in db/hook-state/defi-balance-prev.json.
// No external dependencies — uses Bun's built-in fetch.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, taskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "defi-balance";
const INTERVAL_MINUTES = 5;

// Hiro public API — no key required for basic balance queries
const HIRO_BASE = "https://api.hiro.so";

// sBTC token contract on mainnet
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Alert thresholds
const STX_LOW_THRESHOLD_MICRO = 1_000_000; // 1 STX in microSTX
const SBTC_LOW_THRESHOLD_SATS = 1_000;     // 0.00001 BTC in satoshis
const CHANGE_THRESHOLD_PCT = 0.05;          // 5%

// State file — sibling to other hook-state files
const PREV_STATE_FILE = new URL("../../db/hook-state/defi-balance-prev.json", import.meta.url).pathname;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [defi-balance/sensor] ${msg}`);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Types ----

interface BalanceState {
  stxBalance: number;   // microSTX
  sbtcBalance: number;  // satoshis
  capturedAt: string;   // ISO timestamp
}

interface HiroStxResponse {
  balance: string;
  locked: string;
  unlock_height: number;
  nonce: number;
}

interface HiroBalancesResponse {
  fungible_tokens: Record<string, { balance: string }>;
}

// ---- State persistence ----

async function readPrevState(): Promise<BalanceState | null> {
  try {
    const file = Bun.file(PREV_STATE_FILE);
    if (!(await file.exists())) return null;
    return (await file.json()) as BalanceState;
  } catch {
    return null;
  }
}

async function writePrevState(state: BalanceState): Promise<void> {
  await Bun.write(PREV_STATE_FILE, JSON.stringify(state));
}

// ---- Hiro API helpers ----

async function fetchStxBalance(address: string): Promise<number | null> {
  try {
    const resp = await fetch(`${HIRO_BASE}/extended/v1/address/${address}/stx`);
    if (!resp.ok) {
      log(`STX balance API returned ${resp.status} for ${address}`);
      return null;
    }
    const body = (await resp.json()) as HiroStxResponse;
    const micro = parseInt(body.balance, 10);
    return isNaN(micro) ? null : micro;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`STX balance fetch failed: ${msg}`);
    return null;
  }
}

async function fetchSbtcBalance(address: string): Promise<number | null> {
  try {
    const resp = await fetch(`${HIRO_BASE}/extended/v1/address/${address}/balances`);
    if (!resp.ok) {
      log(`Balances API returned ${resp.status} for ${address}`);
      return null;
    }
    const body = (await resp.json()) as HiroBalancesResponse;
    const sbtcEntry = body.fungible_tokens?.[SBTC_CONTRACT];
    if (!sbtcEntry) return 0; // no sBTC held — valid zero balance
    const sats = parseInt(sbtcEntry.balance, 10);
    return isNaN(sats) ? null : sats;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`sBTC balance fetch failed: ${msg}`);
    return null;
  }
}

// ---- Change detection ----

function significantChange(prev: number, curr: number, threshold: number): boolean {
  if (prev === 0) return curr !== 0; // any movement from zero is significant
  const pct = Math.abs(curr - prev) / prev;
  return pct >= threshold;
}

// ---- Sensor entry point ----

export default async function defiBalanceSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Resolve address from environment
  const address = process.env.DEFI_BALANCE_ADDRESS ?? process.env.STX_ADDRESS ?? "";
  if (!address) {
    log("no STX address configured — set DEFI_BALANCE_ADDRESS or STX_ADDRESS env var");
    return "ok";
  }

  // Fetch current balances
  const [stxBalance, sbtcBalance] = await Promise.all([
    fetchStxBalance(address),
    fetchSbtcBalance(address),
  ]);

  if (stxBalance === null && sbtcBalance === null) {
    log("both balance fetches failed — skipping task creation");
    return "ok";
  }

  const stx = stxBalance ?? 0;
  const sbtc = sbtcBalance ?? 0;
  const today = todayDateString();

  log(`balances — STX: ${stx} microSTX, sBTC: ${sbtc} sats`);

  // Load previous state
  const prev = await readPrevState();

  // Persist current state for next run
  await writePrevState({
    stxBalance: stx,
    sbtcBalance: sbtc,
    capturedAt: new Date().toISOString(),
  });

  // ---- First run: capture baseline ----
  if (prev === null) {
    const baselineSource = "sensor:defi-balance:baseline";
    if (!taskExistsForSource(baselineSource)) {
      const stxDisplay = (stx / 1_000_000).toFixed(6);
      const sbtcDisplay = (sbtc / 100_000_000).toFixed(8);
      insertTask({
        subject: `DeFi balance baseline captured — ${stxDisplay} STX, ${sbtcDisplay} BTC (sBTC)`,
        description: [
          `First run of defi-balance sensor for address ${address}.`,
          "",
          `STX balance:  ${stxDisplay} STX (${stx} microSTX)`,
          `sBTC balance: ${sbtcDisplay} BTC (${sbtc} satoshis)`,
          "",
          "No action needed. Subsequent runs will alert on significant changes (>5%) or low balances.",
        ].join("\n"),
        source: baselineSource,
        priority: 7,
        skills: '["defi-balance"]',
      });
      log(`baseline task created for ${address}`);
    }
    return "ok";
  }

  // ---- STX change alert ----
  if (stxBalance !== null && significantChange(prev.stxBalance, stx, CHANGE_THRESHOLD_PCT)) {
    const source = `sensor:defi-balance:stx-change:${today}`;
    if (!pendingTaskExistsForSource(source)) {
      const prevDisplay = (prev.stxBalance / 1_000_000).toFixed(6);
      const currDisplay = (stx / 1_000_000).toFixed(6);
      const delta = stx - prev.stxBalance;
      const direction = delta > 0 ? "increased" : "decreased";
      const pct = prev.stxBalance > 0
        ? ((Math.abs(delta) / prev.stxBalance) * 100).toFixed(1)
        : "N/A";
      insertTask({
        subject: `DeFi alert: STX balance ${direction} by ${pct}% — now ${currDisplay} STX`,
        description: [
          `STX balance changed significantly for address ${address}.`,
          "",
          `Previous: ${prevDisplay} STX (${prev.stxBalance} microSTX)`,
          `Current:  ${currDisplay} STX (${stx} microSTX)`,
          `Change:   ${delta > 0 ? "+" : ""}${(delta / 1_000_000).toFixed(6)} STX (${direction} ${pct}%)`,
          "",
          `Captured at: ${new Date().toISOString()}`,
          "Review recent transactions to confirm expected activity.",
        ].join("\n"),
        source,
        priority: 5,
        skills: '["defi-balance"]',
      });
      log(`STX change task created — ${prevDisplay} -> ${currDisplay} STX (${direction} ${pct}%)`);
    }
  }

  // ---- sBTC change alert ----
  if (sbtcBalance !== null && significantChange(prev.sbtcBalance, sbtc, CHANGE_THRESHOLD_PCT)) {
    const source = `sensor:defi-balance:sbtc-change:${today}`;
    if (!pendingTaskExistsForSource(source)) {
      const prevDisplay = (prev.sbtcBalance / 100_000_000).toFixed(8);
      const currDisplay = (sbtc / 100_000_000).toFixed(8);
      const delta = sbtc - prev.sbtcBalance;
      const direction = delta > 0 ? "increased" : "decreased";
      const pct = prev.sbtcBalance > 0
        ? ((Math.abs(delta) / prev.sbtcBalance) * 100).toFixed(1)
        : "N/A";
      insertTask({
        subject: `DeFi alert: sBTC balance ${direction} by ${pct}% — now ${currDisplay} BTC`,
        description: [
          `sBTC balance changed significantly for address ${address}.`,
          "",
          `Previous: ${prevDisplay} BTC (${prev.sbtcBalance} satoshis)`,
          `Current:  ${currDisplay} BTC (${sbtc} satoshis)`,
          `Change:   ${delta > 0 ? "+" : ""}${(delta / 100_000_000).toFixed(8)} BTC (${direction} ${pct}%)`,
          "",
          `Captured at: ${new Date().toISOString()}`,
          "Review recent sBTC deposits/withdrawals.",
        ].join("\n"),
        source,
        priority: 5,
        skills: '["defi-balance"]',
      });
      log(`sBTC change task created — ${prevDisplay} -> ${currDisplay} BTC (${direction} ${pct}%)`);
    }
  }

  // ---- STX low balance alert ----
  if (stxBalance !== null && stx < STX_LOW_THRESHOLD_MICRO) {
    const source = `sensor:defi-balance:stx-low:${today}`;
    if (!pendingTaskExistsForSource(source)) {
      const currDisplay = (stx / 1_000_000).toFixed(6);
      const thresholdDisplay = (STX_LOW_THRESHOLD_MICRO / 1_000_000).toFixed(0);
      insertTask({
        subject: `DeFi alert: STX balance low — ${currDisplay} STX (threshold: ${thresholdDisplay} STX)`,
        description: [
          `STX balance for ${address} is below the minimum threshold.`,
          "",
          `Current:   ${currDisplay} STX (${stx} microSTX)`,
          `Threshold: ${thresholdDisplay} STX (${STX_LOW_THRESHOLD_MICRO} microSTX)`,
          "",
          "Top up STX to cover transaction fees for DeFi operations.",
        ].join("\n"),
        source,
        priority: 3,
        skills: '["defi-balance"]',
      });
      log(`STX low balance task created — ${currDisplay} STX`);
    }
  }

  // ---- sBTC low balance alert ----
  if (sbtcBalance !== null && sbtc > 0 && sbtc < SBTC_LOW_THRESHOLD_SATS) {
    const source = `sensor:defi-balance:sbtc-low:${today}`;
    if (!pendingTaskExistsForSource(source)) {
      const currDisplay = (sbtc / 100_000_000).toFixed(8);
      const thresholdDisplay = (SBTC_LOW_THRESHOLD_SATS / 100_000_000).toFixed(8);
      insertTask({
        subject: `DeFi alert: sBTC balance low — ${currDisplay} BTC (threshold: ${thresholdDisplay} BTC)`,
        description: [
          `sBTC balance for ${address} is below the minimum threshold.`,
          "",
          `Current:   ${currDisplay} BTC (${sbtc} satoshis)`,
          `Threshold: ${thresholdDisplay} BTC (${SBTC_LOW_THRESHOLD_SATS} satoshis)`,
          "",
          "Consider topping up sBTC for planned DeFi operations.",
        ].join("\n"),
        source,
        priority: 4,
        skills: '["defi-balance"]',
      });
      log(`sBTC low balance task created — ${currDisplay} BTC`);
    }
  }

  return "ok";
}
