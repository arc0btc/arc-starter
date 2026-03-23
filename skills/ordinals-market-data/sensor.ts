// skills/ordinals-market-data/sensor.ts
// Fetches diverse ordinals market data and queues signal-filing tasks for the ordinals beat.
// Data sources: Unisat (inscriptions + BRC-20 + runes), mempool.space (fee market), CoinGecko (NFT floors).
// Rotates through categories to ensure signal diversity for the $100K competition.
// Stores rolling history (last 6 readings per category) for delta computation and trend analysis.

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, isDailySignalCapHit, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "ordinals-market-data";
const INTERVAL_MINUTES = 240; // every 4 hours
const RATE_LIMIT_MINUTES = 240; // 4 hours between signal batches from this sensor
const MAX_SIGNALS_PER_RUN = 1; // one signal per run — aibtc.news has 60-min cooldown per beat
const MAX_HISTORY_READINGS = 6; // rolling window per category for delta computation

const UNISAT_API = "https://open-api.unisat.io";
const MEMPOOL_API = "https://mempool.space/api";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Category rotation — each run picks the next category in sequence
type Category = "inscriptions" | "brc20" | "fees" | "nft-floors" | "runes";
const CATEGORIES: Category[] = ["inscriptions", "brc20", "fees", "nft-floors", "runes"];

// Angle rotation — each run assigns an analytical lens to the signal
type Angle = "trend" | "comparison" | "anomaly" | "structure";
const ANGLES: Angle[] = ["trend", "comparison", "anomaly", "structure"];

const ANGLE_DIRECTIVES: Record<Angle, string> = {
  trend: "ANALYTICAL ANGLE: Trend Analysis — Focus on multi-reading direction and momentum. Compare current data against prior readings to identify whether metrics are rising, falling, or inflecting. Emphasise trajectory over snapshot: use language like 'accelerating', 'decelerating', 'reversing', 'sustaining'. Frame the implication around where the trend leads if it continues.",
  comparison: "ANALYTICAL ANGLE: Cross-Category Comparison — Focus on relative performance across categories or collections. Compare inscription types against each other, BRC-20 tokens against NFT floors, or fee conditions against inscription economics. Use ratios, spreads, and divergences to surface insights invisible in single-category analysis.",
  anomaly: "ANALYTICAL ANGLE: Anomaly Detection — Focus on deviations from typical ranges. Highlight any metric that is unusually high or low relative to recent history. Use language like 'outlier', 'deviation', 'unprecedented', 'atypical'. Frame the implication around what the anomaly might signal about changing market dynamics.",
  structure: "ANALYTICAL ANGLE: Market Structure — Focus on concentration, distribution, and microstructure. Analyse holder distribution, liquidity depth, fee tier stratification, or content-type composition. Surface structural patterns: is activity consolidating or fragmenting? Is liquidity deepening or thinning? Frame the implication around structural health and resilience.",
};

// ---- History Types ----

interface CategoryReading {
  timestamp: string;
  metrics: Record<string, number>;
}

type CategoryHistory = Record<Category, CategoryReading[]>;

interface DeltaInfo {
  metric: string;
  current: number;
  previous: number;
  absoluteChange: number;
  percentChange: number;
  trendDurationMs: number;
}

// ---- Narrative Thread Types ----

interface NarrativeSignalEntry {
  category: Category;
  headline: string;
  claim: string;
  timestamp: string; // ISO
}

interface NarrativeThread {
  signals: NarrativeSignalEntry[]; // last 3 filed signals
  summary: string; // max 500 chars — running narrative context
  weekStarted: string; // ISO Monday date (YYYY-MM-DD) for weekly reset
  archived?: string[]; // prior week summaries (kept for reference, max 4)
}

// ---- State & Signal Types ----

