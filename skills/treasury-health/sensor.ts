import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";
import { DEFAULT_THRESHOLDS, WALLET_ADDRESSES } from "./types.ts";
import type { AssetBalance } from "./types.ts";

const SENSOR_NAME = "treasury-health";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:treasury-health";
const log = createSensorLogger(SENSOR_NAME);

// ---- API Fetchers (mirrored from cli.ts — sensors can't import CLI entry points) ----

async function fetchBtcBalance(address: string): Promise<AssetBalance> {
  const resp = await fetch(`https://mempool.space/api/address/${address}`);
  if (!resp.ok) throw new Error(`BTC balance fetch failed: ${resp.status}`);
  const data = (await resp.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const confirmedSats =
    data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const pendingSats =
    data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  const totalSats = confirmedSats + pendingSats;
  return {
    asset: "btc",
    denomination: "BTC",
    balance: totalSats / 1e8,
    rawBalance: BigInt(totalSats),
  };
}

async function fetchStxBalances(
  address: string
): Promise<{ stx: AssetBalance; sbtc: AssetBalance }> {
  const resp = await fetch(
    `https://api.hiro.so/extended/v1/address/${address}/balances`
  );
  if (!resp.ok) throw new Error(`STX balance fetch failed: ${resp.status}`);
  const data = (await resp.json()) as {
    stx: { balance: string };
    fungible_tokens: Record<string, { balance: string }>;
  };

  const stxMicro = BigInt(data.stx.balance);
  const sbtcKey = Object.keys(data.fungible_tokens).find((k) =>
    k.toLowerCase().includes("sbtc")
  );
  const sbtcSats = sbtcKey
    ? BigInt(data.fungible_tokens[sbtcKey].balance)
    : 0n;

  return {
    stx: {
      asset: "stx",
      denomination: "STX",
      balance: Number(stxMicro) / 1e6,
      rawBalance: stxMicro,
    },
    sbtc: {
      asset: "sbtc",
      denomination: "sBTC",
      balance: Number(sbtcSats) / 1e8,
      rawBalance: sbtcSats,
    },
  };
}

// ---- Sensor ----

export default async function treasuryHealthSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("Fetching balances...");

  let btc: AssetBalance;
  let stxData: { stx: AssetBalance; sbtc: AssetBalance };

  try {
    [btc, stxData] = await Promise.all([
      fetchBtcBalance(WALLET_ADDRESSES.btc),
      fetchStxBalances(WALLET_ADDRESSES.stx),
    ]);
  } catch (err) {
    log(`Balance fetch error: ${err}`);
    return "error";
  }

  // Store snapshot
  const db = initDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      btc_sats INTEGER NOT NULL DEFAULT 0,
      stx_micro INTEGER NOT NULL DEFAULT 0,
      sbtc_sats INTEGER NOT NULL DEFAULT 0,
      btc_address TEXT NOT NULL,
      stx_address TEXT NOT NULL
    )`
  );
  db.run(
    `INSERT INTO balance_snapshots (btc_sats, stx_micro, sbtc_sats, btc_address, stx_address)
     VALUES (?, ?, ?, ?, ?)`,
    [
      Number(btc.rawBalance),
      Number(stxData.stx.rawBalance),
      Number(stxData.sbtc.rawBalance),
      WALLET_ADDRESSES.btc,
      WALLET_ADDRESSES.stx,
    ]
  );

  log(
    `Snapshot stored — BTC: ${btc.balance}, STX: ${stxData.stx.balance}, sBTC: ${stxData.sbtc.balance}`
  );

  // Check thresholds
  const balances = [btc, stxData.stx, stxData.sbtc];
  const belowThreshold = balances.filter((b) => {
    switch (b.asset) {
      case "btc":
        return b.balance < DEFAULT_THRESHOLDS.btcMin;
      case "stx":
        return b.balance < DEFAULT_THRESHOLDS.stxMin;
      case "sbtc":
        return b.balance < DEFAULT_THRESHOLDS.sbtcMin;
    }
  });

  if (belowThreshold.length === 0) {
    log("All balances healthy");
    return "ok";
  }

  // Build alert details
  const alerts = belowThreshold
    .map((b) => `${b.denomination}: ${b.balance} (below minimum)`)
    .join(", ");

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Low balance alert: ${alerts}`,
    description: `Treasury health check detected low balances.\n\n${belowThreshold
      .map((b) => {
        const min =
          b.asset === "btc"
            ? DEFAULT_THRESHOLDS.btcMin
            : b.asset === "stx"
              ? DEFAULT_THRESHOLDS.stxMin
              : DEFAULT_THRESHOLDS.sbtcMin;
        return `- ${b.denomination}: ${b.balance} (threshold: ${min})`;
      })
      .join("\n")}\n\nAction: Review wallet funding. Consider topping up before next inscription or payout cycle.`,
    priority: 7,
    skills: JSON.stringify(["treasury-health", "bitcoin-wallet"]),
  });

  if (id !== null) {
    log(`Alert task created: #${id} — ${alerts}`);
  } else {
    log("Alert already pending, skipped duplicate");
  }

  return "ok";
}
