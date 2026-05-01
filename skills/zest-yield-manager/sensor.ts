// skills/zest-yield-manager/sensor.ts
// Autonomous sBTC yield management sensor for Zest Protocol.
// Checks idle sBTC balance vs reserve threshold and pending wSTX rewards.
// Queues supply tasks when idle sBTC exceeds reserve, claim tasks when rewards accrue.

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getActiveTasks } from "../../src/db.ts";
import { ARC_STX_ADDRESS } from "../../src/identity.ts";
import {
  principalCV,
  contractPrincipalCV,
  cvToJSON,
  hexToCV,
  serializeCV,
} from "../../github/aibtcdev/skills/node_modules/@stacks/transactions/dist/index.js";

const SENSOR_NAME = "zest-yield-manager";
const INTERVAL_MINUTES = 120; // 2 hours — reduced from 60 to limit supply tx chaining in mempool
const HIRO_API = "https://api.mainnet.hiro.so";

// Zest Protocol contracts (mainnet)
const POOL_BORROW_ADDR = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const POOL_BORROW_NAME = "pool-borrow-v2-3";
const INCENTIVES_ADDR = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const INCENTIVES_NAME = "incentives-v2-2";
const SBTC_ADDR = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_NAME = "sbtc-token";
const WSTX_ADDR = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const WSTX_NAME = "wstx";

// Thresholds from AGENT.md capital allocation strategy
const LIQUID_RESERVE_SATS = 200_000;        // keep 200k sats liquid
const MIN_SUPPLY_AMOUNT_SATS = 10_000;      // don't bother for tiny excesses
const MAX_SUPPLY_PER_CALL_SATS = 500_000;   // matches DEFAULT_MAX_SUPPLY_SATS in main skill
const REWARDS_CLAIM_THRESHOLD_USTX = 1_000; // claim when > 1000 uSTX pending

const log = createSensorLogger(SENSOR_NAME);

function serializeCVToHex(cv: unknown): string {
  const serialized = serializeCV(cv as import("@stacks/transactions").ClarityValue);
  if (typeof serialized === "string") {
    return serialized.startsWith("0x") ? serialized : `0x${serialized}`;
  }
  return `0x${Buffer.from(serialized as Uint8Array).toString("hex")}`;
}

async function getSbtcBalance(): Promise<number> {
  const ftKey = `${SBTC_ADDR}.${SBTC_NAME}::${SBTC_NAME}`;
  const response = await fetchWithRetry(`${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/balances`);
  if (!response.ok) {
    log(`warn: balances API returned ${response.status}`);
    return -1;
  }
  const data = await response.json() as { fungible_tokens?: Record<string, { balance: string }> };
  const entry = data.fungible_tokens?.[ftKey];
  return entry ? parseInt(entry.balance, 10) : 0;
}

async function getStxBalance(): Promise<number> {
  const response = await fetchWithRetry(`${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/stx`);
  if (!response.ok) {
    log(`warn: STX balance API returned ${response.status}`);
    return -1;
  }
  const data = await response.json() as { balance: string; locked: string };
  return parseInt(data.balance, 10) - parseInt(data.locked, 10);
}

async function getZestPosition(): Promise<{ supplied: number; borrowed: number } | null> {
  try {
    const url = `${HIRO_API}/v2/contracts/call-read/${POOL_BORROW_ADDR}/${POOL_BORROW_NAME}/get-user-reserve-data`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ARC_STX_ADDRESS,
        arguments: [
          serializeCVToHex(principalCV(ARC_STX_ADDRESS)),
          serializeCVToHex(contractPrincipalCV(SBTC_ADDR, SBTC_NAME)),
        ],
      }),
    });

    if (!response.ok) {
      log(`warn: get-user-reserve-data returned ${response.status}`);
      return null;
    }

    const data = await response.json() as { okay: boolean; result?: string; cause?: string };
    if (!data.okay || !data.result) {
      log(`warn: get-user-reserve-data not-okay: ${data.cause ?? "unknown"}`);
      return null;
    }

    const decoded = cvToJSON(hexToCV(data.result));
    if (decoded && typeof decoded === "object" && "value" in decoded) {
      const decoded_value = (decoded.value as Record<string, { value: string }>)?.value ?? decoded.value as Record<string, { value: string }>;
      return {
        supplied: parseInt((decoded_value as unknown as Record<string, { value: string }>)["current-atoken-balance"]?.value ?? "0", 10),
        borrowed: parseInt((decoded_value as unknown as Record<string, { value: string }>)["current-variable-debt"]?.value ?? "0", 10),
      };
    }
    return { supplied: 0, borrowed: 0 };
  } catch (e) {
    log(`warn: position check failed: ${(e as Error).message}`);
    return null;
  }
}

