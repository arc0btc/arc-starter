// skills/aibtc-news-deal-flow/sensor.ts
// Sensor for Deal Flow signal hooks: Ordinals volume, x402 escrow, DAO treasury

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, isDailySignalCapHit, recentTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "aibtc-news-deal-flow";
const INTERVAL_MINUTES = 60;
const UNISAT_API_BASE = "https://open-api.unisat.io";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const STACKS_API_BASE = "https://api.mainnet.hiro.so";
const NFT_COLLECTIONS = ["bitcoin-frogs", "nodemonkes", "bitcoin-puppets"];

// Thresholds (from SKILL.md)
const ORDINALS_WEEKLY_VOLUME_USD = 2_000_000;   // $2M
const SATS_AUCTION_MIN_SATS = 10_000;           // 10k sats (lowered from 50k — capture more activity)
const X402_WEEKLY_VOLUME_USD = 100_000;         // $100K (lowered from $5M — realistic for current volumes)
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
  // /v1/market/collection/auctions returns 404 — use CoinGecko NFT API instead (no auth required)
  try {
    let totalVolumeBtc = 0;
    let validCount = 0;

    for (const id of NFT_COLLECTIONS) {
      try {
        const response = await fetch(`${COINGECKO_API}/nfts/${id}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          log(`ordinals: CoinGecko ${id} returned ${response.status}`);
          continue;
        }
        const data = (await response.json()) as Record<string, unknown>;
        const volume24h = (data.volume_24h as Record<string, number> | undefined)?.native_currency ?? 0;
        totalVolumeBtc += volume24h;
        validCount++;
      } catch (e) {
        log(`ordinals: CoinGecko ${id} error — ${(e as Error).message}`);
      }
      await Bun.sleep(500); // CoinGecko free tier: ~10-30 req/min
    }

    const now = new Date().toISOString();

    if (validCount === 0) {
      log("ordinals: no CoinGecko data available, skipping");
      state.lastOrdinalsCheck = now;
      return state;
    }

    // Estimate 7d volume from 24h data (rough approximation)
    const weeklyVolumeBtc = totalVolumeBtc * 7;
    const btcPrice = 100_000; // rough USD/BTC
    const volumeUsd = weeklyVolumeBtc * btcPrice;

    log(`ordinals: 7d volume estimate ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()})`);

    state.lastOrdinalsVolume = volumeUsd;
    state.lastOrdinalsCheck = now;

    if (volumeUsd >= ORDINALS_WEEKLY_VOLUME_USD) {
      const source = `sensor:${SENSOR_NAME}:ordinals-volume`;
      if (isDailySignalCapHit()) {
        log("ordinals: daily cap hit (6/6); skipping signal task");
      } else if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`ordinals: threshold met — queuing signal task`);
        insertTask({
          subject: `File ordinals signal: Ordinals weekly volume ~$${Math.round(volumeUsd / 1_000_000 * 10) / 10}M`,
          description: `Ordinals 7-day marketplace volume estimated at ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${ORDINALS_WEEKLY_VOLUME_USD.toLocaleString()}) from CoinGecko NFT collection data (${NFT_COLLECTIONS.join(", ")}). File an ordinals signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nResearch: arc skills run --name aibtc-news-editorial -- fetch-ordinals-data\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          model: "sonnet",
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
      if (isDailySignalCapHit()) {
        log("x402: daily cap hit (6/6); skipping signal task");
      } else if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`x402: threshold met — queuing signal task`);
        insertTask({
          subject: `File ordinals signal: x402 weekly escrow volume ~$${Math.round(volumeUsd / 1_000_000 * 10) / 10}M`,
          description: `x402 agent escrow 7-day volume reached ~$${Math.round(volumeUsd).toLocaleString()} (threshold $${X402_WEEKLY_VOLUME_USD.toLocaleString()}). File an ordinals signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nContract: ${contractAddress}\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          model: "sonnet",
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
      if (isDailySignalCapHit()) {
        log("dao-treasury: daily cap hit (6/6); skipping signal task");
      } else if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`dao-treasury: threshold met (${change.toFixed(2)} BTC change) — queuing signal task`);
        insertTask({
          subject: `File ordinals signal: DAO treasury ${direction} by ${change.toFixed(2)} BTC`,
          description: `${daoContract} treasury ${direction} by ${change.toFixed(2)} BTC (now ${btcBalance.toFixed(4)} BTC, was ${prev.toFixed(4)} BTC). Threshold: ${DAO_TREASURY_CHANGE_BTC} BTC.\n\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          model: "sonnet",
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
    // /v1/sat-collectibles/market/auctions returns 404 — use indexer recent inscriptions instead
    // Filter for inscriptions on non-common-rarity satoshis as a proxy for rare-sat activity
    const url = `${UNISAT_API_BASE}/v1/indexer/inscription/info/recent?limit=50`;
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
      log("sats-auctions: no inscriptions in response");
      state.lastSatsAuctionCheck = now;
      return state;
    }

    // Filter for inscriptions on non-common-rarity sats
    const rareSats = list.filter((item) => {
      const rarity = item.satRarity as string | undefined;
      return rarity && rarity !== "common";
    });
    const rareCount = rareSats.length;

    log(`sats-auctions: ${rareCount}/${list.length} recent inscriptions on rare sats (threshold: >=${SATS_AUCTION_MIN_SATS.toLocaleString()} sats or any activity)`);

    state.lastSatsAuctionCheck = now;

    if (rareCount > 0) {
      const topItem = rareSats[0];
      const source = `sensor:${SENSOR_NAME}:sats-auction`;
      if (isDailySignalCapHit()) {
        log("sats-auctions: daily cap hit (6/6); skipping signal task");
      } else if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`sats-auctions: rare sat activity detected (${rareCount} inscriptions) — queuing signal task`);
        insertTask({
          subject: `File ordinals signal: ${rareCount} inscriptions on rare sats detected`,
          description: `${rareCount} recent inscriptions on special-rarity satoshis detected via Unisat indexer. Top example: sat rarity "${topItem.satRarity}", inscription #${topItem.inscriptionNumber ?? "unknown"}. File an ordinals signal (Arc's only beat — do NOT file to deal-flow, dao-watch, or btc-macro).\n\nDetails: ${JSON.stringify(topItem, null, 2).slice(0, 500)}\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          model: "sonnet",
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
      if (isDailySignalCapHit()) {
        log("bounty: daily cap hit (6/6); skipping signal task");
      } else if (!recentTaskExistsForSource(source, 24 * 60)) {
        log(`bounty: new launches detected — queuing signal task`);
        insertTask({
          subject: `File ordinals signal: ${recentLaunches.length} new bounty program(s) launched`,
          description: `${recentLaunches.length} new bounty program(s) detected on ${bountyContract} in the last 24 hours. Verify reward amounts and file an ordinals signal.\n\nFile: arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals --claim "..." --evidence "..." --implication "..."`,
          skills: JSON.stringify(["aibtc-news-editorial", "aibtc-news-deal-flow"]),
          priority: 6,
          model: "sonnet",
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
