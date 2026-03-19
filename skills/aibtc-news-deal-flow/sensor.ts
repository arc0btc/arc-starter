// skills/aibtc-news-deal-flow/sensor.ts
// Sensor for Deal Flow signal hooks: Ordinals volume, x402 escrow, DAO treasury

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, recentTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "aibtc-news-deal-flow";
const INTERVAL_MINUTES = 60;
const UNISAT_API_BASE = "https://open-api.unisat.io";
const STACKS_API_BASE = "https://api.mainnet.hiro.so";

// Thresholds (from SKILL.md)
const ORDINALS_WEEKLY_VOLUME_USD = 2_000_000;   // $2M
const SATS_AUCTION_MIN_SATS = 50_000;           // 50k sats
const X402_WEEKLY_VOLUME_USD = 5_000_000;       // $5M
const DAO_TREASURY_CHANGE_BTC = 1.0;            // 1 BTC

const log = createSensorLogger(SENSOR_NAME);

interface HookState {
  lastOrdinalsCheck?: string;
  lastOrdinalsVolume?: number;
  lastX402Check?: string;
  lastX402Volume?: number;
  lastDaoCheck?: string;
  lastDaoTreasury?: number;
  lastSatsAuctionCheck?: string;
  [key: string]: unknown;
}

// ---- Ordinals Volume Hook ----

async function checkOrdinalsVolume(state: HookState): Promise<HookState> {
  const apiKey = await getCredential("unisat", "api_key").catch(() => null);
  if (!apiKey) {
    log("ordinals: unisat api_key not configured, skipping");
    return state;
  }

  try {
    // Fetch Ordinals inscription stats from Unisat
    const url = `${UNISAT_API_BASE}/v1/market/collection/auctions?limit=20&offset=0&orderBy=volume&timeType=7d`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });

    if (!response.ok) {
      log(`ordinals: unisat fetch failed (${response.status})`);
      return state;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const now = new Date().toISOString();

    // Sum 7-day volume across top collections (in satoshis)
    const list = (data?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;
    if (!list || !Array.isArray(list)) {
      log("ordinals: no list in response");
      state.lastOrdinalsCheck = now;
      return state;
    }

    // volume is in satoshis; 1 BTC ≈ $100k for rough conversion
    const totalSats = list.reduce((sum, item) => sum + ((item.volume as number) || 0), 0);
    const btcPrice = 100_000; // rough USD/BTC
    const volumeUsd = (totalSats / 100_000_000) * btcPrice;

    log(`ordinals: 7d volume ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()})`);

    state.lastOrdinalsVolume = volumeUsd;
    state.lastOrdinalsCheck = now;

    if (volumeUsd >= ORDINALS_WEEKLY_VOLUME_USD) {
      const source = `sensor:${SENSOR_NAME}:ordinals-volume`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`ordinals: threshold met — queuing signal task`);
        insertTask({
          subject: `File ordinals-business signal: Ordinals weekly volume ~$${Math.round(volumeUsd / 1_000_000 * 10) / 10}M`,
          description: `Ordinals 7-day marketplace volume reached ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}). File an ordinals-business signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nResearch: arc skills run --name aibtc-news-editorial -- fetch-ordinals-data\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals-business --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          status: "pending",
          source,
        });
      }
    }
  } catch (e) {
    const error = e as Error;
    log(`ordinals: error — ${error.message}`);
  }

  return state;
}

// ---- x402 Escrow Volume Hook ----

async function checkX402Escrow(state: HookState): Promise<HookState> {
  // x402 escrow contract address (configurable via hook state or default)
  const contractAddress = (state.x402ContractAddress as string) || "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B.x402-escrow";
  const [principal, contractName] = contractAddress.split(".");
  const now = new Date().toISOString();

  try {
    // Query recent contract transactions to estimate weekly volume
    const url = `${STACKS_API_BASE}/extended/v1/address/${principal}.${contractName}/transactions?limit=50&offset=0`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`x402: stacks api fetch failed (${response.status}), skipping`);
      state.lastX402Check = now;
      return state;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const txs = (data?.results as Array<Record<string, unknown>>) || [];

    // Filter transactions from the last 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyTxs = txs.filter((tx) => {
      const timestamp = (tx.burn_block_time_iso as string) || "";
      return timestamp && new Date(timestamp).getTime() > cutoff;
    });

    // Sum STX amounts from weekly transactions as proxy for volume
    const totalMicroStx = weeklyTxs.reduce((sum, tx) => {
      const events = (tx.events as Array<Record<string, unknown>>) || [];
      const stxAmount = events
        .filter((e) => e.event_type === "stx_asset")
        .reduce((s, e) => {
          const asset = (e.asset as Record<string, unknown>) || {};
          return s + (Number(asset.amount) || 0);
        }, 0);
      return sum + stxAmount;
    }, 0);

    const stxPrice = 2.0; // rough USD/STX
    const volumeUsd = (totalMicroStx / 1_000_000) * stxPrice;

    log(`x402: 7d volume ~$${Math.round(volumeUsd).toLocaleString()} from ${weeklyTxs.length} txs (threshold $${X402_WEEKLY_VOLUME_USD.toLocaleString()})`);

    state.lastX402Volume = volumeUsd;
    state.lastX402Check = now;

    if (volumeUsd >= X402_WEEKLY_VOLUME_USD) {
      const source = `sensor:${SENSOR_NAME}:x402-volume`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`x402: threshold met — queuing signal task`);
        insertTask({
          subject: `File ordinals-business signal: x402 weekly escrow volume ~$${Math.round(volumeUsd / 1_000_000 * 10) / 10}M`,
          description: `x402 agent escrow 7-day volume reached ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${X402_WEEKLY_VOLUME_USD.toLocaleString()}). File an ordinals-business signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nContract: ${contractAddress}\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals-business --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          status: "pending",
          source,
        });
      }
    }
  } catch (e) {
    const error = e as Error;
    log(`x402: error — ${error.message}`);
  }

  return state;
}

