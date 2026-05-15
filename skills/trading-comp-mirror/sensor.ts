// skills/trading-comp-mirror/sensor.ts
//
// Polls the AIBTC Trading Competition API for competitor trades.
// Detects new trades since last run and caches them to trades.json.
//
// Competitors are configured in skills/trading-comp-mirror/competitors.json.
// Trade cache lives in skills/trading-comp-mirror/trades.json (newest 500).
// Sensor state (seen_txids, timing) in db/hook-state/trading-comp-mirror.json.

import { resolve } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";

const SENSOR_NAME = "trading-comp-mirror";
const INTERVAL_MINUTES = 10;
const TRADES_PER_POLL = 50;
const MAX_CACHED_TRADES = 500;
const MAX_SEEN_TXIDS_PER_ADDR = 200;
const COMP_START_TIMESTAMP = 1778700600; // 2026-05-13T19:30:00Z

const API_BASE =
  process.env.AIBTC_CAMPAIGN_API_URL ?? "https://aibtc.com/api/competition";

const COMPETITORS_PATH = resolve(import.meta.dir, "competitors.json");
const TRADES_PATH = resolve(import.meta.dir, "trades.json");

interface Competitor {
  address: string;
  label: string;
}

interface ApiTrade {
  txid: string;
  sender: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  burn_block_time: number;
  tx_status: string;
  source?: string;
  scored_value?: number;
  scored_at?: string;
}

interface TradeRecord {
  txid: string;
  competitor_address: string;
  competitor_label: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  burn_block_time: number;
  tx_status: string;
  detected_at: string;
}

export default async function (): Promise<string> {
  const log = createSensorLogger(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const competitorsFile = Bun.file(COMPETITORS_PATH);
  if (!(await competitorsFile.exists())) {
    log("competitors.json not found — skip");
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: 1,
      seen_txids: {},
    });
    return "skip";
  }

  const competitors: Competitor[] = await competitorsFile.json();
  if (competitors.length === 0) {
    log("competitors.json is empty — skip");
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: 1,
      seen_txids: {},
    });
    return "skip";
  }

  const state = await readHookState(SENSOR_NAME);
  const seenTxids: Record<string, string[]> =
    (state?.seen_txids as Record<string, string[]>) ?? {};

  const tradesFile = Bun.file(TRADES_PATH);
  const existingTrades: TradeRecord[] = (await tradesFile.exists())
    ? await tradesFile.json()
    : [];

  // Guard against hook-state loss: treat anything already in trades.json as seen
  const cachedTxidSet = new Set(existingTrades.map((t) => t.txid));

  const newTrades: TradeRecord[] = [];

  for (const competitor of competitors) {
    const { address, label } = competitor;
    const seenForAddr = seenTxids[address] ?? [];

    try {
      const url = `${API_BASE}/trades?address=${encodeURIComponent(address)}&limit=${TRADES_PER_POLL}`;
      const resp = await fetchWithRetry(url, undefined, 1);

      if (!resp.ok) {
        log(`${label}: API error ${resp.status} — skip`);
        continue;
      }

      const data = (await resp.json()) as { trades?: ApiTrade[] };
      const trades = data.trades ?? [];

      let newForAddr = 0;
      for (const trade of trades) {
        const txid = trade.txid.toLowerCase().replace(/^0x/, "");
        const normalizedTxid = `0x${txid}`;

        // Skip pre-competition trades
        if (trade.burn_block_time < COMP_START_TIMESTAMP) continue;
        // Skip already-seen txids (hook state + trades.json cache)
        if (seenForAddr.includes(normalizedTxid)) continue;
        if (cachedTxidSet.has(normalizedTxid)) continue;
        // Skip failed swaps (Clarity aborts are not real trades)
        if (trade.tx_status !== "success") continue;

        newTrades.push({
          txid: normalizedTxid,
          competitor_address: address,
          competitor_label: label,
          token_in: trade.token_in,
          token_out: trade.token_out,
          amount_in: trade.amount_in,
          amount_out: trade.amount_out,
          burn_block_time: trade.burn_block_time,
          tx_status: trade.tx_status,
          detected_at: new Date().toISOString(),
        });

        seenForAddr.push(normalizedTxid);
        cachedTxidSet.add(normalizedTxid);
        newForAddr++;
      }

      // Bound seen_txids per address
      seenTxids[address] = seenForAddr.slice(-MAX_SEEN_TXIDS_PER_ADDR);

      log(
        `${label}: ${trades.length} fetched, ${newForAddr} new (${seenForAddr.length} seen total)`,
      );
    } catch (err) {
      log(
        `${label}: error — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Merge new trades with cache, sort newest first, cap at MAX_CACHED_TRADES
  const allTrades = [...newTrades, ...existingTrades]
    .sort((a, b) => b.burn_block_time - a.burn_block_time)
    .slice(0, MAX_CACHED_TRADES);

  await Bun.write(TRADES_PATH, JSON.stringify(allTrades, null, 2));

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    seen_txids: seenTxids,
  });

  log(
    `done: ${newTrades.length} new trades across ${competitors.length} competitors`,
  );
  return "ok";
}
