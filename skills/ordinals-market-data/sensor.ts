// skills/ordinals-market-data/sensor.ts
// Fetches diverse ordinals market data and queues signal-filing tasks for the ordinals beat.
// Data sources: Unisat (inscriptions + BRC-20), mempool.space (fee market), CoinGecko (NFT floors).
// Rotates through categories to ensure signal diversity for the $100K competition.

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, isDailySignalCapHit, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "ordinals-market-data";
const INTERVAL_MINUTES = 240; // every 4 hours
const RATE_LIMIT_MINUTES = 240; // 4 hours between signal batches from this sensor
const MAX_SIGNALS_PER_RUN = 2;

const UNISAT_API = "https://open-api.unisat.io";
const MEMPOOL_API = "https://mempool.space/api";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Category rotation — each run picks the next category in sequence
type Category = "inscriptions" | "brc20" | "fees" | "nft-floors";
const CATEGORIES: Category[] = ["inscriptions", "brc20", "fees", "nft-floors"];

interface HookState {
  lastCategory: number; // index into CATEGORIES
  lastRun?: string;
  lastInscriptionCount?: number;
  lastFeeRate?: number;
  lastBrc20Volume?: number;
  [key: string]: unknown;
}

interface SignalData {
  category: Category;
  headline: string;
  claim: string;
  evidence: string;
  implication: string;
  sources: Array<{ url: string; title: string }>;
  tags: string;
}

const log = createSensorLogger(SENSOR_NAME);

// ---- Data Fetchers ----

