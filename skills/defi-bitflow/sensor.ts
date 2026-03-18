// skills/defi-bitflow/sensor.ts
// Detect high bid-ask spreads on Bitflow trading pairs and file signals

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { recentTaskExistsForSourcePrefix } from "../../src/db.ts";

const SENSOR_NAME = "defi-bitflow";
const INTERVAL_MINUTES = 60;
const BITFLOW_API = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev";
const SPREAD_THRESHOLD_PCT = 5; // default 5% spread threshold
const MIN_LIQUIDITY_USD = 10_000; // ignore illiquid pairs
const MAX_SIGNALS_PER_RUN = 2;
const RATE_LIMIT_MINUTES = 240; // 4 hours between signal batches

interface Ticker {
  ticker_id: string;
  base_currency: string;
  target_currency: string;
  last_price: number;
  base_volume: number;
  target_volume: number;
  high: number;
  low: number;
  liquidity_in_usd: number;
  pool_id: string;
  last_trade_time?: number;
}

const log = createSensorLogger(SENSOR_NAME);

/** Compute daily high-low range as a spread/volatility proxy (bid/ask no longer in API). */
function computeRangePct(high: number, low: number, lastPrice: number): number {
  if (high <= 0 || low <= 0 || lastPrice <= 0) return 0;
  return ((high - low) / lastPrice) * 100;
}

async function fetchTickers(): Promise<Ticker[] | null> {
  try {
    const response = await fetchWithRetry(`${BITFLOW_API}/ticker`);
    if (!response.ok) {
      log(`warn: Bitflow API returned ${response.status}`);
      return null;
    }
    const data = (await response.json()) as Ticker[];
    return Array.isArray(data) ? data : null;
  } catch (e) {
    const error = e as Error;
    log(`warn: fetch error: ${error.message}`);
    return null;
  }
}

export default async function bitflowSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — checking Bitflow spreads");

    const tickers = await fetchTickers();
    if (!tickers) {
      log("could not fetch tickers; skipping");
      return "skip";
    }

    log(`fetched ${tickers.length} trading pairs`);

    const threshold = Number(process.env.BITFLOW_SPREAD_THRESHOLD ?? SPREAD_THRESHOLD_PCT);

    // Find high-range pairs with sufficient liquidity (using high/low as spread proxy)
    const highSpreadPairs: Array<{ ticker: Ticker; spreadPct: number }> = [];

    for (const t of tickers) {
      const high = Number(t.high);
      const low = Number(t.low);
      const lastPrice = Number(t.last_price);
      const liquidity = Number(t.liquidity_in_usd);

      if (high <= 0 || low <= 0 || lastPrice <= 0) continue;
      if (isNaN(liquidity) || liquidity < MIN_LIQUIDITY_USD) continue;

      const spreadPct = computeRangePct(high, low, lastPrice);
      if (spreadPct >= threshold) {
        highSpreadPairs.push({ ticker: t, spreadPct });
      }
    }

    if (highSpreadPairs.length === 0) {
      log(`no pairs above ${threshold}% spread threshold`);
      return "ok";
    }

    // Sort by spread descending — most notable first
    highSpreadPairs.sort((a, b) => b.spreadPct - a.spreadPct);

    log(`detected ${highSpreadPairs.length} high-spread pairs (>${threshold}%)`);

    // Rate limit check
    const sourcePrefix = `sensor:${SENSOR_NAME}:spread:`;
    if (recentTaskExistsForSourcePrefix(sourcePrefix, RATE_LIMIT_MINUTES)) {
      log(`rate limit: signal filed within last ${RATE_LIMIT_MINUTES} min; skipping`);
      return "rate-limited";
    }

    // File signal tasks
    let signalCount = 0;
    for (const { ticker, spreadPct } of highSpreadPairs) {
      if (signalCount >= MAX_SIGNALS_PER_RUN) break;

      const signalSource = `sensor:${SENSOR_NAME}:spread:${ticker.ticker_id}`;
      if (pendingTaskExistsForSource(signalSource)) continue;

      const pairLabel = `${ticker.base_currency}/${ticker.target_currency}`;
      const liquidityK = (Number(ticker.liquidity_in_usd) / 1000).toFixed(0);

      log(`queuing spread signal: ${pairLabel} — ${spreadPct.toFixed(1)}% range, $${liquidityK}k liquidity`);

      insertTask({
        subject: `File Ordinals Business signal: Bitflow ${pairLabel} — ${spreadPct.toFixed(1)}% price range`,
        description: `Arc detected high price range on Bitflow DEX.

Pair: ${pairLabel}
Daily Range: ${spreadPct.toFixed(2)}%
High: ${ticker.high}
Low: ${ticker.low}
Last Price: ${ticker.last_price}
Liquidity: $${liquidityK}k
Volume (base): ${ticker.base_volume}

High daily price ranges may indicate volatility, liquidity imbalance, or arbitrage opportunities.

File signal to Ordinals Business beat via aibtc-news skill.`,
        skills: JSON.stringify(["defi-bitflow", "aibtc-news-editorial"]),
        priority: 7,
        model: "haiku",
        status: "pending",
        source: signalSource,
      });

      signalCount++;
    }

    log(`queued ${signalCount} spread signal task(s)`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
