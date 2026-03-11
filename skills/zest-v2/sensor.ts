// skills/zest-v2/sensor.ts
// Monitor Zest V2 borrow positions for liquidation risk
// Checks health factor based on collateral vs. debt

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "zest-v2";
const INTERVAL_MINUTES = 120; // 2 hours
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const HIRO_API = "https://api.hiro.so";

// Zest V2 pool contract addresses (update when V2 contracts are confirmed)
const ZEST_V2_POOL = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_V2_POOL_NAME = "pool-v2-0";

const log = createSensorLogger(SENSOR_NAME);

// State file for tracking health between runs
const STATE_FILE = `${import.meta.dir}/health-state.json`;

interface HealthState {
  lastHealthFactor: number;
  lastCollateral: string;
  lastDebt: string;
  lastChecked: string;
}

async function readState(): Promise<HealthState | null> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      return await file.json() as HealthState;
    }
  } catch {
    // No state file yet
  }
  return null;
}

async function writeState(state: HealthState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

interface PositionData {
  collateral: string;
  debt: string;
  healthFactor: number;
}

async function getPositionHealth(): Promise<PositionData | null> {
  try {
    // Query user reserve data from Zest V2 pool contract
    const url = `${HIRO_API}/v2/contracts/call-read/${ZEST_V2_POOL}/${ZEST_V2_POOL_NAME}/get-user-reserve-data`;

    // Also check balances endpoint as fallback (same pattern as defi-zest)
    const holdingsUrl = `${HIRO_API}/extended/v1/address/${ARC_ADDRESS}/balances`;
    const response = await fetchWithRetry(holdingsUrl);
    if (!response.ok) {
      log(`warn: Hiro API returned ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    // Look for Zest V2 LP tokens (collateral indicators)
    let collateral = "0";
    let debt = "0";

    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      // Collateral tokens (z-prefixed LP tokens)
      if (key.includes("zsbtc") || key.includes("zstx") || key.includes("zusda")) {
        const current = BigInt(collateral);
        const additional = BigInt(val.balance);
        collateral = (current + additional).toString();
      }
      // Debt tokens (d-prefixed debt tokens, if Zest V2 uses them)
      if (key.includes("dsbtc") || key.includes("dstx") || key.includes("dusda")) {
        const current = BigInt(debt);
        const additional = BigInt(val.balance);
        debt = (current + additional).toString();
      }
    }

    // Calculate health factor (collateral / debt, or Infinity if no debt)
    const collateralNum = Number(collateral);
    const debtNum = Number(debt);
    const healthFactor = debtNum === 0 ? 999 : collateralNum / debtNum;

    return { collateral, debt, healthFactor };
  } catch (e) {
    const error = e as Error;
    log(`warn: position check failed: ${error.message}`);
    return null;
  }
}

export default async function zestV2Sensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Zest V2 position health");

    const position = await getPositionHealth();
    if (position === null) {
      log("could not fetch position; skipping");
      return "skip";
    }

    log(`collateral: ${position.collateral}, debt: ${position.debt}, health factor: ${position.healthFactor.toFixed(2)}`);

    // Write current state
    await writeState({
      lastHealthFactor: position.healthFactor,
      lastCollateral: position.collateral,
      lastDebt: position.debt,
      lastChecked: new Date().toISOString(),
    });

    // No debt = no liquidation risk
    if (position.debt === "0") {
      log("no active borrow positions — no liquidation risk");
      return "ok";
    }

    // Critical: health factor < 1.2 — liquidation imminent
    if (position.healthFactor < 1.2) {
      const alertSource = `sensor:${SENSOR_NAME}:liquidation-critical`;
      if (!pendingTaskExistsForSource(alertSource)) {
        log(`CRITICAL: health factor ${position.healthFactor.toFixed(2)} — liquidation imminent`);
        insertTask({
          subject: `CRITICAL: Zest V2 health factor ${position.healthFactor.toFixed(2)} — repay or add collateral NOW`,
          description: `Arc's Zest V2 position is at critical liquidation risk.

Health factor: ${position.healthFactor.toFixed(2)} (threshold: 1.0 = liquidation)
Collateral: ${position.collateral}
Debt: ${position.debt}

Immediate action required: repay debt or deposit additional collateral.
Use: arc skills run --name zest-v2 -- repay --asset <symbol> --amount <units>
Or:  arc skills run --name zest-v2 -- deposit --asset <symbol> --amount <units>`,
          skills: JSON.stringify(["zest-v2"]),
          priority: 2,
          status: "pending",
          source: alertSource,
        });
      }
      return "ok";
    }

    // Warning: health factor < 1.5 — getting risky
    if (position.healthFactor < 1.5) {
      const alertSource = `sensor:${SENSOR_NAME}:liquidation-warning`;
      if (!pendingTaskExistsForSource(alertSource)) {
        log(`WARNING: health factor ${position.healthFactor.toFixed(2)} — approaching liquidation zone`);
        insertTask({
          subject: `Zest V2 health factor ${position.healthFactor.toFixed(2)} — review position`,
          description: `Arc's Zest V2 borrow position health is declining.

Health factor: ${position.healthFactor.toFixed(2)} (warning threshold: 1.5, critical: 1.2)
Collateral: ${position.collateral}
Debt: ${position.debt}

Review position and consider partial repayment or adding collateral.`,
          skills: JSON.stringify(["zest-v2"]),
          priority: 5,
          status: "pending",
          source: alertSource,
        });
      }
    } else {
      log(`position healthy: health factor ${position.healthFactor.toFixed(2)}`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
