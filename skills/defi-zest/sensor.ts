// skills/defi-zest/sensor.ts
// Monitor Zest Protocol supply positions via v0-1-data get-user-position (v2 contracts)

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import {
  principalCV,
  uintCV,
  cvToJSON,
  hexToCV,
  serializeCV,
} from "../../github/aibtcdev/skills/node_modules/@stacks/transactions/dist/index.js";

const SENSOR_NAME = "defi-zest";
const INTERVAL_MINUTES = 360; // 6 hours
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const STACKS_API = "https://api.mainnet.hiro.so";

// V2 data contract for position queries
const V2_DATA = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const V2_DATA_NAME = "v0-1-data";

// Primary monitoring target: sBTC supply position (assetId=2)
const SBTC_ASSET_ID = 2;
const SBTC_DECIMALS = 8;

const log = createSensorLogger(SENSOR_NAME);

// State file for tracking position between runs
const STATE_FILE = `${import.meta.dir}/position-state.json`;

interface PositionState {
  lastSuppliedShares: string;
  lastBorrowed: string;
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

function serializeCVToHex(cv: unknown): string {
  const serialized = serializeCV(cv as import("@stacks/transactions").ClarityValue);
  if (typeof serialized === "string") {
    return serialized.startsWith("0x") ? serialized : `0x${serialized}`;
  }
  return `0x${Buffer.from(serialized as Uint8Array).toString("hex")}`;
}

/** Query get-user-position on v0-1-data for sBTC (assetId=2) */
async function getSbtcPosition(): Promise<{ suppliedShares: string; borrowed: string } | null> {
  try {
    const url = `${STACKS_API}/v2/contracts/call-read/${V2_DATA}/${V2_DATA_NAME}/get-user-position`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ARC_ADDRESS,
        arguments: [
          serializeCVToHex(principalCV(ARC_ADDRESS)),
          serializeCVToHex(uintCV(SBTC_ASSET_ID)),
        ],
      }),
    });

    if (!response.ok) {
      log(`warn: v0-1-data call returned ${response.status}`);
      return null;
    }

    const data = await response.json() as { okay: boolean; result?: string; cause?: string };
    if (!data.okay || !data.result) {
      log(`warn: get-user-position returned not-okay: ${data.cause ?? "unknown"}`);
      return null;
    }

    const decoded = cvToJSON(hexToCV(data.result));

    if (decoded && typeof decoded === "object" && "value" in decoded) {
      const decodedValue = decoded.value as Record<string, { value: string }>;
      return {
        suppliedShares: decodedValue["suppliedShares"]?.value ?? decodedValue["supplied-shares"]?.value ?? "0",
        borrowed: decodedValue["borrowed"]?.value ?? "0",
      };
    }

    return { suppliedShares: "0", borrowed: "0" };
  } catch (e) {
    const error = e as Error;
    log(`warn: position check failed: ${error.message}`);
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

    log("run started — checking Zest sBTC position via v0-1-data");

    const position = await getSbtcPosition();
    if (position === null) {
      log("could not fetch position; skipping");
      return "skip";
    }

    const suppliedShares = BigInt(position.suppliedShares);
    const suppliedSbtc = Number(suppliedShares) / Math.pow(10, SBTC_DECIMALS);
    log(`sBTC position: suppliedShares=${position.suppliedShares} (${suppliedSbtc.toFixed(8)} sBTC), borrowed=${position.borrowed}`);

    // Read previous state
    const prevState = await readState();

    // Write current state
    await writeState({
      lastSuppliedShares: position.suppliedShares,
      lastBorrowed: position.borrowed,
      lastChecked: new Date().toISOString(),
    });

    // Check for unexpected position drop (>10% decline in suppliedShares)
    if (prevState && prevState.lastSuppliedShares !== "0") {
      const prevShares = BigInt(prevState.lastSuppliedShares);
      if (prevShares > 0n && suppliedShares > 0n) {
        const dropPct = Number((prevShares - suppliedShares) * 100n / prevShares);
        if (dropPct > 10) {
          const alertSource = `sensor:${SENSOR_NAME}:position-drop`;
          if (!pendingTaskExistsForSource(alertSource)) {
            log(`ALERT: sBTC position dropped ${dropPct}% (${prevState.lastSuppliedShares} → ${position.suppliedShares})`);
            insertTask({
              subject: `Zest sBTC position dropped ${dropPct}% — investigate`,
              description: `Arc's Zest sBTC supply position decreased significantly.

Previous suppliedShares: ${prevState.lastSuppliedShares} (${Number(prevShares) / Math.pow(10, SBTC_DECIMALS)} sBTC)
Current suppliedShares: ${position.suppliedShares} (${suppliedSbtc} sBTC)
Drop: ${dropPct}%
Last checked: ${prevState.lastChecked}

Investigate: was this a withdrawal, liquidation, or protocol issue?
Position data from: ${V2_DATA}.${V2_DATA_NAME} get-user-position`,
              skills: JSON.stringify(["defi-zest"]),
              priority: 3,
              model: "opus",
              status: "pending",
              source: alertSource,
            });
          }
        }
      }
    }

    // Log position to sensor output
    if (suppliedShares === 0n) {
      log("no active Zest sBTC position");
    } else {
      log(`position healthy: ${suppliedSbtc.toFixed(8)} sBTC supplied`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