// ---- DAO Treasury Hook ----

async function checkDaoTreasury(state: HookState): Promise<HookState> {
  // DAO contract to monitor (configurable via hook state)
  const daoContract = (state.daoTreasuryContract as string) || "";
  const now = new Date().toISOString();

  if (!daoContract) {
    log("dao-treasury: no daoTreasuryContract configured in hook state, skipping");
    state.lastDaoCheck = now;
    return state;
  }

  try {
    const [principal, contractName] = daoContract.split(".");
    const url = `${STACKS_API_BASE}/extended/v1/address/${principal}.${contractName}/balances`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      log(`dao-treasury: stacks api fetch failed (${response.status}), skipping`);
      state.lastDaoCheck = now;
      return state;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const btcBalance = Number((data?.btc as Record<string, unknown>)?.balance || 0) / 100_000_000;

    log(`dao-treasury: ${daoContract} balance ${btcBalance} BTC`);

    const prev = (state.lastDaoTreasury as number) || 0;
    const change = Math.abs(btcBalance - prev);

    state.lastDaoTreasury = btcBalance;
    state.lastDaoCheck = now;

    if (prev > 0 && change >= DAO_TREASURY_CHANGE_BTC) {
      const direction = btcBalance > prev ? "increased" : "decreased";
      const source = `sensor:${SENSOR_NAME}:dao-treasury`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`dao-treasury: threshold met (${change.toFixed(2)} BTC change) — queuing signal task`);
        insertTask({
          subject: `File ordinals-business signal: DAO treasury ${direction} by ${change.toFixed(2)} BTC`,
          description: `${daoContract} treasury ${direction} by ${change.toFixed(2)} BTC (now ${btcBalance.toFixed(4)} BTC, was ${prev.toFixed(4)} BTC). Threshold: ${DAO_TREASURY_CHANGE_BTC} BTC.\n\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals-business --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          status: "pending",
          source,
        });
      }
    }
  } catch (e) {
    const error = e as Error;
    log(`dao-treasury: error — ${error.message}`);
  }

  return state;
}

// ---- Sats Auction Hook ----

async function checkSatsAuctions(state: HookState): Promise<HookState> {
  const now = new Date().toISOString();
  const apiKey = await getCredential("unisat", "api_key").catch(() => null);

  if (!apiKey) {
    log("sats-auctions: unisat api_key not configured, skipping");
    return state;
  }

  try {
    // Unisat rare sats marketplace
    const url = `${UNISAT_API_BASE}/v1/sat-collectibles/market/auctions?limit=20&offset=0&orderBy=price&order=desc`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });

    if (!response.ok) {
      log(`sats-auctions: unisat fetch failed (${response.status}), skipping`);
      state.lastSatsAuctionCheck = now;
      return state;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const list = (data?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;

    if (!list || !Array.isArray(list)) {
      log("sats-auctions: no auction list in response");
      state.lastSatsAuctionCheck = now;
      return state;
    }

    // Find highest recent auction in sats
    const topAuction = list[0];
    const priceSats = topAuction ? (Number(topAuction.price) || 0) : 0;

    log(`sats-auctions: top auction at ${priceSats.toLocaleString()} sats (threshold ${SATS_AUCTION_MIN_SATS.toLocaleString()})`);

    state.lastSatsAuctionCheck = now;

    if (priceSats >= SATS_AUCTION_MIN_SATS) {
      const source = `sensor:${SENSOR_NAME}:sats-auction`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`sats-auctions: threshold met — queuing signal task`);
        insertTask({
          subject: `File ordinals-business signal: Rare sat auction at ${priceSats.toLocaleString()} sats`,
          description: `Rare sat auction detected at ${priceSats.toLocaleString()} sats (threshold ${SATS_AUCTION_MIN_SATS.toLocaleString()} sats). File an ordinals-business signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nDetails: ${JSON.stringify(topAuction, null, 2).slice(0, 500)}\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals-business --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          status: "pending",
          source,
        });
      }
    }
  } catch (e) {
    const error = e as Error;
    log(`sats-auctions: error — ${error.message}`);
  }

  return state;
}

