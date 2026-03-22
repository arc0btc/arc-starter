// skills/defi-stacks-market/sensor.ts
// Read-only prediction market intelligence — detect high-volume markets, file signals to aibtc-news

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, isDailySignalCapHit, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "defi-stacks-market";
const INTERVAL_MINUTES = 360; // 6 hours
const STACKS_MARKET_API = "https://api.stacksmarket.app";
const AIBTC_NEWS_API = "https://aibtc.news/api";
const VOLUME_THRESHOLD = 100; // STX (configurable via env)

// Only file signals for markets relevant to Arc's ordinals-business beat
// Ordinals Business scope: inscription volumes, BRC-20, marketplace metrics, Runes
const EXCLUDED_CATEGORIES = [
  "sports", "entertainment", "politics", "celebrity", "pop culture", "gaming",
  "commodities", "economy", "finance", "elections", "weather", "science",
];
// Keywords that indicate ordinals-business beat relevance (inscription/BRC-20/marketplace/Runes)
const ORDINALS_KEYWORDS = [
  "ordinals", "inscription", "brc-20", "brc20", "runes", "rune",
  "ordinal marketplace", "magic eden", "gamma.io", "ordinals market",
  "satoshi", "rare sat", "sat hunt",
];
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

const log = createSensorLogger(SENSOR_NAME);

async function canFileSignal(): Promise<boolean> {
  try {
    const url = `${AIBTC_NEWS_API}/status/${ARC_BTC_ADDRESS}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: aibtc-news status check failed (${response.status}); assuming rate-limited`);
      return false;
    }
    const status = (await response.json()) as { canFileSignal?: boolean };
    return status.canFileSignal === true;
  } catch (e) {
    const error = e as Error;
    log(`warn: aibtc-news status check error: ${error.message}; assuming rate-limited`);
    return false;
  }
}

async function fetchMarkets(limit = 50): Promise<Market[] | null> {
  try {
    const url = new URL(`${STACKS_MARKET_API}/api/polls`);
    url.searchParams.set("limit", limit.toString());
    // Don't filter by status=active; get all markets and filter ourselves
    // This gives us better control over what we consider "active"

    const response = await fetchWithRetry(url.toString(), {
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
    const error = e as Error;
    log(`warn: fetch error: ${error.message}`);
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

      const headline = `High-volume Stacks prediction market: ${market.title}`;
      const claim = `stacksmarket.app prediction market "${market.title}" reached ${volumeStx.toFixed(2)} STX total volume${market.totalTrades ? ` across ${market.totalTrades} trades` : ""}.`;
      const evidence = [
        `Stacks L2 prediction market data from stacksmarket.app.`,
        market.category ? `Category: ${market.category}.` : undefined,
        market.endDate ? `Resolves: ${market.endDate}.` : undefined,
        `MongoDB ID: ${market._id}.`,
      ]
        .filter(Boolean)
        .join(" ");
      const implication = `Active prediction market liquidity on Stacks L2 signals growing DeFi participation and real-time market signal infrastructure on Bitcoin L2.`;

      log(
        `queuing signal task for market: ${market.title} (${market._id}, ${volumeStx.toFixed(2)} STX)`
      );

      insertTask({
        subject: `File ordinals signal: ${market.title} — ${volumeStx.toFixed(2)} STX volume`,
        description: `Arc detected high-volume prediction market on stacksmarket.app.

Market: ${market.title}
Total Volume: ${volumeStx.toFixed(2)} STX
Trades: ${market.totalTrades ?? "N/A"}
${market.category ? `Category: ${market.category}` : ""}
${market.endDate ? `Resolves: ${market.endDate}` : ""}
MongoDB ID: ${market._id}

File this signal to the ordinals beat (Arc's only beat — do NOT file to dao-watch, btc-macro, or any other beat):

arc skills run --name aibtc-news-editorial -- file-signal \\
  --beat ordinals \\
  --headline "${headline}" \\
  --claim "${claim}" \\
  --evidence "${evidence}" \\
  --implication "${implication}"`,
        skills: JSON.stringify(["defi-stacks-market", "aibtc-news-editorial"]),
        priority: 6,
        model: "haiku",
        status: "pending",
        source: signalSource,
      });

      return true;
    }

    return false;
  } catch (e) {
    const error = e as Error;
    log(`warn: signal task creation failed: ${error.message}`);
    return false;
  }
}

export default async function stacksMarketSensor(): Promise<string> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Fetch markets
    log("fetching prediction markets...");
    const markets = await fetchMarkets(50);
    if (!markets) {
      log("could not fetch markets; skipping");
      return "skip";
    }

    log(`found ${markets.length} total markets`);

    // Filter markets: unresolved, with significant volume, and relevant to Arc's beat
    const volumeThreshold = Number(process.env.STACKS_MARKET_VOLUME_THRESHOLD ?? VOLUME_THRESHOLD);
    const volumeThresholdUstx = volumeThreshold * 1_000_000;

    const highVolumeMarkets = markets.filter((m) => {
      if (m.totalVolume < volumeThresholdUstx || m.isResolved) return false;
      // Exclude explicitly off-topic categories
      const cat = (m.category ?? "").toLowerCase();
      if (EXCLUDED_CATEGORIES.some((ex) => cat.includes(ex))) return false;
      // Ordinals Business beat scope: inscription volumes, BRC-20, marketplace metrics, Runes.
      // Only route markets whose title/description/category contains ordinals-specific keywords.
      const titleLower = (m.title ?? "").toLowerCase();
      const descLower = (m.description ?? "").toLowerCase();
      const isOrdinalsRelated = ORDINALS_KEYWORDS.some(
        (kw) => titleLower.includes(kw) || descLower.includes(kw) || cat.includes(kw)
      );
      // Skip non-ordinals markets (Stacks DeFi, crypto macro, etc.) — Arc has no other beat
      if (!isOrdinalsRelated) return false;
      return true;
    });

    log(`detected ${highVolumeMarkets.length} ordinals-business-relevant markets (>${volumeThreshold} STX)`);

    // Daily cap guard — skip if 6/6 signal slots already claimed today
    if (isDailySignalCapHit()) {
      log("daily cap: 6/6 signal slots claimed today; skipping");
      return "rate-limited";
    }

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
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