interface HookState {
  lastCategory: number; // index into CATEGORIES
  lastAngle: number; // index into ANGLES
  lastRun?: string;
  lastSignalQueued?: string; // ISO timestamp of last signal task creation — used for cooldown gate
  lastInscriptionCount?: number;
  lastFeeRate?: number;
  lastBrc20Volume?: number;
  lastRuneTopIds?: string[]; // top-10 rune IDs from last runes run (for change-detection)
  lastRuneHolders?: Record<string, number>; // runeId -> holderCount from last runes run
  history?: CategoryHistory;
  narrativeThread?: NarrativeThread;
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

// ---- History Helpers ----

function ensureHistory(state: HookState): CategoryHistory {
  if (!state.history) {
    state.history = { inscriptions: [], brc20: [], fees: [], "nft-floors": [], runes: [] };
  }
  // Ensure all category arrays exist (handles state from before a category was added)
  for (const cat of CATEGORIES) {
    if (!state.history[cat]) {
      state.history[cat] = [];
    }
  }
  return state.history;
}

/** Store a reading in the rolling history window. Trims to MAX_HISTORY_READINGS. */
function pushReading(history: CategoryHistory, category: Category, metrics: Record<string, number>): void {
  history[category].push({ timestamp: new Date().toISOString(), metrics });
  if (history[category].length > MAX_HISTORY_READINGS) {
    history[category].splice(0, history[category].length - MAX_HISTORY_READINGS);
  }
}

/** Compute deltas between current metrics and the most recent stored reading. Call BEFORE pushReading. */
function computeDeltas(history: CategoryHistory, category: Category, currentMetrics: Record<string, number>): DeltaInfo[] {
  const arr = history[category];
  if (arr.length === 0) return [];
  const previous = arr[arr.length - 1];
  const trendDurationMs = Date.now() - new Date(previous.timestamp).getTime();
  const deltas: DeltaInfo[] = [];
  for (const [metric, value] of Object.entries(currentMetrics)) {
    const prevValue = previous.metrics[metric];
    if (prevValue !== undefined && prevValue !== 0) {
      deltas.push({
        metric,
        current: value,
        previous: prevValue,
        absoluteChange: value - prevValue,
        percentChange: ((value - prevValue) / Math.abs(prevValue)) * 100,
        trendDurationMs,
      });
    }
  }
  return deltas;
}

/** Format deltas into a human-readable summary for inclusion in signal evidence. */
function formatDeltas(deltas: DeltaInfo[]): string {
  if (deltas.length === 0) return "";
  const durationHours = deltas[0].trendDurationMs / 3_600_000;
  const timeLabel = durationHours >= 24
    ? `${(durationHours / 24).toFixed(1)}d`
    : `${durationHours.toFixed(1)}h`;
  const parts = deltas.map((d) => {
    const sign = d.absoluteChange >= 0 ? "+" : "";
    const pctSign = d.percentChange >= 0 ? "+" : "";
    const absStr = Math.abs(d.absoluteChange) >= 1
      ? Math.round(d.absoluteChange).toLocaleString()
      : d.absoluteChange.toFixed(4);
    return `${d.metric}: ${sign}${absStr} (${pctSign}${d.percentChange.toFixed(1)}%)`;
  });
  return `Deltas vs prior reading (${timeLabel} ago): ${parts.join("; ")}`;
}

// ---- Narrative Thread Helpers ----

/** Get the Monday (YYYY-MM-DD) of the current week in UTC. */
function getCurrentMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

/** Check if narrative thread needs weekly reset. Archive old summary and start fresh. */
function checkNarrativeWeeklyReset(state: HookState): void {
  const currentMonday = getCurrentMonday();
  const thread = state.narrativeThread;

  if (!thread) {
    // Initialize empty thread
    state.narrativeThread = {
      signals: [],
      summary: "",
      weekStarted: currentMonday,
      archived: [],
    };
    return;
  }

  if (thread.weekStarted !== currentMonday) {
    // New week — archive prior summary and reset
    const archived = thread.archived ?? [];
    if (thread.summary) {
      archived.push(`[${thread.weekStarted}] ${thread.summary}`);
      // Keep max 4 archived weeks
      if (archived.length > 4) archived.splice(0, archived.length - 4);
    }
    log(`narrative: weekly reset (${thread.weekStarted} → ${currentMonday}), archived prior thread`);
    state.narrativeThread = {
      signals: [],
      summary: "",
      weekStarted: currentMonday,
      archived,
    };
  }
}

/** Build narrative context block for inclusion in signal task description. */
function buildNarrativeContext(thread: NarrativeThread | undefined): string {
  if (!thread || thread.signals.length === 0) {
    return "";
  }

  const signalList = thread.signals
    .map((s, i) => `${i + 1}. [${s.category}] ${s.headline} — Key claim: ${s.claim.slice(0, 150)}${s.claim.length > 150 ? "..." : ""}`)
    .join("\n");

  const summaryBlock = thread.summary
    ? `\n\nRunning narrative: ${thread.summary}`
    : "";

  return `\n---\n\nNARRATIVE CONTEXT — Prior signals this week:\n${signalList}${summaryBlock}\n\nReference whether this data continues, contradicts, or resolves the developing narrative. Build story continuity across signals — note when trends persist, when new data breaks a pattern, or when a prior observation reaches resolution.\n`;
}

// ---- Data Fetchers ----

async function fetchInscriptionData(apiKey: string, history: CategoryHistory): Promise<SignalData | null> {
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

    // Historical data: compute deltas then store reading
    const metrics: Record<string, number> = { totalInscriptions, tokenCount };
    const deltas = computeDeltas(history, "inscriptions", metrics);
    pushReading(history, "inscriptions", metrics);
    const deltaStr = formatDeltas(deltas);

    const inscriptionCountStr = totalInscriptions > 0
      ? `${(totalInscriptions / 1_000_000).toFixed(1)}M total inscriptions`
      : `${tokenCount} BRC-20 tokens deployed`;

    return {
      category: "inscriptions",
      headline: `Bitcoin inscription activity: ${inscriptionCountStr}, recent batch dominated by ${topTypeLabel}`,
      claim: `Bitcoin inscription activity shows ${inscriptionCountStr} on the network, with recent inscriptions dominated by ${topTypeLabel} content types.`,
      evidence: `Unisat indexer reports ${totalInscriptions > 0 ? totalInscriptions.toLocaleString() : "N/A"} total inscriptions, ${tokenCount} BRC-20 tokens deployed. The latest ${recentCount} inscriptions show content-type distribution: ${Object.entries(contentTypes).map(([k, v]) => `${k}: ${v}`).join(", ")}.${deltaStr ? ` ${deltaStr}` : ""}`,
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

async function fetchBrc20Data(apiKey: string, history: CategoryHistory): Promise<SignalData | null> {
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

    // Historical data: compute deltas then store reading
    const metrics: Record<string, number> = { totalTokens };
    for (const ts of tokenSummaries) {
      metrics[`holders_${ts.ticker}`] = ts.holders;
    }
    const deltas = computeDeltas(history, "brc20", metrics);
    pushReading(history, "brc20", metrics);
    const deltaStr = formatDeltas(deltas);

    return {
      category: "brc20",
      headline: `BRC-20 ecosystem: ${totalTokens} tokens deployed, ${topToken.ticker} leads with ${topToken.holders} holders`,
      claim: `The BRC-20 token ecosystem on Bitcoin has grown to ${totalTokens} deployed tokens, with ${topToken.ticker} leading holder count at ${topToken.holders} addresses.`,
      evidence: `Unisat BRC-20 indexer shows ${totalTokens} total tokens. Top 5 by activity: ${topList}.${deltaStr ? ` ${deltaStr}` : ""}`,
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

async function fetchFeeMarketData(history: CategoryHistory): Promise<SignalData | null> {
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

    // Historical data: compute deltas then store reading
    const metrics: Record<string, number> = { fastestFee, hourFee, minimumFee, mempoolSize, feeSpread };
    const deltas = computeDeltas(history, "fees", metrics);
    pushReading(history, "fees", metrics);
    const deltaStr = formatDeltas(deltas);

    return {
      category: "fees",
      headline: `Bitcoin fee market ${urgencyLabel}: ${fastestFee} sat/vB fastest, ${mempoolSize.toLocaleString()} unconfirmed txs (${mempoolMB} MvB)`,
      claim: `Bitcoin's fee market is at ${urgencyLabel} levels with fastest confirmation at ${fastestFee} sat/vB, creating a ${feeSpread} sat/vB spread between priority and economy transactions.`,
      evidence: `mempool.space reports: fastest fee ${fastestFee} sat/vB, 1-hour fee ${hourFee} sat/vB, minimum ${minimumFee} sat/vB. Mempool holds ${mempoolSize.toLocaleString()} unconfirmed transactions (${mempoolMB} MvB). Fee spread (fastest minus minimum): ${feeSpread} sat/vB.${deltaStr ? ` ${deltaStr}` : ""}`,
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

async function fetchNftFloorData(history: CategoryHistory): Promise<SignalData | null> {
  try {
    // CoinGecko free tier — Bitcoin NFT collections
    // Known collection IDs on CoinGecko: bitcoin-frogs, nodemonkes, bitcoin-puppets
    const collections = ["bitcoin-frogs", "nodemonkes", "bitcoin-puppets"];
    const results: Array<{ name: string; id: string; floor: number; volume24h: number; marketCap: number }> = [];

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
          id,
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

    // Historical data: compute deltas then store reading
    const metrics: Record<string, number> = { totalVolume };
    for (const r of results) {
      metrics[`floor_${r.id}`] = r.floor;
      metrics[`volume_${r.id}`] = r.volume24h;
    }
    const deltas = computeDeltas(history, "nft-floors", metrics);
    pushReading(history, "nft-floors", metrics);
    const deltaStr = formatDeltas(deltas);

    return {
      category: "nft-floors",
      headline: `Ordinals NFT floors: ${topCollection.name} at ${topCollection.floor.toFixed(4)} BTC, ${totalVolume.toFixed(2)} BTC combined 24h volume`,
      claim: `Top Bitcoin NFT collections show ${topCollection.name} leading at ${topCollection.floor.toFixed(4)} BTC floor price, with ${totalVolume.toFixed(2)} BTC combined 24-hour trading volume across major collections.`,
      evidence: `CoinGecko data for ${results.length} tracked Ordinals collections: ${floorSummary}.${deltaStr ? ` ${deltaStr}` : ""}`,
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

async function fetchRunesData(apiKey: string, state: HookState, history: CategoryHistory): Promise<SignalData | null> {
  try {
    // Overall rune ecosystem status
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/runes/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!statusRes.ok) {
      log(`runes: unisat runes/status failed (${statusRes.status})`);
      return null;
    }
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    await Bun.sleep(200);

    // Top runes by holder count
    const listRes = await fetch(`${UNISAT_API}/v1/indexer/runes/list?start=0&limit=10`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!listRes.ok) {
      log(`runes: unisat runes/list failed (${listRes.status})`);
      return null;
    }
    const listData = (await listRes.json()) as Record<string, unknown>;
    const runes = (listData?.data as Record<string, unknown>)?.list as Array<Record<string, unknown>> | undefined;

    const totalRunes = Number(status.runesCount ?? status.total ?? status.count ?? 0);
    const etchingCount = Number(status.etchingCount ?? status.etching ?? 0);

    if (totalRunes === 0 && (!runes || runes.length === 0)) {
      log("runes: no data available");
      return null;
    }

    const top10 = (runes ?? []).slice(0, 10).map((r) => ({
      id: String(r.runeId ?? r.id ?? r.rune ?? ""),
      name: String(r.spacedRune ?? r.rune ?? r.name ?? "unknown"),
      holders: Number(r.holdersCount ?? r.holders ?? 0),
    }));

    // Change-detection: new rune in top-10 or >10% holder shift
    const prevIds: string[] = (state.lastRuneTopIds as string[] | undefined) ?? [];
    const prevHolders: Record<string, number> = (state.lastRuneHolders as Record<string, number> | undefined) ?? {};

    const isFirstRun = prevIds.length === 0;
    const newInTop10 = top10.some((r) => r.id && !prevIds.includes(r.id));
    const holderShift = top10.some((r) => {
      const prev = prevHolders[r.id];
      if (prev === undefined || prev === 0) return false;
      return Math.abs(r.holders - prev) / prev > 0.1;
    });

    // Always update rune-specific state with current snapshot
    state.lastRuneTopIds = top10.map((r) => r.id);
    state.lastRuneHolders = Object.fromEntries(top10.map((r) => [r.id, r.holders]));

    // Historical data: compute deltas then store reading (always, regardless of change-detection)
    const metrics: Record<string, number> = { totalRunes, etchingCount };
    for (const r of top10.slice(0, 5)) {
      metrics[`holders_${r.name}`] = r.holders;
    }
    const deltas = computeDeltas(history, "runes", metrics);
    pushReading(history, "runes", metrics);
    const deltaStr = formatDeltas(deltas);

    if (!isFirstRun && !newInTop10 && !holderShift) {
      log("runes: no significant change (no new top-10 rune, no >10% holder shift); skipping signal");
      return null;
    }

    const changeReason = isFirstRun
      ? "first runes snapshot"
      : newInTop10
        ? "new rune entered top-10 by holder count"
        : "holder count shift >10% detected in top-10";
    log(`runes: signal threshold met — ${changeReason}`);

    const top5Summary = top10.slice(0, 5).map((r) => `${r.name} (${r.holders} holders)`).join("; ");
    const topRune = top10[0];
    const etchingNote = etchingCount > 0 ? `, ${etchingCount} recent etchings` : "";

    return {
      category: "runes",
      headline: `Bitcoin Runes: ${totalRunes.toLocaleString()} runes etched${etchingNote}, ${topRune?.name ?? "N/A"} leads at ${topRune?.holders ?? 0} holders`,
      claim: `The Bitcoin Runes protocol has ${totalRunes.toLocaleString()} total runes etched${etchingNote}, with ${changeReason} observed in holder rankings. ${topRune?.name ?? "N/A"} holds the top position at ${topRune?.holders ?? 0} addresses.`,
      evidence: `Unisat Runes indexer: ${totalRunes.toLocaleString()} total runes${etchingCount > 0 ? `, ${etchingCount} recent etchings` : ""}. Top 5 by holder count: ${top5Summary}. Change trigger: ${changeReason}.${deltaStr ? ` ${deltaStr}` : ""}`,
      implication: `Rune holder shifts signal whether Bitcoin's native fungible token layer is redistributing or consolidating. New entrants to the top-10 indicate emerging protocols gaining market share; holder count movements above 10% represent meaningful accumulation or distribution events that often precede price action in the broader Runes market.`,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat Runes Indexer API — rune status and list" },
        { url: "https://unisat.io/runes", title: "Unisat — Runes marketplace" },
      ],
      tags: "ordinals-business,runes,bitcoin,fungibles",
    };
  } catch (e) {
    log(`runes: error — ${(e as Error).message}`);
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

    // Load state for category rotation and cooldown tracking
    const rawState = (await readHookState(SENSOR_NAME)) as HookState | null;
    const state: HookState = rawState ?? { lastCategory: -1, lastAngle: -1 };

    // Ensure history arrays exist on state
    const history = ensureHistory(state);

    // Weekly narrative reset — archive prior week's thread every Monday
    checkNarrativeWeeklyReset(state);

    // Hook-state cooldown guard — check if a signal was recently queued by this sensor
    if (state.lastSignalQueued) {
      const minutesSince = (Date.now() - new Date(state.lastSignalQueued).getTime()) / 60000;
      if (minutesSince < RATE_LIMIT_MINUTES) {
        log(`cooldown active: last signal queued ${minutesSince.toFixed(1)} min ago (${RATE_LIMIT_MINUTES} min limit); skipping`);
        return "rate-limited";
      }
    }

    // DB rate limit guard — belt-and-suspenders: no signal tasks from this sensor in last RATE_LIMIT_MINUTES
    const sourcePrefix = `sensor:${SENSOR_NAME}:`;
    if (recentTaskExistsForSourcePrefix(sourcePrefix, RATE_LIMIT_MINUTES)) {
      log(`rate limit (db): signal task created within last ${RATE_LIMIT_MINUTES} min; skipping`);
      return "rate-limited";
    }

    // Pick next two categories (rotate through all five)
    const startIdx = ((state.lastCategory ?? -1) + 1) % CATEGORIES.length;
    const categoriesToFetch: Category[] = [
      CATEGORIES[startIdx],
      CATEGORIES[(startIdx + 1) % CATEGORIES.length],
    ];

    // Pick next angle (rotates independently of category)
    const angleIdx = ((state.lastAngle ?? -1) + 1) % ANGLES.length;
    const angle = ANGLES[angleIdx];

    log(`categories this run: ${categoriesToFetch.join(", ")} | angle: ${angle}`);

    // Unisat API key needed for inscription/brc20/runes categories
    const unisatKey = await getCredential("unisat", "api_key").catch(() => null);

    // Fetch data for selected categories
    const signals: SignalData[] = [];

    for (const cat of categoriesToFetch) {
      let signal: SignalData | null = null;

      switch (cat) {
        case "inscriptions":
          if (!unisatKey) { log("inscriptions: no unisat api_key, skipping"); break; }
          signal = await fetchInscriptionData(unisatKey, history);
          break;
        case "brc20":
          if (!unisatKey) { log("brc20: no unisat api_key, skipping"); break; }
          signal = await fetchBrc20Data(unisatKey, history);
          break;
        case "fees":
          signal = await fetchFeeMarketData(history);
          break;
        case "nft-floors":
          signal = await fetchNftFloorData(history);
          break;
        case "runes":
          if (!unisatKey) { log("runes: no unisat api_key, skipping"); break; }
          signal = await fetchRunesData(unisatKey, state, history);
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

      // Skip if a pending task already exists for this category (avoid duplicates)
      if (pendingTaskExistsForSource(signalSource)) {
        log(`pending task exists for ${signal.category}; skipping`);
        continue;
      }

      const sourcesJson = JSON.stringify(signal.sources);
      const narrativeBlock = buildNarrativeContext(state.narrativeThread);

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

---

${ANGLE_DIRECTIVES[angle]}

Use the angle above to reshape the raw data into a signal with a distinctive analytical voice. The claim/evidence/implication provided are starting material — rewrite them through the lens of the assigned angle. Do NOT simply repeat the raw data verbatim.
${narrativeBlock}
---

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
      state.lastSignalQueued = new Date().toISOString();
      queued++;
    }

    // Update state with rotation indices
    state.lastCategory = (startIdx + categoriesToFetch.length - 1) % CATEGORIES.length;
    state.lastAngle = angleIdx;
    state.lastRun = new Date().toISOString();
    await writeHookState(SENSOR_NAME, state);

    log(`queued ${queued} signal task(s), next categories: ${CATEGORIES[((state.lastCategory) + 1) % CATEGORIES.length]}, ${CATEGORIES[((state.lastCategory) + 2) % CATEGORIES.length]}`);
    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
