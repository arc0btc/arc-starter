// skills/bitflow-positions/sensor.ts
// Monitor Bitflow pools for APY shifts and price deviations

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "bitflow-positions";
const INTERVAL_MINUTES = 60; // 1 hour
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const HIRO_API = "https://api.hiro.so";

// Bitflow deployer — LP tokens from this address indicate Bitflow pool participation
const BITFLOW_DEPLOYER = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";

const log = createSensorLogger(SENSOR_NAME);

// State file for tracking pool metrics between runs
const STATE_FILE = `${import.meta.dir}/pool-state.json`;

interface PoolSnapshot {
  token: string;
  balance: string;
  timestamp: string;
}

interface PoolState {
  pools: PoolSnapshot[];
  lastChecked: string;
}

async function readState(): Promise<PoolState | null> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      return await file.json() as PoolState;
    }
  } catch {
    // No state file yet
  }
  return null;
}

async function writeState(state: PoolState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

interface PoolData {
  token: string;
  balance: string;
}

async function getPoolHoldings(): Promise<PoolData[]> {
  try {
    const response = await fetchWithRetry(`${HIRO_API}/extended/v1/address/${ARC_ADDRESS}/balances`);
    if (!response.ok) {
      log(`warn: Hiro API returned ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    const pools: PoolData[] = [];
    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      // Detect Bitflow LP tokens by deployer address or naming convention
      if (key.includes(BITFLOW_DEPLOYER) || key.toLowerCase().includes("bitflow") || key.toLowerCase().includes("stableswap")) {
        pools.push({ token: key, balance: val.balance });
      }
    }

    return pools;
  } catch (e) {
    const error = e as Error;
    log(`warn: pool check failed: ${error.message}`);
    return [];
  }
}

export default async function bitflowSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Bitflow pool holdings");

    const pools = await getPoolHoldings();

    const now = new Date().toISOString();
    const previousState = await readState();

    // Write current state
    await writeState({
      pools: pools.map((p) => ({ ...p, timestamp: now })),
      lastChecked: now,
    });

    if (pools.length === 0 && (!previousState || previousState.pools.length === 0)) {
      log("no Bitflow LP positions detected");
      return "ok";
    }

    log(`tracking ${pools.length} Bitflow pool(s)`);

    // Detect significant balance changes (could indicate IL, rewards, or external activity)
    if (previousState) {
      for (const pool of pools) {
        const prev = previousState.pools.find((p) => p.token === pool.token);
        if (!prev) {
          // New pool position detected
          const source = `sensor:${SENSOR_NAME}:new-position`;
          if (!pendingTaskExistsForSource(source)) {
            log(`new Bitflow LP position detected: ${pool.token}`);
            insertTask({
              subject: `New Bitflow LP position detected: ${pool.token.split("::").pop() ?? pool.token}`,
              description: `A new Bitflow LP token appeared in Arc's balances.\n\nToken: ${pool.token}\nBalance: ${pool.balance}\n\nReview the position and track it.`,
              skills: JSON.stringify(["bitflow-positions"]),
              priority: 7,
              status: "pending",
              source,
            });
          }
          continue;
        }

        // Check for large balance changes (>10%)
        const prevBal = BigInt(prev.balance);
        const curBal = BigInt(pool.balance);
        if (prevBal > 0n) {
          const changePct = Number(((curBal - prevBal) * 100n) / prevBal);
          if (Math.abs(changePct) > 10) {
            const source = `sensor:${SENSOR_NAME}:balance-shift`;
            if (!pendingTaskExistsForSource(source)) {
              log(`significant LP balance change: ${pool.token} ${changePct > 0 ? "+" : ""}${changePct}%`);
              insertTask({
                subject: `Bitflow LP balance shifted ${changePct > 0 ? "+" : ""}${changePct}% — ${pool.token.split("::").pop() ?? pool.token}`,
                description: `Bitflow LP token balance changed significantly.\n\nToken: ${pool.token}\nPrevious: ${prev.balance}\nCurrent: ${pool.balance}\nChange: ${changePct}%\n\nInvestigate: impermanent loss, external deposit/withdrawal, or rewards accumulation.`,
                skills: JSON.stringify(["bitflow-positions"]),
                priority: 5,
                status: "pending",
                source,
              });
            }
          }
        }
      }
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
