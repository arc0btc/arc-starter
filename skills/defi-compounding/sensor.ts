// skills/defi-compounding/sensor.ts
// Monitor Bitflow LP positions for fee accrual, create compounding workflows

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import {
  getWorkflowByInstanceKey,
  insertWorkflow,
} from "../../src/db.ts";

const SENSOR_NAME = "defi-compounding";
const INTERVAL_MINUTES = 360; // 6 hours
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const HIRO_API = "https://api.mainnet.hiro.so";
const BITFLOW_API = "https://api.bitflow.finance/v1";
const BITFLOW_DEPLOYER = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";

const log = createSensorLogger(SENSOR_NAME);

const STATE_FILE = `${import.meta.dir}/compounding-state.json`;

interface CompoundingState {
  lastChecked: string;
  harvestThresholdUsd: number;
  pools: PoolBaseline[];
}

interface PoolBaseline {
  token: string;
  poolName: string;
  baselineBalance: string;
  lastHarvestDate: string;
}

async function readState(): Promise<CompoundingState> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      return await file.json() as CompoundingState;
    }
  } catch {
    // No state file yet
  }
  return {
    lastChecked: "",
    harvestThresholdUsd: 5.0,
    pools: [],
  };
}

async function writeState(state: CompoundingState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

interface TokenBalance {
  token: string;
  balance: string;
}

async function getBitflowLpBalances(): Promise<TokenBalance[]> {
  try {
    const response = await fetchWithRetry(
      `${HIRO_API}/extended/v1/address/${ARC_ADDRESS}/balances`
    );
    if (!response.ok) {
      log(`warn: Hiro API returned ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    const lps: TokenBalance[] = [];
    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      if (
        key.includes(BITFLOW_DEPLOYER) ||
        key.toLowerCase().includes("bitflow") ||
        key.toLowerCase().includes("stableswap")
      ) {
        lps.push({ token: key, balance: val.balance });
      }
    }
    return lps;
  } catch (e) {
    const error = e as Error;
    log(`warn: balance check failed: ${error.message}`);
    return [];
  }
}

async function getStxPrice(): Promise<number> {
  try {
    const response = await fetchWithRetry(`${BITFLOW_API}/tickers`);
    if (!response.ok) return 0;
    const tickers = await response.json() as Array<{ ticker_id: string; last_price: number }>;
    const stxUsdc = tickers.find(
      (t) => t.ticker_id === "STX_USDC" || t.ticker_id.includes("STX") && t.ticker_id.includes("USD")
    );
    return stxUsdc?.last_price || 0;
  } catch {
    return 0;
  }
}

function extractPoolName(token: string): string {
  const parts = token.split("::");
  return parts.length > 1 ? (parts[1] ?? token) : token;
}

function createCompoundingWorkflow(
  pool: string,
  poolName: string,
  feeAmount: string,
  feeAmountUsd: number,
  threshold: number
): void {
  const today = new Date().toISOString().split("T")[0];
  const instanceKey = `compounding-${poolName}-${today}`;

  // Check if workflow already exists for this pool today
  const existing = getWorkflowByInstanceKey(instanceKey);
  if (existing) {
    log(`skip: workflow already exists for ${poolName} today (id=${existing.id})`);
    return;
  }

  const context = JSON.stringify({
    pool,
    poolName,
    feeToken: "LP",
    feeAmount,
    feeAmountUsd,
    threshold,
    strategy: "same-pool",
  });

  const id = insertWorkflow({
    template: "compounding",
    instance_key: instanceKey,
    current_state: "detected",
    context,
  });

  log(`created compounding workflow: ${instanceKey} (id=${id})`);
}

export default async function defiCompoundingSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking LP fee accrual");

    const state = await readState();
    const currentBalances = await getBitflowLpBalances();
    const now = new Date().toISOString();

    if (currentBalances.length === 0) {
      log("no Bitflow LP positions found");
      state.lastChecked = now;
      await writeState(state);
      return "ok";
    }

    log(`found ${currentBalances.length} LP position(s)`);

    const stxPrice = await getStxPrice();
    let workflowsCreated = 0;

    for (const lp of currentBalances) {
      const poolName = extractPoolName(lp.token);
      const baseline = state.pools.find((p) => p.token === lp.token);

      if (!baseline) {
        // First time seeing this pool — set baseline, no harvest yet
        log(`new pool baseline: ${poolName} = ${lp.balance}`);
        state.pools.push({
          token: lp.token,
          poolName,
          baselineBalance: lp.balance,
          lastHarvestDate: now,
        });
        continue;
      }

      // Compare current balance to baseline
      // LP balance growth indicates fee accrual (auto-compounding pools)
      // or we can detect fee accrual from position value growth
      const baselineBal = BigInt(baseline.baselineBalance);
      const currentBal = BigInt(lp.balance);

      if (baselineBal === 0n || currentBal <= baselineBal) {
        continue;
      }

      const growthBal = currentBal - baselineBal;
      const growthPct = Number((growthBal * 10000n) / baselineBal) / 100;

      // Rough USD estimate: growth in LP tokens * STX price (approximation)
      // Real fee calculation would need pool-specific pricing
      const growthUsd = stxPrice > 0 ? (Number(growthBal) / 1e6) * stxPrice : 0;

      log(`${poolName}: growth ${growthPct.toFixed(2)}% (~$${growthUsd.toFixed(2)})`);

      if (growthUsd >= state.harvestThresholdUsd || (stxPrice === 0 && growthPct >= 1.0)) {
        log(`threshold met for ${poolName} — creating compounding workflow`);
        createCompoundingWorkflow(
          lp.token,
          poolName,
          growthBal.toString(),
          growthUsd,
          state.harvestThresholdUsd
        );
        workflowsCreated++;

        // Update baseline after triggering harvest
        baseline.baselineBalance = lp.balance;
        baseline.lastHarvestDate = now;
      }
    }

    state.lastChecked = now;
    await writeState(state);

    log(`done: ${workflowsCreated} compounding workflow(s) created`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
