// skills/stacks-market/sensor.ts
// Read-only prediction market intelligence — detect high-volume markets, file signals to aibtc-news

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";

const SENSOR_NAME = "stacks-market";
const INTERVAL_MINUTES = 360; // 6 hours
const STACKS_MARKET_API = "https://api.stacksmarket.app";
const AIBTC_NEWS_API = "https://aibtc.news/api";
const ARC_BTC_ADDRESS = "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933";
const VOLUME_THRESHOLD = 100; // STX (configurable via env)
const MAX_SIGNALS_PER_RUN = 1; // Only 1 signal per run — aibtc.news enforces 1 per 4h per beat
const RATE_LIMIT_MINUTES = 240; // 4 hours — matches aibtc.news per-beat rate limit

interface Market {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  totalVolume: number; // Total volume in micro units (uSTX)
  totalTrades?: number;
  isResolved: boolean;
  endDate?: string;
}

interface ApiResponse {
  polls?: Market[];
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [sensor:stacks-market] ${msg}`);
}

async function canFileSignal(): Promise<boolean> {
  try {
    const url = `${AIBTC_NEWS_API}/status/${ARC_BTC_ADDRESS}`;
    const response = await fetch(url);
    if (!response.ok) {
      log(`warn: aibtc-news status check failed (${response.status}); assuming rate-limited`);
      return false;
    }
    const status = (await response.json()) as { canFileSignal?: boolean };
    return status.canFileSignal === true;
  } catch (e) {
    const err = e as Error;
    log(`warn: aibtc-news status check error: ${err.message}; assuming rate-limited`);
    return false;
  }
}

async function fetchMarkets(limit = 50): Promise<Market[] | null> {
  try {
    const url = new URL(`${STACKS_MARKET_API}/api/polls`);
    url.searchParams.set("limit", limit.toString());
    // Don't filter by status=active; get all markets and filter ourselves
    // This gives us better control over what we consider "active"

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      log(`warn: API returned ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = (await response.json()) as ApiResponse;
    return data.polls ?? [];
  } catch (e) {
    const err = e as Error;
    log(`warn: fetch error: ${err.message}`);
    return null;
  }
}

async function fileSignalTask(market: Market): Promise<boolean> {
  try {
    const signalSource = `sensor:${SENSOR_NAME}:signal:${market._id}`;
    const alreadyFiled = pendingTaskExistsForSource(signalSource);

    if (!alreadyFiled) {
      // Convert micro-STX to STX (1 STX = 1,000,000 micro-STX)
      const volumeStx = market.totalVolume / 1_000_000;

      const headline = `High-volume prediction market: ${market.title}`;
      const body = [
        `Stacks L2 prediction market on stacksmarket.app with ${volumeStx.toFixed(2)} STX total volume.`,
        market.category ? `Category: ${market.category}` : undefined,
        market.totalTrades ? `Total trades: ${market.totalTrades}` : undefined,
        market.endDate ? `Resolves: ${market.endDate}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      const tags = [
        "prediction-market",
        "stacks-l2",
        market.category ? market.category.toLowerCase().replace(/\s+/g, "-") : "general",
      ].filter(Boolean);

      log(
        `queuing signal task for market: ${market.title} (${market._id}, ${volumeStx.toFixed(2)} STX)`
      );

      insertTask({
        subject: `File Ordinals Business signal: ${market.title} — ${volumeStx.toFixed(2)} STX volume`,
        description: `Arc detected high-volume prediction market on stacksmarket.app.

Market: ${market.title}
Total Volume: ${volumeStx.toFixed(2)} STX
Trades: ${market.totalTrades ?? "N/A"}
${market.category ? `Category: ${market.category}` : ""}
${market.endDate ? `Resolves: ${market.endDate}` : ""}
MongoDB ID: ${market._id}

File signal to Ordinals Business beat via aibtc-news skill. Headline: "${headline}"`,
        skills: JSON.stringify(["stacks-market", "aibtc-news"]),
        priority: 6,
        status: "pending",
        source: signalSource,
      });

      return true;
    }

    return false;
  } catch (e) {
    const err = e as Error;
    log(`warn: signal task creation failed: ${err.message}`);
    return false;
  }
}

export default async function stacksMarketSensor(): Promise<string> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claim = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (claim.status === "skip") {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Initialize database
    initDatabase();

    // Fetch markets
    log("fetching prediction markets...");
    const markets = await fetchMarkets(50);
    if (!markets) {
      log("could not fetch markets; skipping");
      return "skip";
    }

    log(`found ${markets.length} total markets`);

    // Filter markets: unresolved, with significant volume
    // Volume threshold is in STX; convert to micro-STX for comparison
    const volumeThreshold = Number(process.env.STACKS_MARKET_VOLUME_THRESHOLD ?? VOLUME_THRESHOLD);
    const volumeThresholdUstx = volumeThreshold * 1_000_000;

    const highVolumeMarkets = markets.filter(
      (m) => m.totalVolume >= volumeThresholdUstx && !m.isResolved
    );

    log(`detected ${highVolumeMarkets.length} high-volume markets (>${volumeThreshold} STX)`);

    // 4-hour rate limit guard — matches aibtc.news per-beat limit
    const sourcePrefix = `sensor:${SENSOR_NAME}:signal:`;
    if (recentTaskExistsForSourcePrefix(sourcePrefix, RATE_LIMIT_MINUTES)) {
      log(`rate limit: signal task filed within last ${RATE_LIMIT_MINUTES} min; skipping`);
      return "rate-limited";
    }

    // Check aibtc.news API — authoritative rate-limit gate
    const canFile = await canFileSignal();
    if (!canFile) {
      log("rate limit active (canFileSignal=false); skipping signal tasks");
      return "rate-limited";
    }

    // File signals (rate-limited per run)
    let signalCount = 0;
    for (const market of highVolumeMarkets) {
      if (signalCount >= MAX_SIGNALS_PER_RUN) {
        log(
          `rate limit reached (${MAX_SIGNALS_PER_RUN} signals per run); skipping remaining markets`
        );
        break;
      }

      const filed = await fileSignalTask(market);
      if (filed) {
        signalCount++;
      }
    }

    log(`queued ${signalCount} signal task(s)`);
    log("run completed");
    return "ok";
  } catch (e) {
    const err = e as Error;
    console.error(
      `[${new Date().toISOString()}] [sensor:stacks-market] error: ${err.message}`
    );
    return "error";
  }
}