async function getMempoolDepth(): Promise<number> {
  try {
    const response = await fetchWithRetry(
      `${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/mempool?limit=50`,
    );
    if (!response.ok) {
      log(`warn: mempool API returned ${response.status} — assuming 0`);
      return 0;
    }
    const data = await response.json() as { total?: number; results?: unknown[] };
    return data.total ?? data.results?.length ?? 0;
  } catch (e) {
    log(`warn: mempool check failed: ${(e as Error).message} — assuming 0`);
    return 0;
  }
}

async function getRewardsPending(): Promise<number | null> {
  try {
    const url = `${HIRO_API}/v2/contracts/call-read/${INCENTIVES_ADDR}/${INCENTIVES_NAME}/get-vault-rewards`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ARC_STX_ADDRESS,
        arguments: [
          serializeCVToHex(principalCV(ARC_STX_ADDRESS)),
          serializeCVToHex(contractPrincipalCV(SBTC_ADDR, SBTC_NAME)),
          serializeCVToHex(contractPrincipalCV(WSTX_ADDR, WSTX_NAME)),
        ],
      }),
    });

    if (!response.ok) {
      log(`warn: get-vault-rewards returned ${response.status}`);
      return null;
    }

    const data = await response.json() as { okay: boolean; result?: string; cause?: string };
    if (!data.okay || !data.result) {
      log(`warn: get-vault-rewards not-okay: ${data.cause ?? "unknown"}`);
      return null;
    }

    const decoded = cvToJSON(hexToCV(data.result));
    if (decoded && typeof decoded === "object" && "value" in decoded) {
      return parseInt((decoded as { value: string }).value, 10);
    }
    return 0;
  } catch (e) {
    log(`warn: rewards check failed: ${(e as Error).message}`);
    return null;
  }
}

