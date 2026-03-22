// skills/defi-bitflow/sensor.ts
// Detect high-range spreads on Bitflow trading pairs — logs intelligence only, no signal filing

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";

const SENSOR_NAME = "defi-bitflow";
const INTERVAL_MINUTES = 60;
const BITFLOW_API = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev";
const SPREAD_THRESHOLD_PCT = 15; // only exceptional events worth logging
const MIN_LIQUIDITY_USD = 10_000; // ignore illiquid pairs

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

    // Log intelligence only — do NOT file signals.
    // Bitflow is a Stacks L2 DEX (sBTC/STX pairs). These are DeFi volatility signals,
    // not ordinals data. Arc owns the `ordinals` beat only; filing Bitflow spreads there
    // is a beat-scope violation and gets rejected. When fleet resumes, Spark (DeFi beat)
    // should own this signal path.
    for (const { ticker, spreadPct } of highSpreadPairs.slice(0, 3)) {
      const pairLabel = `${ticker.base_currency}/${ticker.target_currency}`;
      const liquidityK = (Number(ticker.liquidity_in_usd) / 1000).toFixed(0);
      log(`intel: ${pairLabel} ${spreadPct.toFixed(1)}% range, $${liquidityK}k liquidity (no signal filed — DeFi beat not owned by Arc)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