async function fetchInscriptionData(apiKey: string): Promise<SignalData | null> {
  try {
    // BRC-20 status for overall inscription activity
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/brc20/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!statusRes.ok) {
      log(`inscriptions: unisat status failed (${statusRes.status})`);
      return null;
    }
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    await Bun.sleep(200); // respect rate limit

    // Recent inscriptions
    const recentRes = await fetch(`${UNISAT_API}/v1/indexer/inscription/info/recent?limit=20`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!recentRes.ok) {
      log(`inscriptions: unisat recent failed (${recentRes.status})`);
      return null;
    }
    const recentData = (await recentRes.json()) as Record<string, unknown>;
    const recentList = (recentData?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;

    const totalInscriptions = Number(status.inscriptionCount ?? status.total ?? 0);
    const tokenCount = Number(status.tokenCount ?? status.count ?? 0);
    const recentCount = recentList?.length ?? 0;

    // Detect content-type distribution from recent inscriptions
    const contentTypes: Record<string, number> = {};
    if (recentList) {
      for (const item of recentList) {
        const ct = String(item.contentType ?? item.content_type ?? "unknown").split("/")[0];
        contentTypes[ct] = (contentTypes[ct] ?? 0) + 1;
      }
    }
    const topType = Object.entries(contentTypes).sort((a, b) => b[1] - a[1])[0];
    const topTypeLabel = topType ? `${topType[0]} (${topType[1]}/${recentCount})` : "mixed";

    if (totalInscriptions === 0 && tokenCount === 0) {
      log("inscriptions: no data available");
      return null;
    }

    if (recentCount === 0) {
      log("inscriptions: no recent inscription data returned; skipping signal");
      return null;
    }

    const inscriptionCountStr = totalInscriptions > 0
      ? `${(totalInscriptions / 1_000_000).toFixed(1)}M total inscriptions`
      : `${tokenCount} BRC-20 tokens deployed`;

    return {
      category: "inscriptions",
      headline: `Bitcoin inscription activity: ${inscriptionCountStr}, recent batch dominated by ${topTypeLabel}`,
      claim: `Bitcoin inscription activity shows ${inscriptionCountStr} on the network, with recent inscriptions dominated by ${topTypeLabel} content types.`,
      evidence: `Unisat indexer reports ${totalInscriptions > 0 ? totalInscriptions.toLocaleString() : "N/A"} total inscriptions, ${tokenCount} BRC-20 tokens deployed. The latest ${recentCount} inscriptions show content-type distribution: ${Object.entries(contentTypes).map(([k, v]) => `${k}: ${v}`).join(", ")}.`,
      implication: `The content-type mix in recent inscriptions signals whether the market favours collectible media (image/video) or financial instruments (text/BRC-20 deploys). A shift toward text-heavy inscriptions typically precedes BRC-20 trading volume spikes.`,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat Indexer API — inscription status" },
        { url: "https://mempool.space", title: "mempool.space — Bitcoin fee market" },
      ],
      tags: "ordinals-business,inscriptions,bitcoin,on-chain",
    };
  } catch (e) {
    log(`inscriptions: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchBrc20Data(apiKey: string): Promise<SignalData | null> {
  try {
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/brc20/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!statusRes.ok) return null;
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    await Bun.sleep(200);

    // Fetch top BRC-20 tokens by market activity
    const listRes = await fetch(`${UNISAT_API}/v1/indexer/brc20/list?limit=10&offset=0`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!listRes.ok) {
      log(`brc20: list fetch failed (${listRes.status})`);
      return null;
    }
    const listData = (await listRes.json()) as Record<string, unknown>;
    const tokens = (listData?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;

    if (!tokens || tokens.length === 0) {
      log("brc20: no token data");
      return null;
    }

    // Build summary of top tokens
    const tokenSummaries = tokens.slice(0, 5).map((t) => {
      const ticker = String(t.ticker ?? t.tick ?? "unknown");
      const holders = Number(t.holdersCount ?? t.holders ?? 0);
      const minted = Number(t.mintedCount ?? t.minted ?? 0);
      const supply = Number(t.totalSupply ?? t.max ?? 0);
      const mintPct = supply > 0 ? ((minted / supply) * 100).toFixed(1) : "N/A";
      return { ticker, holders, mintPct };
    });

    const topToken = tokenSummaries[0];
    const totalTokens = Number(status.tokenCount ?? status.count ?? tokens.length);
    const topList = tokenSummaries.map((t) => `${t.ticker} (${t.holders} holders, ${t.mintPct}% minted)`).join("; ");

    return {
      category: "brc20",
      headline: `BRC-20 ecosystem: ${totalTokens} tokens deployed, ${topToken.ticker} leads with ${topToken.holders} holders`,
      claim: `The BRC-20 token ecosystem on Bitcoin has grown to ${totalTokens} deployed tokens, with ${topToken.ticker} leading holder count at ${topToken.holders} addresses.`,
      evidence: `Unisat BRC-20 indexer shows ${totalTokens} total tokens. Top 5 by activity: ${topList}.`,
      implication: `BRC-20 holder concentration in top tokens indicates whether the market is consolidating around blue-chip fungibles or fragmenting into speculative micro-caps. High holder counts with incomplete mints suggest sustained accumulation rather than mint-and-dump cycles.`,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat BRC-20 Indexer — token status and rankings" },
        { url: "https://mempool.space", title: "mempool.space — Bitcoin transaction fees" },
      ],
      tags: "ordinals-business,brc-20,bitcoin,fungibles",
    };
  } catch (e) {
    log(`brc20: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchFeeMarketData(): Promise<SignalData | null> {
  try {
    // Fetch recommended fees
    const feesRes = await fetchWithRetry(`${MEMPOOL_API}/v1/fees/recommended`);
    if (!feesRes.ok) {
      log(`fees: mempool.space fees failed (${feesRes.status})`);
      return null;
    }
    const fees = (await feesRes.json()) as Record<string, number>;

    // Fetch mempool stats
    const mempoolRes = await fetchWithRetry(`${MEMPOOL_API}/mempool`);
    if (!mempoolRes.ok) {
      log(`fees: mempool.space mempool stats failed (${mempoolRes.status})`);
      return null;
    }
    const mempool = (await mempoolRes.json()) as Record<string, unknown>;

    const fastestFee = fees.fastestFee ?? 0;
    const hourFee = fees.hourFee ?? 0;
    const minimumFee = fees.minimumFee ?? 0;
    const mempoolSize = Number(mempool.count ?? 0);
    const mempoolVsize = Number(mempool.vsize ?? 0);
    const mempoolMB = (mempoolVsize / 1_000_000).toFixed(1);

    if (fastestFee === 0) {
      log("fees: no fee data");
      return null;
    }

    const feeSpread = fastestFee - minimumFee;
    const urgencyLabel = fastestFee > 50 ? "elevated" : fastestFee > 20 ? "moderate" : "low";

    return {
      category: "fees",
      headline: `Bitcoin fee market ${urgencyLabel}: ${fastestFee} sat/vB fastest, ${mempoolSize.toLocaleString()} unconfirmed txs (${mempoolMB} MvB)`,
      claim: `Bitcoin's fee market is at ${urgencyLabel} levels with fastest confirmation at ${fastestFee} sat/vB, creating a ${feeSpread} sat/vB spread between priority and economy transactions.`,
      evidence: `mempool.space reports: fastest fee ${fastestFee} sat/vB, 1-hour fee ${hourFee} sat/vB, minimum ${minimumFee} sat/vB. Mempool holds ${mempoolSize.toLocaleString()} unconfirmed transactions (${mempoolMB} MvB). Fee spread (fastest minus minimum): ${feeSpread} sat/vB.`,
      implication: `Fee market conditions directly impact inscription economics. ${urgencyLabel === "elevated" ? "Elevated fees discourage low-value inscriptions and compress daily inscription volume, favouring larger or higher-value ordinals." : urgencyLabel === "moderate" ? "Moderate fees allow steady inscription flow while filtering spam, a healthy environment for ordinals market activity." : "Low fees create favourable conditions for inscription batching and BRC-20 minting, potentially boosting daily inscription counts."}`,
      sources: [
        { url: "https://mempool.space/api/v1/fees/recommended", title: "mempool.space — recommended fee rates" },
        { url: "https://mempool.space/api/mempool", title: "mempool.space — mempool statistics" },
      ],
      tags: "ordinals-business,fees,bitcoin,mempool",
    };
  } catch (e) {
    log(`fees: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchNftFloorData(): Promise<SignalData | null> {
  try {
    // CoinGecko free tier — Bitcoin NFT collections
    // Known collection IDs on CoinGecko: bitcoin-frogs, nodemonkes, bitcoin-puppets
    const collections = ["bitcoin-frogs", "nodemonkes", "bitcoin-puppets"];
    const results: Array<{ name: string; floor: number; volume24h: number; marketCap: number }> = [];

    for (const id of collections) {
      try {
        const response = await fetchWithRetry(`${COINGECKO_API}/nfts/${id}`);
        if (!response.ok) {
          log(`nft-floors: CoinGecko ${id} returned ${response.status}`);
          continue;
        }
        const data = (await response.json()) as Record<string, unknown>;
        const floorPrice = data.floor_price as Record<string, number> | undefined;
        const volume24h = data.volume_24h as Record<string, number> | undefined;
        const marketCap = data.market_cap as Record<string, number> | undefined;

        results.push({
          name: String(data.name ?? id),
          floor: floorPrice?.native_currency ?? 0,
          volume24h: volume24h?.native_currency ?? 0,
          marketCap: marketCap?.native_currency ?? 0,
        });
      } catch {
        log(`nft-floors: error fetching ${id}`);
      }
      await Bun.sleep(500); // CoinGecko rate limit (free tier: ~10-30 req/min)
    }

    if (results.length === 0) {
      log("nft-floors: no data from CoinGecko");
      return null;
    }

    // Sort by floor price descending
    results.sort((a, b) => b.floor - a.floor);

    const floorSummary = results.map((r) =>
      `${r.name}: ${r.floor.toFixed(4)} BTC floor, ${r.volume24h.toFixed(2)} BTC 24h volume`
    ).join("; ");

    const topCollection = results[0];
    const totalVolume = results.reduce((sum, r) => sum + r.volume24h, 0);

    return {
      category: "nft-floors",
      headline: `Ordinals NFT floors: ${topCollection.name} at ${topCollection.floor.toFixed(4)} BTC, ${totalVolume.toFixed(2)} BTC combined 24h volume`,
      claim: `Top Bitcoin NFT collections show ${topCollection.name} leading at ${topCollection.floor.toFixed(4)} BTC floor price, with ${totalVolume.toFixed(2)} BTC combined 24-hour trading volume across major collections.`,
      evidence: `CoinGecko data for ${results.length} tracked Ordinals collections: ${floorSummary}.`,
      implication: `Floor price trends in blue-chip Ordinals collections serve as a sentiment proxy for the broader Bitcoin NFT market. ${totalVolume > 10 ? "Elevated volume suggests active price discovery and potential floor repricing." : totalVolume > 1 ? "Moderate volume indicates stable market participation with neither panic selling nor euphoric accumulation." : "Thin volume suggests the market is in a wait-and-see posture, with floors potentially fragile if liquidity remains sparse."}`,
      sources: [
        { url: "https://www.coingecko.com/en/nft", title: "CoinGecko — Ordinals NFT collection data" },
        { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
      ],
      tags: "ordinals-business,nft,bitcoin,floors",
    };
  } catch (e) {
    log(`nft-floors: error — ${(e as Error).message}`);
    return null;
  }
}

// ---- Main Sensor ----

export default async function ordinalsMarketDataSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started — fetching diverse ordinals market data");

    // Daily cap guard — skip if 6/6 signal slots already claimed today
    if (isDailySignalCapHit()) {
      log("daily cap: 6/6 signal slots claimed today; skipping");
      return "skip";
    }

    // Rate limit: no signal tasks within last RATE_LIMIT_MINUTES
    const sourcePrefix = `sensor:${SENSOR_NAME}:`;
    if (recentTaskExistsForSourcePrefix(sourcePrefix, RATE_LIMIT_MINUTES)) {
      log(`rate limit: signal queued within last ${RATE_LIMIT_MINUTES} min; skipping`);
      return "rate-limited";
    }

    // Load state for category rotation
    const rawState = (await readHookState(SENSOR_NAME)) as HookState | null;
    const state: HookState = rawState ?? { lastCategory: -1 };

    // Pick next two categories (rotate through all four)
    const startIdx = ((state.lastCategory ?? -1) + 1) % CATEGORIES.length;
    const categoriesToFetch: Category[] = [
      CATEGORIES[startIdx],
      CATEGORIES[(startIdx + 1) % CATEGORIES.length],
    ];

    log(`categories this run: ${categoriesToFetch.join(", ")}`);

    // Unisat API key needed for inscription/brc20 categories
    const unisatKey = await getCredential("unisat", "api_key").catch(() => null);

    // Fetch data for selected categories
    const signals: SignalData[] = [];

    for (const cat of categoriesToFetch) {
      let signal: SignalData | null = null;

      switch (cat) {
        case "inscriptions":
          if (!unisatKey) { log("inscriptions: no unisat api_key, skipping"); break; }
          signal = await fetchInscriptionData(unisatKey);
          break;
        case "brc20":
          if (!unisatKey) { log("brc20: no unisat api_key, skipping"); break; }
          signal = await fetchBrc20Data(unisatKey);
          break;
        case "fees":
          signal = await fetchFeeMarketData();
          break;
        case "nft-floors":
          signal = await fetchNftFloorData();
          break;
      }

      if (signal) signals.push(signal);
    }

    if (signals.length === 0) {
      log("no signal data fetched from any category");
      state.lastCategory = (startIdx + 1) % CATEGORIES.length;
      await writeHookState(SENSOR_NAME, { ...state, lastRun: new Date().toISOString() });
      return "ok";
    }

    // Queue signal-filing tasks
    let queued = 0;
    for (const signal of signals) {
      if (queued >= MAX_SIGNALS_PER_RUN) break;

      const signalSource = `sensor:${SENSOR_NAME}:${signal.category}`;
      const sourcesJson = JSON.stringify(signal.sources);

      insertTask({
        subject: `File ordinals signal: ${signal.headline.slice(0, 120)}`,
        description: `Arc's ordinals-market-data sensor detected a signal opportunity.

**Category:** ${signal.category}
**Headline:** ${signal.headline}

**Claim:** ${signal.claim}

**Evidence:** ${signal.evidence}

**Implication:** ${signal.implication}

**Sources:** ${sourcesJson}
**Tags:** ${signal.tags}

File this signal to the ordinals beat using:
\`\`\`
arc skills run --name aibtc-news-editorial -- file-signal --beat ordinals \\
  --headline "${signal.headline.replace(/"/g, '\\"')}" \\
  --claim "${signal.claim.replace(/"/g, '\\"')}" \\
  --evidence "${signal.evidence.replace(/"/g, '\\"')}" \\
  --implication "${signal.implication.replace(/"/g, '\\"')}" \\
  --sources '${sourcesJson}' \\
  --tags "${signal.tags}"
\`\`\`

Arc ONLY files to the ordinals beat (slug: ordinals). Do NOT file to any other beat.
Use Economist voice — precise, data-rich, no hype language.`,
        skills: JSON.stringify(["ordinals-market-data", "aibtc-news-editorial"]),
        priority: 7,
        model: "sonnet",
        status: "pending",
        source: signalSource,
      });

      log(`queued signal: ${signal.category} — ${signal.headline.slice(0, 80)}`);
      queued++;
    }

    // Update state with rotation index
    state.lastCategory = (startIdx + categoriesToFetch.length - 1) % CATEGORIES.length;
    state.lastRun = new Date().toISOString();
    await writeHookState(SENSOR_NAME, state);

    log(`queued ${queued} signal task(s), next categories: ${CATEGORIES[((state.lastCategory) + 1) % CATEGORIES.length]}, ${CATEGORIES[((state.lastCategory) + 2) % CATEGORIES.length]}`);
    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
