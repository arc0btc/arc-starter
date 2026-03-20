#!/usr/bin/env bun

import { initDatabase } from "../../src/db.ts";
import {
  type AssetBalance,
  type BalanceSnapshotRow,
  type CheckResult,
  DEFAULT_THRESHOLDS,
  WALLET_ADDRESSES,
} from "./types.ts";

// ---- DB Setup ----

function ensureTable(): void {
  const db = initDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      btc_sats INTEGER NOT NULL DEFAULT 0,
      stx_micro INTEGER NOT NULL DEFAULT 0,
      sbtc_sats INTEGER NOT NULL DEFAULT 0,
      btc_address TEXT NOT NULL,
      stx_address TEXT NOT NULL
    )
  `);
}

// ---- API Fetchers ----

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

  // sBTC token contract on mainnet
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

// ---- Commands ----

async function runCheck(): Promise<void> {
  ensureTable();
  const db = initDatabase();

  const [btc, stxData] = await Promise.all([
    fetchBtcBalance(WALLET_ADDRESSES.btc),
    fetchStxBalances(WALLET_ADDRESSES.stx),
  ]);

  const balances: AssetBalance[] = [btc, stxData.stx, stxData.sbtc];

  // Store snapshot
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

  const result: CheckResult = {
    snapshot: {
      timestamp: new Date().toISOString(),
      btcAddress: WALLET_ADDRESSES.btc,
      stxAddress: WALLET_ADDRESSES.stx,
      balances,
    },
    thresholds: DEFAULT_THRESHOLDS,
    belowThreshold,
    healthy: belowThreshold.length === 0,
  };

  // Serialize with bigint handling
  const output = JSON.stringify(
    result,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
  process.stdout.write(output + "\n");
}

function runHistory(): void {
  ensureTable();
  const db = initDatabase();

  const rows = db
    .query(
      `SELECT * FROM balance_snapshots ORDER BY timestamp DESC LIMIT 20`
    )
    .all() as BalanceSnapshotRow[];

  if (rows.length === 0) {
    process.stdout.write("No balance snapshots yet. Run 'check' first.\n");
    return;
  }

  process.stdout.write(
    JSON.stringify(
      rows.map((r) => ({
        timestamp: r.timestamp,
        btc: (r.btc_sats / 1e8).toFixed(8),
        stx: (r.stx_micro / 1e6).toFixed(6),
        sbtc: (r.sbtc_sats / 1e8).toFixed(8),
      })),
      null,
      2
    ) + "\n"
  );
}

function runThresholds(): void {
  process.stdout.write(JSON.stringify(DEFAULT_THRESHOLDS, null, 2) + "\n");
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(
    `treasury-health CLI

USAGE
  arc skills run --name treasury-health -- <subcommand>

SUBCOMMANDS
  check        Fetch current balances, store snapshot, output JSON
  history      Show recent balance snapshots (last 20)
  thresholds   Show current alert thresholds
`
  );
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "check":
      await runCheck();
      break;
    case "history":
      runHistory();
      break;
    case "thresholds":
      runThresholds();
      break;
    default:
      if (sub) {
        process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      }
      printUsage();
      if (sub) process.exit(1);
      break;
  }
}

main();
