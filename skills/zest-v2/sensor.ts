// skills/zest-v2/sensor.ts
// Monitor Zest V2 borrow positions for liquidation risk
// Uses v0-1-data get-user-position for position data (v2 contracts)

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import {
  principalCV,
  uintCV,
  cvToJSON,
  hexToCV,
  serializeCV,
} from "../../github/aibtcdev/skills/node_modules/@stacks/transactions/dist/index.js";

const SENSOR_NAME = "zest-v2";
const INTERVAL_MINUTES = 120; // 2 hours
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const STACKS_API = "https://api.hiro.so";

// Zest V2 contracts (new deployer)
const V2_DATA = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const V2_DATA_NAME = "v0-1-data";

// V2 supported assets: assetId → symbol + decimals
const V2_ASSETS: Array<{ id: number; symbol: string; decimals: number }> = [
  { id: 0, symbol: "wSTX", decimals: 6 },
  { id: 2, symbol: "sBTC", decimals: 8 },
  { id: 4, symbol: "stSTX", decimals: 6 },
  { id: 6, symbol: "USDC", decimals: 6 },
  { id: 8, symbol: "USDH", decimals: 8 },
  { id: 10, symbol: "stSTXbtc", decimals: 6 },
];

const log = createSensorLogger(SENSOR_NAME);

// State file for tracking health between runs
const STATE_FILE = `${import.meta.dir}/health-state.json`;

interface AssetPosition {
  assetId: number;
  symbol: string;
  suppliedShares: string;
  borrowed: string;
}

interface HealthState {
  lastHealthFactor: number;
  lastPositions: AssetPosition[];
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

function serializeCVToHex(cv: unknown): string {
  const serialized = serializeCV(cv);
  if (typeof serialized === "string") {
    return serialized.startsWith("0x") ? serialized : `0x${serialized}`;
  }
  // Uint8Array path
  return `0x${Buffer.from(serialized as Uint8Array).toString("hex")}`;
}

/** Call get-user-position on v0-1-data for a specific asset */
async function getUserPosition(assetId: number): Promise<{ suppliedShares: string; borrowed: string } | null> {
  try {
    const url = `${STACKS_API}/v2/contracts/call-read/${V2_DATA}/${V2_DATA_NAME}/get-user-position`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ARC_ADDRESS,
        arguments: [
          serializeCVToHex(principalCV(ARC_ADDRESS)),
          serializeCVToHex(uintCV(assetId)),
        ],
      }),
    });

    if (!response.ok) {
      log(`warn: v0-1-data call returned ${response.status} for asset ${assetId}`);
      return null;
    }

    const data = await response.json() as { okay: boolean; result?: string; cause?: string };
    if (!data.okay || !data.result) {
      log(`warn: get-user-position returned not-okay for asset ${assetId}: ${data.cause ?? "unknown"}`);
      return null;
    }

    const decoded = cvToJSON(hexToCV(data.result));

    // Extract suppliedShares and borrowed from the tuple response
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
    log(`warn: position check failed for asset ${assetId}: ${error.message}`);
    return null;
  }
}

/** Fetch all asset positions and compute aggregate health */
async function getAllPositions(): Promise<{ positions: AssetPosition[]; totalSupplied: bigint; totalBorrowed: bigint } | null> {
  const positions: AssetPosition[] = [];
  let totalSupplied = 0n;
  let totalBorrowed = 0n;
  let anySuccess = false;

  for (const asset of V2_ASSETS) {
    const pos = await getUserPosition(asset.id);
    if (pos === null) continue;
    anySuccess = true;

    const supplied = BigInt(pos.suppliedShares);
    const borrowed = BigInt(pos.borrowed);

    positions.push({
      assetId: asset.id,
      symbol: asset.symbol,
      suppliedShares: pos.suppliedShares,
      borrowed: pos.borrowed,
    });

    // Aggregate (note: different decimals across assets, but for health factor
    // the contract-level values are what matter for per-asset risk)
    totalSupplied += supplied;
    totalBorrowed += borrowed;
  }

  if (!anySuccess) return null;
  return { positions, totalSupplied, totalBorrowed };
}

