// skills/defi-jingswap/sensor.ts
// Detect active Jingswap deposit phases with meaningful TVL and file tasks

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";

const SENSOR_NAME = "defi-jingswap";
const INTERVAL_MINUTES = 30;
const RATE_LIMIT_MINUTES = 240; // 4 hours between signals
const JINGSWAP_API = "https://faktory-dao-backend.vercel.app";
const JINGSWAP_API_KEY =
  process.env.JINGSWAP_API_KEY || "jc_b058d7f2e0976bd4ee34be3e5c7ba7ebe45289c55d3f5e45f666ebc14b7ebfd0";

// Minimum TVL thresholds to consider a cycle "meaningful"
const MIN_STX_USTX = 1_000_000; // 1 STX in micro-STX
const MIN_SBTC_SATS = 1_000; // 1,000 sats

// Arc's Stacks address for deposit checks
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

const log = createSensorLogger(SENSOR_NAME);

interface CycleState {
  currentCycle: number;
  phase: number;
  blocksElapsed: number;
  cycleTotals: { totalStx: number; totalSbtc: number };
  minDeposits: { minStx: number; minSbtc: number };
}

interface UserDeposit {
  stxAmount: number;
  sbtcAmount: number;
}

async function jingswapGet(path: string): Promise<unknown> {
  const response = await fetchWithRetry(`${JINGSWAP_API}${path}`, {
    headers: { "x-api-key": JINGSWAP_API_KEY },
  });
  if (!response.ok) throw new Error(`Jingswap API ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as { success: boolean; data: unknown; message?: string };
  if (!json.success) throw new Error(json.message || "API returned failure");
  return json.data;
}

export default async function jingswapSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Jingswap cycle state");

    const state = (await jingswapGet("/api/auction/cycle-state")) as CycleState;

    const { cycleTotals } = state;
    log(`cycle=${state.currentCycle} phase=${state.phase} blocks=${state.blocksElapsed} stx=${cycleTotals.totalStx} sbtc=${cycleTotals.totalSbtc}`);

    // Only interested in deposit phase (phase=0)
    if (state.phase !== 0) {
      log(`phase=${state.phase} (not deposit); skipping`);
      return "ok";
    }

    // Check if both sides have meaningful TVL
    const hasStxTvl = cycleTotals.totalStx >= MIN_STX_USTX;
    const hasSbtcTvl = cycleTotals.totalSbtc >= MIN_SBTC_SATS;

    if (!hasStxTvl && !hasSbtcTvl) {
      log("no meaningful TVL on either side; skipping");
      return "ok";
    }

    // Check if Arc already has a deposit in this cycle
    try {
      const deposit = (await jingswapGet(`/api/auction/deposit/${state.currentCycle}/${ARC_ADDRESS}`)) as UserDeposit;
      if (deposit.stxAmount > 0 || deposit.sbtcAmount > 0) {
        log(`Arc has active deposit (stx=${deposit.stxAmount}, sbtc=${deposit.sbtcAmount}); skipping`);
        return "ok";
      }
    } catch {
      // No deposit found or API error — continue to file signal
    }

    // Rate limit check
    const sourcePrefix = `sensor:${SENSOR_NAME}:deposit-open:`;
    if (recentTaskExistsForSourcePrefix(sourcePrefix, RATE_LIMIT_MINUTES)) {
      log(`rate limit: signal filed within last ${RATE_LIMIT_MINUTES} min; skipping`);
      return "rate-limited";
    }

    const signalSource = `sensor:${SENSOR_NAME}:deposit-open:cycle-${state.currentCycle}`;
    if (pendingTaskExistsForSource(signalSource)) {
      log("pending task already exists for this cycle; skipping");
      return "ok";
    }

    const stxDisplay = (cycleTotals.totalStx / 1_000_000).toFixed(2);
    const sbtcDisplay = cycleTotals.totalSbtc;

    log(`filing signal: cycle ${state.currentCycle} deposit open, STX=${stxDisplay}, sBTC=${sbtcDisplay} sats`);

    insertTask({
      subject: `Jingswap cycle ${state.currentCycle}: deposit phase open — ${stxDisplay} STX, ${sbtcDisplay} sats deposited`,
      description: `Jingswap blind auction cycle ${state.currentCycle} is in deposit phase.

Blocks elapsed: ${state.blocksElapsed}
STX side: ${stxDisplay} STX (${cycleTotals.totalStx} µSTX)
sBTC side: ${sbtcDisplay} sats

Arc has no active deposit in this cycle. Evaluate whether to participate.
Budget cap: 50 STX or 10,000 sats per cycle.

Use: arc skills run --name defi-jingswap -- cycle-state
Use: arc skills run --name defi-jingswap -- prices`,
      skills: JSON.stringify(["defi-jingswap"]),
      priority: 5,
      status: "pending",
      source: signalSource,
    });

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
