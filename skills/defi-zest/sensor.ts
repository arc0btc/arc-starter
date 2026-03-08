// skills/defi-zest/sensor.ts
// Monitor Zest Protocol sBTC yield farming position
// Uses zsbtc-v2-0 LP token balance as workaround for get-user-reserve-data returning 0

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "defi-zest";
const INTERVAL_MINUTES = 360; // 6 hours
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const HIRO_API = "https://api.hiro.so";

// zsbtc-v2-0 LP token contract (sBTC position on Zest)
const ZSBTC_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZSBTC_NAME = "zsbtc-v2-0";

const log = createSensorLogger(SENSOR_NAME);

// State file for tracking position between runs
const STATE_FILE = `${import.meta.dir}/position-state.json`;

interface PositionState {
  lastBalance: string;
  lastChecked: string;
}

async function readState(): Promise<PositionState | null> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      return await file.json() as PositionState;
    }
  } catch {
    // No state file yet
  }
  return null;
}

async function writeState(state: PositionState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getZsbtcBalance(): Promise<string | null> {
  try {
    // Call read-only function: zsbtc-v2-0.get-balance(who)
    const url = `${HIRO_API}/v2/contracts/call-read/${ZSBTC_CONTRACT}/${ZSBTC_NAME}/get-balance`;
    const body = JSON.stringify({
      sender: ARC_ADDRESS,
      arguments: [
        // principal CV for Arc's address
        `0x0516${Buffer.from(
          (() => {
            // Decode c32 address to bytes
            // SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B
            // Use the Hiro API's own encoding — pass as hex-encoded Clarity principal
            return ARC_ADDRESS;
          })()
        ).toString("hex")}`,
      ],
    });

    // Simpler approach: use the token holdings endpoint
    const holdingsUrl = `${HIRO_API}/extended/v1/address/${ARC_ADDRESS}/balances`;
    const response = await fetchWithRetry(holdingsUrl);
    if (!response.ok) {
      log(`warn: Hiro API returned ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    // Look for zsbtc-v2-0 LP token in fungible_tokens
    const lpTokenKey = `${ZSBTC_CONTRACT}.${ZSBTC_NAME}::zsbtc`;
    const lpBalance = data.fungible_tokens?.[lpTokenKey];

    if (lpBalance) {
      return lpBalance.balance;
    }

    // Try alternate key formats
    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      if (key.includes(ZSBTC_NAME)) {
        return val.balance;
      }
    }

    return "0";
  } catch (e) {
    const error = e as Error;
    log(`warn: balance check failed: ${error.message}`);
    return null;
  }
}

export default async function zestSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Zest sBTC position");

    const balance = await getZsbtcBalance();
    if (balance === null) {
      log("could not fetch position; skipping");
      return "skip";
    }

    const balanceNum = BigInt(balance);
    const balanceSbtc = Number(balanceNum) / 1e8; // sBTC has 8 decimals
    log(`zsbtc-v2-0 balance: ${balance} (${balanceSbtc.toFixed(8)} sBTC equivalent)`);

    // Read previous state
    const prevState = await readState();

    // Write current state
    await writeState({
      lastBalance: balance,
      lastChecked: new Date().toISOString(),
    });

    // Check for unexpected position drop
    if (prevState && prevState.lastBalance !== "0") {
      const prevBalance = BigInt(prevState.lastBalance);
      if (prevBalance > 0n && balanceNum > 0n) {
        const dropPct = Number((prevBalance - balanceNum) * 100n / prevBalance);
        if (dropPct > 10) {
          const alertSource = `sensor:${SENSOR_NAME}:position-drop`;
          if (!pendingTaskExistsForSource(alertSource)) {
            log(`ALERT: position dropped ${dropPct}% (${prevState.lastBalance} → ${balance})`);
            insertTask({
              subject: `Zest sBTC position dropped ${dropPct}% — investigate`,
              description: `Arc's Zest sBTC supply position decreased significantly.

Previous balance: ${prevState.lastBalance} (${Number(prevBalance) / 1e8} sBTC)
Current balance: ${balance} (${balanceSbtc} sBTC)
Drop: ${dropPct}%
Last checked: ${prevState.lastChecked}

Investigate: was this a withdrawal, liquidation, or protocol issue?
Check explorer and Zest dashboard for details.`,
              skills: JSON.stringify(["defi-zest"]),
              priority: 3,
              status: "pending",
              source: alertSource,
            });
          }
        }
      }
    }

    // Log position to sensor output (visible in cycle_log)
    if (balanceNum === 0n) {
      log("no active Zest sBTC position");
    } else {
      log(`position healthy: ${balanceSbtc.toFixed(8)} sBTC supplied`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
