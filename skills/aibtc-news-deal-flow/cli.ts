#!/usr/bin/env bun
// skills/aibtc-news-deal-flow/cli.ts
// CLI for Deal Flow signal hooks: manual check + status

import { readHookState, writeHookState } from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "aibtc-news-deal-flow";
const UNISAT_API_BASE = "https://open-api.unisat.io";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const STACKS_API_BASE = "https://api.mainnet.hiro.so";
const NFT_COLLECTIONS = ["bitcoin-frogs", "nodemonkes", "bitcoin-puppets"];

// Thresholds (mirror sensor.ts)
const ORDINALS_WEEKLY_VOLUME_USD = 2_000_000;
const SATS_AUCTION_MIN_SATS = 10_000;    // lowered from 50k
const X402_WEEKLY_VOLUME_USD = 100_000;  // lowered from $5M
const DAO_TREASURY_CHANGE_BTC = 1.0;

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [deal-flow/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

// ---- Check command ----

async function cmdCheck(): Promise<void> {
  process.stdout.write("=== Deal Flow Signal Hooks Check ===\n\n");

  const apiKey = await getCredential("unisat", "api_key").catch(() => null);
  const hookState = ((await readHookState(SENSOR_NAME)) || {}) as Record<string, unknown>;

  const results: Array<{ hook: string; status: string; value?: string; threshold: string; fired: boolean }> = [];

  // 1. Ordinals weekly volume (CoinGecko NFT collections — /v1/market/collection/auctions returns 404)
  process.stdout.write("1. Ordinals Weekly Volume\n");
  try {
    let totalVolumeBtc = 0;
    let validCount = 0;
    for (const id of NFT_COLLECTIONS) {
      try {
        const response = await fetch(`${COINGECKO_API}/nfts/${id}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          process.stdout.write(`   CoinGecko ${id}: HTTP ${response.status}\n`);
          continue;
        }
        const data = (await response.json()) as Record<string, unknown>;
        const volume24h = (data.volume_24h as Record<string, number> | undefined)?.native_currency ?? 0;
        totalVolumeBtc += volume24h;
        validCount++;
      } catch {
        process.stdout.write(`   CoinGecko ${id}: error\n`);
      }
      await new Promise((r) => setTimeout(r, 500)); // CoinGecko rate limit
    }
    if (validCount === 0) throw new Error("no CoinGecko data returned");
    const weeklyVolumeBtc = totalVolumeBtc * 7;
    const volumeUsd = weeklyVolumeBtc * 100_000;
    const fired = volumeUsd >= ORDINALS_WEEKLY_VOLUME_USD;
    process.stdout.write(`   volume: ~$${Math.round(volumeUsd).toLocaleString()} (${validCount}/${NFT_COLLECTIONS.length} collections)\n`);
    process.stdout.write(`   threshold: >=$${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}\n`);
    process.stdout.write(`   signal: ${fired ? "YES — would queue filing task" : "no"}\n`);
    results.push({ hook: "ordinals-volume", status: "ok", value: `$${Math.round(volumeUsd).toLocaleString()}`, threshold: `>=$${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}`, fired });
  } catch (e) {
    const error = e as Error;
    process.stdout.write(`   status: ERROR — ${error.message}\n`);
    results.push({ hook: "ordinals-volume", status: "error", threshold: `>=$${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}`, fired: false });
  }

  // 2. Sats auctions (indexer recent inscriptions — /v1/sat-collectibles/market/auctions returns 404)
  process.stdout.write("\n2. Sats Auctions\n");
  if (!apiKey) {
    process.stdout.write("   status: SKIP (unisat api_key not configured)\n");
    results.push({ hook: "sats-auctions", status: "skip", threshold: "any rare-sat inscriptions", fired: false });
  } else {
    try {
      const url = `${UNISAT_API_BASE}/v1/indexer/inscription/info/recent?limit=50`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      const list = (data?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;
      const rareSats = (list || []).filter((item) => {
        const rarity = item.satRarity as string | undefined;
        return rarity && rarity !== "common";
      });
      const rareCount = rareSats.length;
      const fired = rareCount > 0;
      process.stdout.write(`   rare-sat inscriptions: ${rareCount}/${(list || []).length} recent\n`);
      process.stdout.write(`   threshold: any rare-sat inscriptions\n`);
      process.stdout.write(`   signal: ${fired ? "YES — would queue filing task" : "no"}\n`);
      results.push({ hook: "sats-auctions", status: "ok", value: `${rareCount} rare-sat inscriptions`, threshold: "any rare-sat inscriptions", fired });
    } catch (e) {
      const error = e as Error;
      process.stdout.write(`   status: ERROR — ${error.message}\n`);
      results.push({ hook: "sats-auctions", status: "error", threshold: "any rare-sat inscriptions", fired: false });
    }
  }

  // 3. x402 escrow volume
  process.stdout.write("\n3. x402 Escrow Volume\n");
  const x402Contract = (hookState.x402ContractAddress as string) || "";
  if (!x402Contract) {
    process.stdout.write("   status: SKIP (no x402ContractAddress in hook state)\n");
    process.stdout.write("   configure: set x402ContractAddress in db/hook-state/aibtc-news-deal-flow.json\n");
    results.push({ hook: "x402-escrow", status: "skip", threshold: `>=$${X402_WEEKLY_VOLUME_USD.toLocaleString()}`, fired: false });
  } else {
    try {
      const [principal, contractName] = x402Contract.split(".");
      const url = `${STACKS_API_BASE}/extended/v1/address/${principal}.${contractName}/transactions?limit=50&offset=0`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      const txs = (data?.results as Array<Record<string, unknown>>) || [];
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weeklyTxs = txs.filter((tx) => {
        const timestamp = (tx.burn_block_time_iso as string) || "";
        return timestamp && new Date(timestamp).getTime() > cutoff;
      });
      const totalMicroStx = weeklyTxs.reduce((sum, tx) => {
        const events = (tx.events as Array<Record<string, unknown>>) || [];
        return sum + events
          .filter((e) => e.event_type === "stx_asset")
          .reduce((s, e) => s + (Number((e.asset as Record<string, unknown>)?.amount) || 0), 0);
      }, 0);
      const volumeUsd = (totalMicroStx / 1_000_000) * 2.0;
      const fired = volumeUsd >= X402_WEEKLY_VOLUME_USD;
      process.stdout.write(`   7d volume: ~$${Math.round(volumeUsd).toLocaleString()} (${weeklyTxs.length} txs)\n`);
      process.stdout.write(`   threshold: >=$${X402_WEEKLY_VOLUME_USD.toLocaleString()}\n`);
      process.stdout.write(`   signal: ${fired ? "YES — would queue filing task" : "no"}\n`);
      results.push({ hook: "x402-escrow", status: "ok", value: `$${Math.round(volumeUsd).toLocaleString()}`, threshold: `>=$${X402_WEEKLY_VOLUME_USD.toLocaleString()}`, fired });
    } catch (e) {
      const error = e as Error;
      process.stdout.write(`   status: ERROR — ${error.message}\n`);
      results.push({ hook: "x402-escrow", status: "error", threshold: `>=$${X402_WEEKLY_VOLUME_USD.toLocaleString()}`, fired: false });
    }
  }

  // 4. Bounty programs
  process.stdout.write("\n4. Bounty Program Activity\n");
  const bountyContract = (hookState.bountyContract as string) || "";
  if (!bountyContract) {
    process.stdout.write("   status: SKIP (no bountyContract in hook state)\n");
    process.stdout.write("   configure: set bountyContract in db/hook-state/aibtc-news-deal-flow.json\n");
    results.push({ hook: "bounty-launch", status: "skip", threshold: ">10 sats reward", fired: false });
  } else {
    process.stdout.write(`   contract: ${bountyContract}\n`);
    results.push({ hook: "bounty-launch", status: "configured", threshold: ">10 sats reward", fired: false });
  }

  // 5. DAO treasury
  process.stdout.write("\n5. DAO Treasury Change\n");
  const daoContract = (hookState.daoTreasuryContract as string) || "";
  if (!daoContract) {
    process.stdout.write("   status: SKIP (no daoTreasuryContract in hook state)\n");
    process.stdout.write("   configure: set daoTreasuryContract in db/hook-state/aibtc-news-deal-flow.json\n");
    results.push({ hook: "dao-treasury", status: "skip", threshold: `>=${DAO_TREASURY_CHANGE_BTC} BTC change`, fired: false });
  } else {
    try {
      const [principal, contractName] = daoContract.split(".");
      const url = `${STACKS_API_BASE}/extended/v1/address/${principal}.${contractName}/balances`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      const btcBalance = Number((data?.btc as Record<string, unknown>)?.balance || 0) / 100_000_000;
      const prev = (hookState.lastDaoTreasury as number) || 0;
      const change = Math.abs(btcBalance - prev);
      const fired = prev > 0 && change >= DAO_TREASURY_CHANGE_BTC;
      process.stdout.write(`   current: ${btcBalance.toFixed(4)} BTC\n`);
      process.stdout.write(`   previous: ${prev.toFixed(4)} BTC\n`);
      process.stdout.write(`   change: ${change.toFixed(4)} BTC (threshold ${DAO_TREASURY_CHANGE_BTC} BTC)\n`);
      process.stdout.write(`   signal: ${fired ? "YES — would queue filing task" : "no"}\n`);
      results.push({ hook: "dao-treasury", status: "ok", value: `${btcBalance.toFixed(4)} BTC`, threshold: `>=${DAO_TREASURY_CHANGE_BTC} BTC change`, fired });
    } catch (e) {
      const error = e as Error;
      process.stdout.write(`   status: ERROR — ${error.message}\n`);
      results.push({ hook: "dao-treasury", status: "error", threshold: `>=${DAO_TREASURY_CHANGE_BTC} BTC change`, fired: false });
    }
  }

  // Summary
  const fired = results.filter((r) => r.fired).length;
  process.stdout.write(`\n=== Summary: ${fired}/${results.length} hooks would fire ===\n`);
  for (const r of results) {
    const icon = r.fired ? "▲" : r.status === "skip" ? "○" : r.status === "error" ? "✗" : "·";
    process.stdout.write(`  ${icon} ${r.hook}: ${r.value || r.status} (${r.threshold})\n`);
  }
}

// ---- Status command ----

async function cmdStatus(): Promise<void> {
  const hookState = ((await readHookState(SENSOR_NAME)) || {}) as Record<string, unknown>;

  process.stdout.write("=== Deal Flow Sensor Status ===\n\n");

  const checks = [
    { label: "Ordinals volume check", key: "lastOrdinalsCheck", valueKey: "lastOrdinalsVolume", unit: "USD" },
    { label: "Sats auction check", key: "lastSatsAuctionCheck", valueKey: null, unit: null },
    { label: "x402 escrow check", key: "lastX402Check", valueKey: "lastX402Volume", unit: "USD" },
    { label: "DAO treasury check", key: "lastDaoCheck", valueKey: "lastDaoTreasury", unit: "BTC" },
  ];

  for (const check of checks) {
    const lastRun = (hookState[check.key] as string) || "never";
    process.stdout.write(`${check.label}:\n`);
    process.stdout.write(`  last run: ${lastRun}\n`);
    if (check.valueKey && hookState[check.valueKey] !== undefined) {
      const value = hookState[check.valueKey] as number;
      const formatted = check.unit === "USD"
        ? `$${Math.round(value).toLocaleString()}`
        : `${value.toFixed(4)} ${check.unit}`;
      process.stdout.write(`  last value: ${formatted}\n`);
    }
  }

  // Config status
  process.stdout.write("\nConfiguration:\n");
  process.stdout.write(`  unisat api_key: ${hookState.unisatConfigured ? "configured" : "check arc creds"}\n`);
  process.stdout.write(`  x402ContractAddress: ${(hookState.x402ContractAddress as string) || "not set"}\n`);
  process.stdout.write(`  daoTreasuryContract: ${(hookState.daoTreasuryContract as string) || "not set"}\n`);
  process.stdout.write(`  bountyContract: ${(hookState.bountyContract as string) || "not set"}\n`);

  process.stdout.write("\nThresholds:\n");
  process.stdout.write(`  Ordinals weekly volume: >= $${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}\n`);
  process.stdout.write(`  Sats auction: >= ${SATS_AUCTION_MIN_SATS.toLocaleString()} sats\n`);
  process.stdout.write(`  x402 escrow weekly: >= $${X402_WEEKLY_VOLUME_USD.toLocaleString()}\n`);
  process.stdout.write(`  DAO treasury change: >= ${DAO_TREASURY_CHANGE_BTC} BTC\n`);
}

// ---- Configure command ----

async function cmdConfigure(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const hookState = ((await readHookState(SENSOR_NAME)) || {}) as Record<string, unknown>;
  let changed = false;

  if (flags["x402-contract"]) {
    hookState.x402ContractAddress = flags["x402-contract"];
    process.stdout.write(`Set x402ContractAddress: ${flags["x402-contract"]}\n`);
    changed = true;
  }
  if (flags["dao-contract"]) {
    hookState.daoTreasuryContract = flags["dao-contract"];
    process.stdout.write(`Set daoTreasuryContract: ${flags["dao-contract"]}\n`);
    changed = true;
  }
  if (flags["bounty-contract"]) {
    hookState.bountyContract = flags["bounty-contract"];
    process.stdout.write(`Set bountyContract: ${flags["bounty-contract"]}\n`);
    changed = true;
  }

  if (!changed) {
    process.stdout.write("Usage: configure --x402-contract <address.name> --dao-contract <address.name> --bounty-contract <address.name>\n");
    return;
  }

  await writeHookState(SENSOR_NAME, hookState as Parameters<typeof writeHookState>[1]);
  process.stdout.write("Hook state updated.\n");
}

// ---- Main ----

const [command, ...rest] = process.argv.slice(2);
log(`command: ${command || "(none)"}`);

switch (command) {
  case "check":
    await cmdCheck();
    break;
  case "status":
    await cmdStatus();
    break;
  case "configure":
    await cmdConfigure(rest);
    break;
  default:
    process.stdout.write("Commands: check, status, configure\n");
    process.stdout.write("  check                          Run all signal hooks once\n");
    process.stdout.write("  status                         Show last check timestamps and config\n");
    process.stdout.write("  configure --x402-contract ...  Set contract addresses for x402/DAO/bounty hooks\n");
    process.exit(1);
}