// ---- Bounty Activity Hook ----

async function checkBountyActivity(state: HookState): Promise<HookState> {
  // Bounty platform check — monitor aibtc.news or stacks-based bounty contracts
  // This hook is gated on a configured contract address; skips gracefully if not set
  const bountyContract = (state.bountyContract as string) || "";
  const now = new Date().toISOString();

  if (!bountyContract) {
    log("bounty: no bountyContract configured in hook state, skipping");
    return state;
  }

  try {
    const [principal, contractName] = bountyContract.split(".");
    const url = `${STACKS_API_BASE}/extended/v1/address/${principal}.${contractName}/transactions?limit=20&offset=0`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      log(`bounty: stacks api fetch failed (${response.status}), skipping`);
      return state;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const txs = (data?.results as Array<Record<string, unknown>>) || [];

    // Look for recent launch transactions (function calls named "launch", "create", "post-bounty")
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // last 24h
    const recentLaunches = txs.filter((tx) => {
      const timestamp = (tx.burn_block_time_iso as string) || "";
      const functionName = (tx.contract_call as Record<string, unknown>)?.function_name as string || "";
      return timestamp && new Date(timestamp).getTime() > cutoff &&
        (functionName.includes("launch") || functionName.includes("create") || functionName.includes("post"));
    });

    log(`bounty: ${recentLaunches.length} new bounty launches in last 24h`);

    if (recentLaunches.length > 0) {
      const source = `sensor:${SENSOR_NAME}:bounty-launch`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`bounty: new launches detected — queuing signal task`);
        insertTask({
          subject: `File ordinals-business signal: ${recentLaunches.length} new bounty program(s) launched`,
          description: `${recentLaunches.length} new bounty program(s) detected on ${bountyContract} in the last 24 hours. Verify reward amounts and file a Deal Flow signal.\n\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals-business --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          status: "pending",
          source,
        });
      }
    }
  } catch (e) {
    const error = e as Error;
    log(`bounty: error — ${error.message}`);
  }

  return state;
}

// ---- Main Sensor ----

export default async function dealFlowSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    const hookState = ((await readHookState(SENSOR_NAME)) || {}) as HookState;
    let state = { ...hookState };

    // Run all 5 hooks sequentially to respect Unisat rate limits
    state = await checkOrdinalsVolume(state);
    state = await checkSatsAuctions(state);
    state = await checkX402Escrow(state);
    state = await checkBountyActivity(state);
    state = await checkDaoTreasury(state);

    await writeHookState(SENSOR_NAME, state);

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