export default async function zestYieldManagerSensor(): Promise<string> {
  // Mempool-depth guard: welcome tasks send STX transactions that fill the
  // Stacks mempool chain depth for Arc's address. A Zest supply on the same
  // sender would hit TooMuchChaining. Skip before claiming the interval so
  // the sensor retries at the next 1-minute system timer fire once welcome
  // ops clear, rather than burning the full 120-minute window.
  //
  // Primary check: query actual Hiro mempool depth for Arc's address.
  const MEMPOOL_CONGESTION_THRESHOLD = 5;
  const mempoolDepth = await getMempoolDepth();
  if (mempoolDepth >= MEMPOOL_CONGESTION_THRESHOLD) {
    log(`skip: mempool congested — ${mempoolDepth} pending tx(s), retrying next cycle`);
    return "skip";
  }

  // Secondary check: active welcome tasks in DB (belt-and-suspenders — covers
  // the window between tx broadcast and Hiro indexing).
  const activeWelcomeTasks = getActiveTasks().filter(
    (t) => t.source != null && t.source.startsWith("welcome:"),
  );
  if (activeWelcomeTasks.length > 0) {
    log(
      `skip: ${activeWelcomeTasks.length} active welcome task(s) in flight — STX mempool likely congested, retrying next cycle`,
    );
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("run started — checking Zest yield position");

  const [sbtcBalance, stxBalance, position, rewardsPending] = await Promise.allSettled([
    getSbtcBalance(),
    getStxBalance(),
    getZestPosition(),
    getRewardsPending(),
  ]);

  const sbtc = sbtcBalance.status === "fulfilled" ? sbtcBalance.value : -1;
  const stx = stxBalance.status === "fulfilled" ? stxBalance.value : -1;
  const pos = position.status === "fulfilled" ? position.value : null;
  const rewards = rewardsPending.status === "fulfilled" ? rewardsPending.value : null;

  if (sbtc < 0 || stx < 0) {
    log("warn: failed to fetch balances — skipping");
    return "skip";
  }

  log(`balances: ${sbtc} sats sBTC, ${stx} uSTX STX`);
  if (pos !== null) {
    log(`position: ${pos.supplied} sats supplied, ${pos.borrowed} sats borrowed`);
  }
  if (rewards !== null) {
    log(`rewards: ${rewards} uSTX pending`);
  }

  // Skip write-task creation if STX gas is too low (write ops need ~100k uSTX)
  const hasGas = stx >= 100_000;

  let tasksCreated = 0;

  // Supply task: idle sBTC exceeds liquid reserve + minimum threshold
  const idleAboveReserve = sbtc - LIQUID_RESERVE_SATS;
  if (idleAboveReserve >= MIN_SUPPLY_AMOUNT_SATS) {
    if (!hasGas) {
      log(`warn: insufficient STX gas (${stx} uSTX) for supply — skipping supply task`);
    } else {
      const amountToSupply = Math.min(idleAboveReserve, MAX_SUPPLY_PER_CALL_SATS);
      const source = `sensor:${SENSOR_NAME}:supply`;
      const taskId = insertTaskIfNew(source, {
        subject: `Supply ${amountToSupply.toLocaleString()} sats idle sBTC to Zest yield pool`,
        description: [
          `Sensor detected idle sBTC above the ${LIQUID_RESERVE_SATS.toLocaleString()} sat liquid reserve threshold.`,
          ``,
          `Wallet sBTC: ${sbtc.toLocaleString()} sats`,
          `Liquid reserve: ${LIQUID_RESERVE_SATS.toLocaleString()} sats`,
          `Current Zest position: ${pos?.supplied?.toLocaleString() ?? "unknown"} sats supplied`,
          `STX gas: ${stx.toLocaleString()} uSTX`,
          ``,
          `Recommended supply amount: ${amountToSupply.toLocaleString()} sats`,
          ``,
          `Run: arc skills run --name zest-yield-manager -- run --action=supply --amount=${amountToSupply}`,
          ``,
          `The skill will perform pre-flight checks (gas, balance, spend limit) and output`,
          `the MCP command to execute via zest_supply tool.`,
        ].join("\n"),
        skills: JSON.stringify(["zest-yield-manager", "defi-zest"]),
        priority: 7,
        model: "sonnet",
      });
      if (taskId !== null) {
        log(`queued supply task #${taskId} for ${amountToSupply.toLocaleString()} sats`);
        tasksCreated++;
      } else {
        log("supply task already pending — skip");
      }
    }
  }

  // Claim task: rewards exceed claim threshold
  if (rewards !== null && rewards >= REWARDS_CLAIM_THRESHOLD_USTX) {
    if (!hasGas) {
      log(`warn: insufficient STX gas (${stx} uSTX) for claim — skipping claim task`);
    } else {
      const source = `sensor:${SENSOR_NAME}:claim`;
      const taskId = insertTaskIfNew(source, {
        subject: `Claim ${rewards.toLocaleString()} uSTX Zest wSTX rewards`,
        description: [
          `Sensor detected claimable wSTX incentive rewards on Zest Protocol.`,
          ``,
          `Pending rewards: ${rewards.toLocaleString()} uSTX (${(rewards / 1_000_000).toFixed(6)} STX)`,
          `Current Zest sBTC position: ${pos?.supplied?.toLocaleString() ?? "unknown"} sats`,
          `STX gas: ${stx.toLocaleString()} uSTX`,
          ``,
          `Run: arc skills run --name zest-yield-manager -- run --action=claim`,
          ``,
          `Post-conditions: rewards claimed as wSTX to wallet. No sBTC movement.`,
          `After claiming, consider supplying any new idle sBTC to Zest.`,
        ].join("\n"),
        skills: JSON.stringify(["zest-yield-manager", "defi-zest"]),
        priority: 7,
        model: "sonnet",
      });
      if (taskId !== null) {
        log(`queued claim task #${taskId} for ${rewards.toLocaleString()} uSTX rewards`);
        tasksCreated++;
      } else {
        log("claim task already pending — skip");
      }
    }
  }

  if (tasksCreated === 0) {
    const posStatus = pos ? `${pos.supplied.toLocaleString()} sats supplied` : "position unknown";
    const rewardStatus = rewards !== null ? `${rewards.toLocaleString()} uSTX pending` : "rewards unknown";
    log(`no action needed — ${posStatus}, ${rewardStatus}`);
  }

  return "ok";
}