export default async function zestV2Sensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Zest V2 position health via v0-1-data");

    const result = await getAllPositions();
    if (result === null) {
      log("could not fetch any positions; skipping");
      return "skip";
    }

    const { positions, totalBorrowed } = result;

    // Log each active position
    const activePositions = positions.filter(p => p.suppliedShares !== "0" || p.borrowed !== "0");
    for (const p of activePositions) {
      log(`${p.symbol} (id=${p.assetId}): supplied=${p.suppliedShares}, borrowed=${p.borrowed}`);
    }

    // Compute per-asset health factors for positions with debt
    // Health factor = suppliedShares / borrowed (simplified; real HF uses oracle prices)
    let worstHealthFactor = 999;
    let worstAsset = "";

    for (const p of activePositions) {
      const borrowed = BigInt(p.borrowed);
      if (borrowed === 0n) continue;

      const supplied = BigInt(p.suppliedShares);
      const hf = Number(supplied) / Number(borrowed);
      if (hf < worstHealthFactor) {
        worstHealthFactor = hf;
        worstAsset = p.symbol;
      }
    }

    log(`worst health factor: ${worstHealthFactor.toFixed(2)}${worstAsset ? ` (${worstAsset})` : ""}`);

    // Write current state
    await writeState({
      lastHealthFactor: worstHealthFactor,
      lastPositions: activePositions,
      lastChecked: new Date().toISOString(),
    });

    // No debt = no liquidation risk
    if (totalBorrowed === 0n) {
      log("no active borrow positions — no liquidation risk");
      return "ok";
    }

    // Critical: health factor < 1.2 — liquidation imminent
    if (worstHealthFactor < 1.2) {
      const alertSource = `sensor:${SENSOR_NAME}:liquidation-critical`;
      if (!pendingTaskExistsForSource(alertSource)) {
        log(`CRITICAL: health factor ${worstHealthFactor.toFixed(2)} on ${worstAsset} — liquidation imminent`);
        insertTask({
          subject: `CRITICAL: Zest V2 health factor ${worstHealthFactor.toFixed(2)} (${worstAsset}) — repay or add collateral NOW`,
          description: `Arc's Zest V2 position is at critical liquidation risk.

Worst health factor: ${worstHealthFactor.toFixed(2)} on ${worstAsset} (threshold: 1.0 = liquidation)
Active positions: ${activePositions.map(p => `${p.symbol}: supplied=${p.suppliedShares}, borrowed=${p.borrowed}`).join("; ")}

Immediate action required: repay debt or deposit additional collateral.
Use: arc skills run --name zest-v2 -- repay --asset ${worstAsset} --amount <units>
Or:  arc skills run --name zest-v2 -- deposit --asset ${worstAsset} --amount <units>`,
          skills: JSON.stringify(["zest-v2"]),
          priority: 2,
          status: "pending",
          source: alertSource,
        });
      }
      return "ok";
    }

    // Warning: health factor < 1.5 — getting risky
    if (worstHealthFactor < 1.5) {
      const alertSource = `sensor:${SENSOR_NAME}:liquidation-warning`;
      if (!pendingTaskExistsForSource(alertSource)) {
        log(`WARNING: health factor ${worstHealthFactor.toFixed(2)} on ${worstAsset} — approaching liquidation zone`);
        insertTask({
          subject: `Zest V2 health factor ${worstHealthFactor.toFixed(2)} (${worstAsset}) — review position`,
          description: `Arc's Zest V2 borrow position health is declining.

Worst health factor: ${worstHealthFactor.toFixed(2)} on ${worstAsset} (warning: 1.5, critical: 1.2)
Active positions: ${activePositions.map(p => `${p.symbol}: supplied=${p.suppliedShares}, borrowed=${p.borrowed}`).join("; ")}

Review position and consider partial repayment or adding collateral.`,
          skills: JSON.stringify(["zest-v2"]),
          priority: 5,
          status: "pending",
          source: alertSource,
        });
      }
    } else {
      log(`position healthy: worst health factor ${worstHealthFactor.toFixed(2)}`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
