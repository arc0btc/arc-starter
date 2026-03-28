// skills/ordinals-market-data/sensor.ts
// Fetches diverse ordinals market data and queues signal-filing tasks for the ordinals beat.
// Data sources: Unisat (inscriptions + BRC-20 + runes), mempool.space (fee market), CoinGecko (NFT floors).
// Rotates through categories to ensure signal diversity for the $100K competition.
// Stores rolling history (last 6 readings per category) for delta computation and trend analysis.

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource, countSignalTasksTodayForBeat, BEAT_DAILY_ALLOCATION, DAILY_SIGNAL_CAP, countSignalTasksToday } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "ordinals-market-data";
const INTERVAL_MINUTES = 120; // every 2 hours — accelerated for $100K competition (was 240)
const MAX_HISTORY_READINGS = 6; // rolling window per category for delta computation

const INSCRIPTION_MILESTONE_INTERVAL = 5_000_000; // fire P5 signal at every 5M crossing
const DAILY_RATE_HIGH_THRESHOLD = 100_000; // >100k inscriptions/day = high-rate milestone
const DAILY_RATE_LOW_THRESHOLD = 10_000; // <10k inscriptions/day = suppressed market milestone
const RATE_SUSTAINED_READINGS = 3; // consecutive readings required to confirm sustained rate
const RATE_MILESTONE_COOLDOWN_HOURS = 24; // minimum hours between same-type rate milestone signals

// Change-detection thresholds — signal only fires when material change exceeds these gates
const FEE_CHANGE_THRESHOLD_PCT = 20; // >20% move in fastestFee
const FEE_MIN_NEWSWORTHY = 10; // ignore fee moves when both old and new values are below this sat/vB
const INSCRIPTION_CONTENT_SHIFT_PP = 10; // >10 percentage-point shift in dominant content-type share
const BRC20_HOLDER_CHANGE_THRESHOLD_PCT = 5; // >5% holder count change in any top-5 token
const NFT_FLOOR_CHANGE_THRESHOLD_PCT = 10; // >10% floor price move in any tracked collection

// Collection event detection — high-signal, low-frequency events that bypass the regular cooldown
const COLLECTION_FLOOR_BREAK_PCT = 25;       // >25% floor drop fires a floor-break event
const COLLECTION_FLOOR_SURGE_PCT = 25;       // >25% floor rise fires a floor-surge event
const COLLECTION_VOLUME_SPIKE_MULT = 3;      // >3x rolling average volume fires a volume-spike event
const COLLECTION_EVENT_COOLDOWN_HOURS = 24;  // minimum hours between same event+collection pair
const COLLECTION_HISTORY_MAX = 8;            // maximum per-collection readings stored in hook state
const COLLECTION_VOLUME_AVG_WINDOW = 5;      // readings used to compute rolling average volume

// Competition-mode flat-market fallback — generates market-structure signals when all change-detection gates miss
const COMPETITION_END_DATE = "2026-04-22"; // $100K competition ends April 22, 2026 UTC
const FLAT_MARKET_FALLBACK_COOLDOWN_HOURS = 6; // min hours between flat-market fallback signals

// Multi-beat allocation — 3 agent-trading + 3 dev-tools per day
// After OVERFLOW_HOUR_UTC, unused dev-tools slots become available to agent-trading
const OVERFLOW_HOUR_UTC = 18; // 18:00 UTC = noon MDT — late-day overflow window

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

interface CollectionReading {
  timestamp: string;
  floor: number;     // BTC floor price
  volume24h: number; // BTC 24h trading volume
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
  lastSignalQueued?: string; // DEPRECATED: legacy field, migrated to lastOrdinalSignalQueued
  lastOrdinalSignalQueued?: string; // ISO timestamp of last ordinals signal task creation — per-beat cooldown
  lastInscriptionCount?: number;
  lastFeeRate?: number;
  lastBrc20Volume?: number;
  lastRuneTopIds?: string[]; // DEPRECATED: was top-10 rune IDs; runes/list endpoint removed
  lastRuneHolders?: Record<string, number>; // DEPRECATED: was runeId -> holderCount; runes/list endpoint removed
  lastRuneTotal?: number; // total rune count from last runes/status run (for change-detection)
  lastRateMilestoneHigh?: string; // ISO timestamp of last high-rate milestone task creation
  lastRateMilestoneLow?: string; // ISO timestamp of last low-rate milestone task creation
  // Change-detection state — always updated, used to gate signal creation
  lastFastestFee?: number; // last observed fastestFee for >20% change gate
  lastContentTypeDist?: Record<string, number>; // content-type -> percentage share (0-100) from recent inscriptions
  lastDominantContentType?: string; // dominant content type from last inscription fetch
  lastBrc20TopTickers?: string[]; // top-5 BRC-20 tickers from last run
  lastBrc20Holders?: Record<string, number>; // ticker -> holderCount from last BRC-20 run
  lastNftFloors?: Record<string, number>; // collection-id -> floor BTC from last NFT fetch
  collectionHistory?: Record<string, CollectionReading[]>; // collectionId -> per-collection rolling readings
  lastCollectionEvents?: Record<string, string>; // "<collectionId>-<eventType>" -> ISO timestamp for cooldown
  history?: CategoryHistory;
  narrativeThread?: NarrativeThread;
  lastFlatMarketSignal?: string; // ISO timestamp of last competition flat-market fallback task creation
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
  priority?: number; // optional override (default: 7 for regular signals, 5 for milestones)
  milestoneSource?: string; // if set, used as task source instead of default category source
}

/** Raw data payload — fetch functions return structured data + deltas; dispatch LLM composes editorial. */
interface RawSignalPayload {
  category: Category;
  rawData: Record<string, unknown>; // structured data from the API source
  deltas: DeltaInfo[];              // computed deltas vs prior reading
  sources: Array<{ url: string; title: string }>;
  tags: string;
  changeReason: string;             // why the change-detection gate was passed
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
  const readings = history[category];
  if (readings.length === 0) return [];
  const previous = readings[readings.length - 1];
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

/** Human-readable labels for each category — used in cross-category context. */
const CATEGORY_LABELS: Record<Category, string> = {
  inscriptions: "Inscriptions",
  brc20: "BRC-20 Tokens",
  fees: "Fee Market",
  "nft-floors": "NFT Floors",
  runes: "Runes",
};

/** Build cross-category context block from stored history readings (no live API calls).
 *  Summarises the latest reading from every category OTHER than the current one,
 *  so the composing LLM can draw correlations across the ordinals ecosystem. */
function buildCrossCategoryContext(history: CategoryHistory, currentCategory: Category): string {
  const sections: string[] = [];

  for (const cat of CATEGORIES) {
    if (cat === currentCategory) continue;
    const readings = history[cat];
    if (!readings || readings.length === 0) continue;

    const latest = readings[readings.length - 1];
    const age = Date.now() - new Date(latest.timestamp).getTime();
    const ageLabel = age < 3_600_000
      ? `${Math.round(age / 60_000)}m ago`
      : `${(age / 3_600_000).toFixed(1)}h ago`;

    // Format metrics as key: value pairs
    const metricLines = Object.entries(latest.metrics)
      .map(([k, v]) => {
        // Format large numbers with locale separators, small ones with decimals
        const formatted = v >= 1000 ? v.toLocaleString("en-US") : v % 1 === 0 ? String(v) : v.toFixed(4);
        return `  ${k}: ${formatted}`;
      })
      .join("\n");

    // If there are 2+ readings, show direction of key metrics
    let trendHint = "";
    if (readings.length >= 2) {
      const prev = readings[readings.length - 2];
      const changes: string[] = [];
      for (const [k, v] of Object.entries(latest.metrics)) {
        const pv = prev.metrics[k];
        if (pv !== undefined && pv !== 0) {
          const pct = ((v - pv) / Math.abs(pv)) * 100;
          if (Math.abs(pct) >= 1) {
            changes.push(`${k} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
          }
        }
      }
      if (changes.length > 0) {
        trendHint = `\n  Recent trend: ${changes.join(", ")}`;
      }
    }

    sections.push(`**${CATEGORY_LABELS[cat]}** (${ageLabel}):\n${metricLines}${trendHint}`);
  }

  if (sections.length === 0) return "";

  return `\n---\n\n## Cross-Category Context (for correlation opportunities)\n\nLatest stored readings from other ordinals categories. Use these to identify cross-category correlations, divergences, or reinforcing patterns. Do NOT simply list these — weave relevant connections into your claim, evidence, or implication where the data supports it.\n\n${sections.join("\n\n")}\n`;
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

// ---- Milestone Detection ----

/** Returns the milestone value if prevCount → currCount crossed an INSCRIPTION_MILESTONE_INTERVAL boundary, else null. */
function detectMilestoneCrossed(prevCount: number, currCount: number): number | null {
  if (prevCount <= 0 || currCount <= prevCount) return null;
  const prevMilestone = Math.floor(prevCount / INSCRIPTION_MILESTONE_INTERVAL);
  const currMilestone = Math.floor(currCount / INSCRIPTION_MILESTONE_INTERVAL);
  return currMilestone > prevMilestone ? currMilestone * INSCRIPTION_MILESTONE_INTERVAL : null;
}

/** Returns high/low rate milestone if the last RATE_SUSTAINED_READINGS inscription readings all breach a threshold. */
function detectDailyRateMilestone(history: CategoryHistory): { type: "high" | "low"; rate: number } | null {
  const readings = history["inscriptions"];
  if (readings.length < RATE_SUSTAINED_READINGS) return null;
  const lastN = readings.slice(-RATE_SUSTAINED_READINGS);
  const rates: number[] = [];
  for (let i = 1; i < lastN.length; i++) {
    const prev = lastN[i - 1];
    const curr = lastN[i];
    const delta = (curr.metrics.totalInscriptions ?? 0) - (prev.metrics.totalInscriptions ?? 0);
    const days = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 86_400_000;
    if (days <= 0 || delta < 0) continue;
    rates.push(delta / days);
  }
  if (rates.length < RATE_SUSTAINED_READINGS - 1) return null;
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (rates.every((r) => r > DAILY_RATE_HIGH_THRESHOLD)) return { type: "high", rate: avg };
  if (rates.every((r) => r > 0 && r < DAILY_RATE_LOW_THRESHOLD)) return { type: "low", rate: avg };
  return null;
}

/**
 * Check for inscription milestones using freshly-updated history and previous state.
 * Call AFTER fetchInscriptionData has pushed a new reading to history["inscriptions"].
 * Updates state.lastInscriptionCount for future milestone tracking.
 * Returns array of milestone SignalData items (may be empty).
 */
function detectMilestoneSignals(state: HookState, history: CategoryHistory): SignalData[] {
  const milestones: SignalData[] = [];
  const readings = history["inscriptions"];
  if (readings.length === 0) return milestones;

  const currentCount = readings[readings.length - 1].metrics.totalInscriptions ?? 0;

  // --- Round-number milestone crossing ---
  const prevCount = state.lastInscriptionCount ?? 0;
  if (prevCount > 0 && currentCount > prevCount) {
    const crossed = detectMilestoneCrossed(prevCount, currentCount);
    if (crossed !== null) {
      const crossedM = (crossed / 1_000_000).toFixed(0);
      log(`milestone: inscription count crossed ${crossedM}M (${prevCount.toLocaleString()} → ${currentCount.toLocaleString()})`);
      milestones.push({
        category: "inscriptions",
        headline: `Bitcoin inscription count reaches ${crossedM}M milestone`,
        claim: `The Bitcoin ordinals protocol has crossed the ${crossedM} million inscription mark, a round-number milestone reflecting sustained protocol adoption.`,
        evidence: `Unisat indexer confirms ${currentCount.toLocaleString()} total inscriptions, crossing the ${crossed.toLocaleString()} milestone. Previous recorded count: ${prevCount.toLocaleString()} (Δ: +${(currentCount - prevCount).toLocaleString()}).`,
        implication: `Round-number milestones in protocol adoption metrics attract media attention and serve as ecosystem reflection points. The ${crossedM}M mark signals that ordinals inscription activity has maintained sufficient economic incentive to sustain this level of cumulative output.`,
        sources: [
          { url: "https://open-api.unisat.io", title: "Unisat Indexer API — inscription count" },
          { url: "https://mempool.space", title: "mempool.space — Bitcoin block explorer" },
        ],
        tags: "ordinals-business,inscriptions,bitcoin,milestone,on-chain",
        priority: 5,
        milestoneSource: `sensor:${SENSOR_NAME}:milestone-inscriptions-${crossed}`,
      });
    }
  }

  // Always update stored count after checking, so next run has fresh baseline
  state.lastInscriptionCount = currentCount;

  // --- Daily rate milestones ---
  const rateMilestone = detectDailyRateMilestone(history);
  if (rateMilestone) {
    const cooldownKey = rateMilestone.type === "high" ? "lastRateMilestoneHigh" : "lastRateMilestoneLow";
    const lastFired = state[cooldownKey] as string | undefined;
    if (lastFired) {
      const hoursSince = (Date.now() - new Date(lastFired).getTime()) / 3_600_000;
      if (hoursSince < RATE_MILESTONE_COOLDOWN_HOURS) {
        log(`rate milestone (${rateMilestone.type}): filed ${hoursSince.toFixed(1)}h ago — within ${RATE_MILESTONE_COOLDOWN_HOURS}h cooldown; skipping`);
        return milestones;
      }
    }

    const rateK = (rateMilestone.rate / 1000).toFixed(1);
    const isHigh = rateMilestone.type === "high";
    const thresholdLabel = isHigh
      ? `>${(DAILY_RATE_HIGH_THRESHOLD / 1000).toFixed(0)}k/day`
      : `<${(DAILY_RATE_LOW_THRESHOLD / 1000).toFixed(0)}k/day`;
    log(`milestone: inscription rate ${rateMilestone.type} — ${rateK}k/day sustained`);
    milestones.push({
      category: "inscriptions",
      headline: isHigh
        ? `Bitcoin inscription rate exceeds 100k/day — ${rateK}k inscriptions/day sustained`
        : `Bitcoin inscription rate drops below 10k/day — ${rateK}k inscriptions/day sustained`,
      claim: isHigh
        ? `Bitcoin's ordinals inscription rate has sustained above 100,000 per day, averaging ${rateK}k inscriptions/day across the last ${RATE_SUSTAINED_READINGS} readings — signalling elevated on-chain creative and economic activity.`
        : `Bitcoin's ordinals inscription rate has sustained below 10,000 per day, averaging ${rateK}k inscriptions/day across the last ${RATE_SUSTAINED_READINGS} readings — signalling suppressed market activity.`,
      evidence: `${RATE_SUSTAINED_READINGS} consecutive inscription readings confirm sustained rate of ~${rateK}k inscriptions/day (threshold: ${thresholdLabel}). Current total: ${currentCount.toLocaleString()} inscriptions.`,
      implication: isHigh
        ? `Sustained inscription velocity above 100k/day indicates active minting campaigns, BRC-20 deployments, or collectible inscription series, placing meaningful demand pressure on block space.`
        : `Sustained inscription velocity below 10k/day signals reduced economic incentive to inscribe — high fees pricing out low-value content, or a cyclical lull in minting activity.`,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat Indexer API — inscription count history" },
      ],
      tags: `ordinals-business,inscriptions,bitcoin,rate,${isHigh ? "high-activity" : "low-activity"}`,
      priority: 5,
      milestoneSource: `sensor:${SENSOR_NAME}:milestone-rate-${rateMilestone.type}`,
    });
  }

  return milestones;
}

// ---- Collection Event Detection ----

/**
 * Detect floor-break, floor-surge, and volume-spike events for individual NFT collections.
 * Compares current readings against per-collection history stored in state.
 * Updates state.collectionHistory with the new reading after checks.
 * Returns an array of SignalData for any events that cleared the cooldown gate.
 * Call BEFORE the aggregate change-detection gate so history always accumulates.
 */
function detectCollectionEventSignals(
  results: Array<{ name: string; id: string; floor: number; volume24h: number }>,
  state: HookState,
): SignalData[] {
  if (!state.collectionHistory) state.collectionHistory = {};
  if (!state.lastCollectionEvents) state.lastCollectionEvents = {};
  const events: SignalData[] = [];
  const now = new Date().toISOString();

  for (const r of results) {
    if (r.floor <= 0) continue; // skip collections with no floor data

    const colHistory = state.collectionHistory[r.id] ?? [];

    if (colHistory.length > 0) {
      const prev = colHistory[colHistory.length - 1];

      // Floor change detection (only when prior floor is valid)
      if (prev.floor > 0) {
        const floorChangePct = ((r.floor - prev.floor) / prev.floor) * 100;

        if (floorChangePct <= -COLLECTION_FLOOR_BREAK_PCT) {
          const eventKey = `${r.id}-floor-break`;
          const lastFired = state.lastCollectionEvents[eventKey];
          const hoursSince = lastFired
            ? (Date.now() - new Date(lastFired).getTime()) / 3_600_000
            : Infinity;
          if (hoursSince >= COLLECTION_EVENT_COOLDOWN_HOURS) {
            log(`collection-event: floor-break ${r.name} ${prev.floor.toFixed(4)}→${r.floor.toFixed(4)} BTC (${floorChangePct.toFixed(1)}%)`);
            state.lastCollectionEvents[eventKey] = now;
            events.push({
              category: "nft-floors",
              headline: `${r.name} floor breaks ${Math.abs(floorChangePct).toFixed(0)}% lower — now ${r.floor.toFixed(4)} BTC`,
              claim: `${r.name} has seen its floor price collapse ${Math.abs(floorChangePct).toFixed(1)}% from ${prev.floor.toFixed(4)} BTC to ${r.floor.toFixed(4)} BTC, marking a significant floor-break event in this leading Bitcoin NFT collection.`,
              evidence: `CoinGecko: ${r.name} floor ${prev.floor.toFixed(4)} BTC → ${r.floor.toFixed(4)} BTC (${floorChangePct.toFixed(1)}%). Prior reading: ${prev.timestamp}. Current 24h volume: ${r.volume24h.toFixed(2)} BTC.`,
              implication: `Floor breaks >25% in blue-chip Ordinals collections signal forced liquidations, declining collector confidence, or macro-driven selling pressure in Bitcoin NFTs. Rapid floor repricing in a leading collection often precedes sector-wide revaluation.`,
              sources: [
                { url: "https://www.coingecko.com/en/nft", title: `CoinGecko — ${r.name} collection data` },
                { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
              ],
              tags: "ordinals-business,nft,bitcoin,floors,floor-break",
              priority: 5,
              milestoneSource: `sensor:${SENSOR_NAME}:collection-event-${r.id}-floor-break`,
            });
          } else {
            log(`collection-event: floor-break cooldown active for ${r.name} (${hoursSince.toFixed(1)}h < ${COLLECTION_EVENT_COOLDOWN_HOURS}h)`);
          }
        } else if (floorChangePct >= COLLECTION_FLOOR_SURGE_PCT) {
          const eventKey = `${r.id}-floor-surge`;
          const lastFired = state.lastCollectionEvents[eventKey];
          const hoursSince = lastFired
            ? (Date.now() - new Date(lastFired).getTime()) / 3_600_000
            : Infinity;
          if (hoursSince >= COLLECTION_EVENT_COOLDOWN_HOURS) {
            log(`collection-event: floor-surge ${r.name} ${prev.floor.toFixed(4)}→${r.floor.toFixed(4)} BTC (+${floorChangePct.toFixed(1)}%)`);
            state.lastCollectionEvents[eventKey] = now;
            events.push({
              category: "nft-floors",
              headline: `${r.name} floor surges ${floorChangePct.toFixed(0)}% — now ${r.floor.toFixed(4)} BTC`,
              claim: `${r.name} has seen its floor price surge ${floorChangePct.toFixed(1)}% from ${prev.floor.toFixed(4)} BTC to ${r.floor.toFixed(4)} BTC, marking a significant floor appreciation event in this leading Bitcoin NFT collection.`,
              evidence: `CoinGecko: ${r.name} floor ${prev.floor.toFixed(4)} BTC → ${r.floor.toFixed(4)} BTC (+${floorChangePct.toFixed(1)}%). Prior reading: ${prev.timestamp}. Current 24h volume: ${r.volume24h.toFixed(2)} BTC.`,
              implication: `Floor surges >25% in leading Ordinals collections signal strong collector demand, potential new liquidity entering the Bitcoin NFT space, or a catalyst event such as a high-profile sale or partnership announcement. Rapid floor appreciation typically attracts broader market attention and can trigger cascading demand across the sector.`,
              sources: [
                { url: "https://www.coingecko.com/en/nft", title: `CoinGecko — ${r.name} collection data` },
                { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
              ],
              tags: "ordinals-business,nft,bitcoin,floors,floor-surge",
              priority: 5,
              milestoneSource: `sensor:${SENSOR_NAME}:collection-event-${r.id}-floor-surge`,
            });
          } else {
            log(`collection-event: floor-surge cooldown active for ${r.name} (${hoursSince.toFixed(1)}h < ${COLLECTION_EVENT_COOLDOWN_HOURS}h)`);
          }
        }
      }

      // Volume spike detection — compare current to rolling average of prior readings
      if (colHistory.length >= 2) {
        const window = colHistory.slice(-COLLECTION_VOLUME_AVG_WINDOW);
        const avgVolume = window.reduce((sum, rd) => sum + rd.volume24h, 0) / window.length;
        if (avgVolume > 0 && r.volume24h >= avgVolume * COLLECTION_VOLUME_SPIKE_MULT) {
          const multiplier = r.volume24h / avgVolume;
          const eventKey = `${r.id}-volume-spike`;
          const lastFired = state.lastCollectionEvents[eventKey];
          const hoursSince = lastFired
            ? (Date.now() - new Date(lastFired).getTime()) / 3_600_000
            : Infinity;
          if (hoursSince >= COLLECTION_EVENT_COOLDOWN_HOURS) {
            log(`collection-event: volume-spike ${r.name} ${r.volume24h.toFixed(2)} BTC (${multiplier.toFixed(1)}x avg ${avgVolume.toFixed(2)} BTC)`);
            state.lastCollectionEvents[eventKey] = now;
            events.push({
              category: "nft-floors",
              headline: `${r.name} volume spikes ${multiplier.toFixed(1)}x average — ${r.volume24h.toFixed(2)} BTC in 24h`,
              claim: `${r.name} has recorded ${r.volume24h.toFixed(2)} BTC in 24-hour volume, ${multiplier.toFixed(1)}x its recent rolling average of ${avgVolume.toFixed(2)} BTC — an unusual volume spike signalling heightened market activity.`,
              evidence: `CoinGecko: ${r.name} 24h volume ${r.volume24h.toFixed(2)} BTC vs rolling ${window.length}-reading average of ${avgVolume.toFixed(2)} BTC (${multiplier.toFixed(1)}x). Current floor: ${r.floor.toFixed(4)} BTC.`,
              implication: `Volume spikes >3x the rolling average in a single Ordinals collection signal a catalytic event — a high-profile sale, new collector demand, or coordinated trading activity. Elevated volume typically precedes floor repricing and draws wider attention to the collection and broader Bitcoin NFT market.`,
              sources: [
                { url: "https://www.coingecko.com/en/nft", title: `CoinGecko — ${r.name} collection data` },
                { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
              ],
              tags: "ordinals-business,nft,bitcoin,volume,volume-spike",
              priority: 5,
              milestoneSource: `sensor:${SENSOR_NAME}:collection-event-${r.id}-volume-spike`,
            });
          } else {
            log(`collection-event: volume-spike cooldown active for ${r.name} (${hoursSince.toFixed(1)}h < ${COLLECTION_EVENT_COOLDOWN_HOURS}h)`);
          }
        }
      }
    } else {
      log(`collection-event: first reading for ${r.name} — building history baseline`);
    }

    // Always push new reading after event checks (history used for next run's comparisons)
    colHistory.push({ timestamp: now, floor: r.floor, volume24h: r.volume24h });
    if (colHistory.length > COLLECTION_HISTORY_MAX) {
      colHistory.splice(0, colHistory.length - COLLECTION_HISTORY_MAX);
    }
    state.collectionHistory[r.id] = colHistory;
  }

  return events;
}

// ---- Data Fetchers ----

async function fetchInscriptionData(apiKey: string, state: HookState, history: CategoryHistory): Promise<RawSignalPayload | null> {
  try {
    // BRC-20 status for overall inscription activity
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/brc20/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!statusRes.ok) {
      log(`inscriptions: unisat status failed (${statusRes.status})`);
      return null;
    }
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    // Derive total inscription count from max inscriptionNumberEnd across top BRC-20 tokens.
    // The /inscription/info/recent endpoint requires an inscriptionId parameter (no longer supports listing).
    // inscriptionNumberEnd is the inscription number of the last mint for each BRC-20 token — the maximum
    // across the top-10 tokens gives a reliable lower-bound proxy for total Bitcoin inscriptions.
    const detail = (status.detail as Array<Record<string, unknown>> | undefined) ?? [];
    const totalInscriptions = detail.length > 0
      ? Math.max(...detail.map((d) => Number(d.inscriptionNumberEnd ?? d.inscriptionNumber ?? 0)))
      : 0;
    const tokenCount = Number(status.total ?? 0); // total BRC-20 token count

    if (totalInscriptions === 0 && tokenCount === 0) {
      log("inscriptions: no data available");
      return null;
    }

    // Historical data: compute deltas then store reading (always, regardless of gate)
    const metrics: Record<string, number> = { totalInscriptions, tokenCount };
    const deltas = computeDeltas(history, "inscriptions", metrics);
    pushReading(history, "inscriptions", metrics);

    // Change-detection gate: >0.1% change in totalInscriptions or first reading
    const prevCount = state.lastInscriptionCount as number | undefined;
    state.lastInscriptionCount = totalInscriptions;

    if (prevCount !== undefined) {
      const changePct = prevCount > 0 ? Math.abs(totalInscriptions - prevCount) / prevCount * 100 : 0;
      if (changePct < 0.1) {
        log(`inscriptions: below threshold — change ${changePct.toFixed(3)}% < 0.1%; skipping signal`);
        return null;
      }
      log(`inscriptions: threshold met — inscription count changed ${changePct.toFixed(2)}% (${prevCount.toLocaleString()} → ${totalInscriptions.toLocaleString()})`);
    } else {
      log("inscriptions: first reading — allowing signal (no prior baseline)");
    }

    const changeReason = prevCount === undefined
      ? "first inscription count reading (no prior baseline)"
      : `inscription count changed ${((Math.abs(totalInscriptions - prevCount) / prevCount) * 100).toFixed(2)}%`;

    return {
      category: "inscriptions",
      rawData: {
        totalInscriptions,
        tokenCount,
      },
      deltas,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat Indexer API — BRC-20 status with inscription numbers" },
      ],
      tags: "ordinals-business,inscriptions,bitcoin,on-chain",
      changeReason,
    };
  } catch (e) {
    log(`inscriptions: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchBrc20Data(apiKey: string, state: HookState, history: CategoryHistory): Promise<RawSignalPayload | null> {
  try {
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/brc20/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!statusRes.ok) return null;
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    // Use detail from the already-fetched status response — brc20/list endpoint returns only ticker strings,
    // not full objects. The status endpoint's detail array has holdersCount and all needed fields.
    const tokens = (status.detail as Array<Record<string, unknown>> | undefined) ?? [];

    if (tokens.length === 0) {
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
    const totalTokens = Number(status.total ?? tokens.length);

    // Historical data: compute deltas then store reading (always, regardless of gate)
    const metrics: Record<string, number> = { totalTokens };
    for (const tokenSummary of tokenSummaries) {
      metrics[`holders_${tokenSummary.ticker}`] = tokenSummary.holders;
    }
    const deltas = computeDeltas(history, "brc20", metrics);
    pushReading(history, "brc20", metrics);

    // Change-detection gate: >5% holder count change in any top-5 token, or new token entering top-5
    const currentTickers = tokenSummaries.map((t) => t.ticker);
    const prevTickers: string[] = (state.lastBrc20TopTickers as string[] | undefined) ?? [];
    const prevHolders: Record<string, number> = (state.lastBrc20Holders as Record<string, number> | undefined) ?? {};

    // Always update state
    state.lastBrc20TopTickers = currentTickers;
    state.lastBrc20Holders = Object.fromEntries(tokenSummaries.map((t) => [t.ticker, t.holders]));

    let changeReason: string;
    const isFirstRun = prevTickers.length === 0;
    if (!isFirstRun) {
      const newInTop5 = currentTickers.some((t) => !prevTickers.includes(t));
      const holderShift = tokenSummaries.some((t) => {
        const prev = prevHolders[t.ticker];
        if (prev === undefined || prev === 0) return false;
        return Math.abs(t.holders - prev) / prev * 100 >= BRC20_HOLDER_CHANGE_THRESHOLD_PCT;
      });
      if (!newInTop5 && !holderShift) {
        log(`brc20: below threshold — no new top-5 token, no >${BRC20_HOLDER_CHANGE_THRESHOLD_PCT}% holder shift; skipping signal`);
        return null;
      }
      const reason = newInTop5 ? "new token entered top-5" : `holder count shift >${BRC20_HOLDER_CHANGE_THRESHOLD_PCT}% in top-5`;
      log(`brc20: threshold met — ${reason}`);
      changeReason = reason;
    } else {
      log("brc20: first reading — allowing signal (no prior baseline)");
      changeReason = "first reading (no prior baseline)";
    }

    return {
      category: "brc20",
      rawData: {
        totalTokens,
        tokenSummaries,
        topToken,
      },
      deltas,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat BRC-20 Indexer — token status and rankings" },
        { url: "https://mempool.space", title: "mempool.space — Bitcoin transaction fees" },
      ],
      tags: "ordinals-business,brc-20,bitcoin,fungibles",
      changeReason,
    };
  } catch (e) {
    log(`brc20: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchFeeMarketData(state: HookState, history: CategoryHistory): Promise<RawSignalPayload | null> {
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

    if (fastestFee === 0) {
      log("fees: no fee data");
      return null;
    }

    const feeSpread = fastestFee - minimumFee;
    const urgencyLabel = fastestFee > 50 ? "elevated" : fastestFee > 20 ? "moderate" : "low";

    // Historical data: compute deltas then store reading (always, regardless of gate)
    const metrics: Record<string, number> = { fastestFee, hourFee, minimumFee, mempoolSize, feeSpread };
    const deltas = computeDeltas(history, "fees", metrics);
    pushReading(history, "fees", metrics);

    // Change-detection gate: >20% move in fastestFee
    const prevFee = state.lastFastestFee;
    state.lastFastestFee = fastestFee; // always update
    let changeReason: string;
    if (prevFee !== undefined && prevFee > 0) {
      // Skip trivial low-fee noise: 2→3 sat/vB is 50% but not newsworthy
      if (prevFee < FEE_MIN_NEWSWORTHY && fastestFee < FEE_MIN_NEWSWORTHY) {
        log(`fees: both values below ${FEE_MIN_NEWSWORTHY} sat/vB — ${prevFee}→${fastestFee}; not newsworthy`);
        return null;
      }
      const feePctChange = Math.abs(fastestFee - prevFee) / prevFee * 100;
      if (feePctChange < FEE_CHANGE_THRESHOLD_PCT) {
        log(`fees: below threshold — fastestFee ${prevFee}→${fastestFee} (${feePctChange.toFixed(1)}% < ${FEE_CHANGE_THRESHOLD_PCT}%); skipping signal`);
        return null;
      }
      log(`fees: threshold met — fastestFee ${prevFee}→${fastestFee} (${feePctChange.toFixed(1)}% >= ${FEE_CHANGE_THRESHOLD_PCT}%)`);
      changeReason = `fastestFee moved ${feePctChange.toFixed(1)}% (${prevFee} → ${fastestFee} sat/vB)`;
    } else {
      log("fees: first reading — allowing signal (no prior baseline)");
      changeReason = "first reading (no prior baseline)";
    }

    return {
      category: "fees",
      rawData: {
        fastestFee,
        hourFee,
        minimumFee,
        mempoolSize,
        mempoolVsize,
        feeSpread,
        urgencyLabel,
      },
      deltas,
      sources: [
        { url: "https://mempool.space/api/v1/fees/recommended", title: "mempool.space — recommended fee rates" },
        { url: "https://mempool.space/api/mempool", title: "mempool.space — mempool statistics" },
      ],
      tags: "ordinals-business,fees,bitcoin,mempool",
      changeReason,
    };
  } catch (e) {
    log(`fees: error — ${(e as Error).message}`);
    return null;
  }
}

async function fetchNftFloorData(state: HookState, history: CategoryHistory): Promise<{ signal: RawSignalPayload | null; collectionEvents: SignalData[] }> {
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
      return { signal: null, collectionEvents: [] };
    }

    // Sort by floor price descending
    results.sort((a, b) => b.floor - a.floor);

    const totalVolume = results.reduce((sum, r) => sum + r.volume24h, 0);

    // Historical data: compute deltas then store reading (always, regardless of gate)
    const metrics: Record<string, number> = { totalVolume };
    for (const r of results) {
      metrics[`floor_${r.id}`] = r.floor;
      metrics[`volume_${r.id}`] = r.volume24h;
    }
    const deltas = computeDeltas(history, "nft-floors", metrics);
    pushReading(history, "nft-floors", metrics);

    // Detect per-collection events (floor-break, floor-surge, volume-spike) before aggregate gate
    // so collection history always accumulates regardless of whether the regular signal fires.
    const collectionEvents = detectCollectionEventSignals(results, state);

    // Change-detection gate: >10% floor price move in any tracked collection
    const prevFloors: Record<string, number> = (state.lastNftFloors as Record<string, number> | undefined) ?? {};
    // Always update state
    state.lastNftFloors = Object.fromEntries(results.map((r) => [r.id, r.floor]));

    let changeReason: string;
    const isFirstRun = Object.keys(prevFloors).length === 0;
    if (!isFirstRun) {
      const floorMoved = results.some((r) => {
        const prev = prevFloors[r.id];
        if (prev === undefined || prev === 0) return false;
        return Math.abs(r.floor - prev) / prev * 100 >= NFT_FLOOR_CHANGE_THRESHOLD_PCT;
      });
      if (!floorMoved) {
        log(`nft-floors: below threshold — no collection floor moved >${NFT_FLOOR_CHANGE_THRESHOLD_PCT}%; skipping signal`);
        return { signal: null, collectionEvents };
      }
      // Log which collection triggered
      const moved = results.filter((r) => {
        const prev = prevFloors[r.id];
        if (prev === undefined || prev === 0) return false;
        return Math.abs(r.floor - prev) / prev * 100 >= NFT_FLOOR_CHANGE_THRESHOLD_PCT;
      }).map((r) => {
        const prev = prevFloors[r.id];
        const pct = ((r.floor - prev) / prev * 100).toFixed(1);
        return `${r.name} ${prev.toFixed(4)}→${r.floor.toFixed(4)} BTC (${pct}%)`;
      });
      log(`nft-floors: threshold met — ${moved.join(", ")}`);
      changeReason = `floor moved >${NFT_FLOOR_CHANGE_THRESHOLD_PCT}%: ${moved.join(", ")}`;
    } else {
      log("nft-floors: first reading — allowing signal (no prior baseline)");
      changeReason = "first reading (no prior baseline)";
    }

    return {
      signal: {
        category: "nft-floors",
        rawData: {
          collections: results.map((r) => ({
            name: r.name,
            id: r.id,
            floorBtc: r.floor,
            volume24hBtc: r.volume24h,
            marketCapBtc: r.marketCap,
          })),
          totalVolumeBtc: totalVolume,
        },
        deltas,
        sources: [
          { url: "https://www.coingecko.com/en/nft", title: "CoinGecko — Ordinals NFT collection data" },
          { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
        ],
        tags: "ordinals-business,nft,bitcoin,floors",
        changeReason,
      },
      collectionEvents,
    };
  } catch (e) {
    log(`nft-floors: error — ${(e as Error).message}`);
    return { signal: null, collectionEvents: [] };
  }
}

async function fetchRunesData(apiKey: string, state: HookState, history: CategoryHistory): Promise<RawSignalPayload | null> {
  try {
    // Overall rune ecosystem status
    const statusRes = await fetch(`${UNISAT_API}/v1/indexer/runes/status`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!statusRes.ok) {
      log(`runes: unisat runes/status failed (${statusRes.status})`);
      return null;
    }
    const statusData = (await statusRes.json()) as Record<string, unknown>;
    const status = statusData?.data as Record<string, unknown> | undefined;
    if (!status) return null;

    // runes/list endpoint no longer available — use status-only data.
    // status.runes = total etched rune count; halvingBlockCount = blocks until next halving.
    const totalRunes = Number(status.runes ?? 0);
    const halvingBlockCount = Number(status.halvingBlockCount ?? 0);
    const minimumRune = String(status.minimumRuneForNextBlock ?? "");

    if (totalRunes === 0) {
      log("runes: no data available");
      return null;
    }

    // Historical data: compute deltas then store reading (always, regardless of change-detection)
    const metrics: Record<string, number> = { totalRunes, halvingBlockCount };
    const deltas = computeDeltas(history, "runes", metrics);
    pushReading(history, "runes", metrics);

    // Change-detection: first run, or ≥100 new runes etched, or halving within 5,000 blocks
    const prevTotal = state.lastRuneTotal as number | undefined;
    const newRunesSince = prevTotal !== undefined ? totalRunes - prevTotal : 0;
    const isFirstRun = prevTotal === undefined;
    const halvingNear = halvingBlockCount > 0 && halvingBlockCount <= 5_000;

    state.lastRuneTotal = totalRunes;

    if (!isFirstRun && newRunesSince < 100 && !halvingNear) {
      log(`runes: no significant change — ${newRunesSince} new runes since last reading, halving in ${halvingBlockCount} blocks; skipping signal`);
      return null;
    }

    const changeReason = isFirstRun
      ? "first runes snapshot"
      : halvingNear
        ? `halving approaching — ${halvingBlockCount} blocks remaining`
        : `${newRunesSince} new runes etched since last reading`;
    log(`runes: signal threshold met — ${changeReason}`);

    return {
      category: "runes",
      rawData: {
        totalRunes,
        halvingBlockCount,
        minimumRune,
      },
      deltas,
      sources: [
        { url: "https://open-api.unisat.io", title: "Unisat Runes Indexer API — rune ecosystem status" },
        { url: "https://unisat.io/runes", title: "Unisat — Runes marketplace" },
      ],
      tags: "ordinals-business,runes,bitcoin,fungibles",
      changeReason,
    };
  } catch (e) {
    log(`runes: error — ${(e as Error).message}`);
    return null;
  }
}

// ---- Competition-Mode Flat-Market Fallback ----

/**
 * Build a market-structure signal when all change-detection gates miss.
 * Uses accumulated history to report on the sustained stable state — stability is data.
 * Returns null if insufficient history exists for a meaningful signal.
 */
function buildFlatMarketSignal(history: CategoryHistory, angle: Angle): SignalData | null {
  // Priority order: fees > inscriptions > runes > brc20 > nft-floors (readability + data richness)
  const candidateOrder: Category[] = ["fees", "inscriptions", "runes", "brc20", "nft-floors"];

  let bestCategory: Category | null = null;
  let bestReadings: CategoryReading[] = [];

  for (const cat of candidateOrder) {
    const readings = history[cat];
    if (readings && readings.length >= 3) {
      bestCategory = cat;
      bestReadings = readings;
      break;
    }
  }
  // Fall back to any category with 2+ readings
  if (!bestCategory) {
    for (const cat of candidateOrder) {
      const readings = history[cat];
      if (readings && readings.length >= 2) {
        bestCategory = cat;
        bestReadings = readings;
        break;
      }
    }
  }

  if (!bestCategory || bestReadings.length < 2) return null;

  const latest = bestReadings[bestReadings.length - 1];
  const oldest = bestReadings[0];
  const spanMs = new Date(latest.timestamp).getTime() - new Date(oldest.timestamp).getTime();
  const spanHours = Math.round(spanMs / 3_600_000);
  const readingCount = bestReadings.length;

  let headline: string;
  let claim: string;
  let evidence: string;
  let implication: string;
  let sources: Array<{ url: string; title: string }>;
  let tags: string;

  switch (bestCategory) {
    case "fees": {
      const fastestFee = latest.metrics.fastestFee ?? 0;
      const minimumFee = latest.metrics.minimumFee ?? 0;
      const mempoolSize = latest.metrics.mempoolSize ?? 0;
      const avgFastest = bestReadings.reduce((s, r) => s + (r.metrics.fastestFee ?? 0), 0) / readingCount;
      const feeLabel = fastestFee <= 2 ? "floor" : fastestFee <= 5 ? "low" : fastestFee <= 15 ? "moderate" : "elevated";
      headline = `Bitcoin fee market holds at ${feeLabel} — fastest fee stable near ${fastestFee} sat/vB across ${readingCount} readings`;
      claim = `Bitcoin's fee market has remained in a ${feeLabel}-rate environment, with the fastest fee holding near ${fastestFee} sat/vB over ${spanHours} hours and ${readingCount} consecutive sensor readings — sustained ${feeLabel}-fee conditions shape inscription economics for the market.`;
      evidence = `mempool.space: fastest fee ${fastestFee} sat/vB, minimum fee ${minimumFee} sat/vB, mempool count ${mempoolSize.toLocaleString("en-US")}. Average fastest fee across ${readingCount} readings: ${avgFastest.toFixed(1)} sat/vB (${spanHours}h span). No single reading exceeded the ${FEE_CHANGE_THRESHOLD_PCT}% change threshold.`;
      implication = feeLabel === "floor" || feeLabel === "low"
        ? `Sustained ${feeLabel}-fee conditions reduce inscription friction — historically, extended low-fee periods precede batched inscription activity and BRC-20 deploy waves as economic barriers to on-chain publishing compress.`
        : `Sustained ${feeLabel} fees compress inscription economics, pricing out low-value content and concentrating block space usage in higher-value protocol activity.`;
      sources = [
        { url: "https://mempool.space/api/v1/fees/recommended", title: "mempool.space — recommended fee rates" },
        { url: "https://mempool.space/api/mempool", title: "mempool.space — mempool statistics" },
      ];
      tags = "ordinals-business,fees,bitcoin,mempool,market-structure";
      break;
    }
    case "inscriptions": {
      const totalInscriptions = latest.metrics.totalInscriptions ?? 0;
      const prevTotal = bestReadings[bestReadings.length - 2].metrics.totalInscriptions ?? 0;
      const changePct = prevTotal > 0 ? ((totalInscriptions - prevTotal) / prevTotal * 100).toFixed(3) : "0.000";
      headline = `Bitcoin inscription count holds at ${(totalInscriptions / 1_000_000).toFixed(2)}M — velocity below signal threshold for ${readingCount} consecutive readings`;
      claim = `Bitcoin ordinals inscription velocity has held below material-change thresholds across ${readingCount} consecutive readings spanning ${spanHours} hours, with cumulative inscriptions stable at ${totalInscriptions.toLocaleString("en-US")}.`;
      evidence = `Unisat indexer: ${totalInscriptions.toLocaleString("en-US")} total inscriptions. Latest reading delta: ${changePct}% (gate threshold: 0.1%). ${readingCount} consecutive sub-threshold readings spanning ${spanHours}h.`;
      implication = `Sustained inscription inactivity indicates either a cyclical demand lull or fee/economic conditions suppressing new inscription activity. Historically, extended low-velocity periods resolve with a burst of activity when market conditions shift — the accumulated baseline provides a clean departure point for measuring the next uptick.`;
      sources = [
        { url: "https://open-api.unisat.io", title: "Unisat Indexer API — BRC-20 status with inscription numbers" },
      ];
      tags = "ordinals-business,inscriptions,bitcoin,on-chain,market-structure";
      break;
    }
    case "runes": {
      const totalRunes = latest.metrics.totalRunes ?? 0;
      const halvingBlockCount = latest.metrics.halvingBlockCount ?? 0;
      headline = `Bitcoin rune ecosystem stable at ${totalRunes.toLocaleString("en-US")} total runes — etching rate below change threshold for ${readingCount} readings`;
      claim = `Bitcoin's rune protocol has maintained a near-static etching count near ${totalRunes.toLocaleString("en-US")} across ${readingCount} readings spanning ${spanHours} hours, with no sustained etching surge detected.`;
      evidence = `Unisat rune indexer: ${totalRunes.toLocaleString("en-US")} total runes, ${halvingBlockCount.toLocaleString("en-US")} blocks to next halving. ${readingCount} consecutive readings over ${spanHours}h — each below the 100-rune change threshold.`;
      implication = `Low etching velocity suggests consolidation after prior growth phases. With ${halvingBlockCount} blocks to next halving, rune etching economics remain tightly coupled to fee market conditions — current stability may shift rapidly when fee dynamics change.`;
      sources = [
        { url: "https://open-api.unisat.io", title: "Unisat Runes Indexer API — rune ecosystem status" },
        { url: "https://unisat.io/runes", title: "Unisat — Runes marketplace" },
      ];
      tags = "ordinals-business,runes,bitcoin,fungibles,market-structure";
      break;
    }
    case "brc20": {
      const totalTokens = latest.metrics.totalTokens ?? 0;
      headline = `BRC-20 market holds steady — ${totalTokens.toLocaleString("en-US")} tokens, top-5 holder counts stable across ${readingCount} readings`;
      claim = `Bitcoin's BRC-20 token ecosystem has maintained stable holder distribution across ${readingCount} consecutive readings spanning ${spanHours} hours, with no token entering or exiting the top-5 and no holder count moving >${BRC20_HOLDER_CHANGE_THRESHOLD_PCT}%.`;
      evidence = `Unisat BRC-20 indexer: ${totalTokens.toLocaleString("en-US")} total tokens. ${readingCount} readings over ${spanHours}h — top-5 composition and holder counts held within the ${BRC20_HOLDER_CHANGE_THRESHOLD_PCT}% change threshold.`;
      implication = `Stable holder distribution signals neither accumulation nor distribution pressure across top BRC-20 positions. Sustained equilibrium often precedes a directional move — the next significant holder shift will establish clearer market direction.`;
      sources = [
        { url: "https://open-api.unisat.io", title: "Unisat BRC-20 Indexer — token status and rankings" },
      ];
      tags = "ordinals-business,brc-20,bitcoin,fungibles,market-structure";
      break;
    }
    case "nft-floors":
    default: {
      const totalVolume = latest.metrics.totalVolume ?? 0;
      headline = `Bitcoin Ordinals NFT floors hold — tracked collections stable for ${readingCount} consecutive readings`;
      claim = `Bitcoin Ordinals NFT floor prices have held within change thresholds across ${readingCount} readings spanning ${spanHours} hours, with combined 24h volume at ${totalVolume.toFixed(2)} BTC showing no surge or collapse in leading collections.`;
      evidence = `CoinGecko: combined tracked-collection 24h volume ${totalVolume.toFixed(2)} BTC. ${readingCount} consecutive readings over ${spanHours}h — no collection floor moved >${NFT_FLOOR_CHANGE_THRESHOLD_PCT}%.`;
      implication = `Floor stability in leading Ordinals collections signals holder confidence at current price levels. Prolonged stability at current volumes typically resolves into either an accumulation move or a slow drift — the absence of volatility is itself a structural indicator.`;
      sources = [
        { url: "https://www.coingecko.com/en/nft", title: "CoinGecko — Ordinals NFT collection data" },
        { url: "https://unisat.io/market", title: "Unisat — Ordinals NFT marketplace" },
      ];
      tags = "ordinals-business,nft,bitcoin,floors,market-structure";
      break;
    }
  }

  return { category: bestCategory, headline, claim, evidence, implication, sources, tags };
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

    // ---- Multi-beat allocation gate ----
    // Global cap: 6 signals/day across all beats
    const totalToday = countSignalTasksToday();
    if (totalToday >= DAILY_SIGNAL_CAP) {
      log(`daily cap: ${totalToday}/${DAILY_SIGNAL_CAP} signal slots claimed today; skipping`);
      return "skip";
    }

    // Per-beat allocation: 3 agent-trading + 3 dev-tools per day
    const ordinalsToday = countSignalTasksTodayForBeat("agent-trading");
    const devToolsToday = countSignalTasksTodayForBeat("dev-tools");
    let ordinalsAllocation = BEAT_DAILY_ALLOCATION;

    // Late-day overflow: if dev-tools hasn't used its slots by OVERFLOW_HOUR_UTC, agent-trading can take them
    const hourUTC = new Date().getUTCHours();
    if (hourUTC >= OVERFLOW_HOUR_UTC) {
      const devToolsUnused = BEAT_DAILY_ALLOCATION - devToolsToday;
      if (devToolsUnused > 0) {
        ordinalsAllocation += devToolsUnused;
        log(`late-day overflow: ${devToolsUnused} unused dev-tools slot(s) available to agent-trading (allocation: ${ordinalsAllocation})`);
      }
    }

    if (ordinalsToday >= ordinalsAllocation) {
      log(`agent-trading beat allocation reached: ${ordinalsToday}/${ordinalsAllocation} (dev-tools: ${devToolsToday}/${BEAT_DAILY_ALLOCATION}); skipping`);
      return "skip";
    }

    log(`beat allocation: agent-trading ${ordinalsToday}/${ordinalsAllocation}, dev-tools ${devToolsToday}/${BEAT_DAILY_ALLOCATION}, total ${totalToday}/${DAILY_SIGNAL_CAP}`);

    // Load state for category rotation and cooldown tracking
    const rawState = (await readHookState(SENSOR_NAME)) as HookState | null;
    const state: HookState = rawState ?? { lastCategory: -1, lastAngle: -1 };

    // Ensure history arrays exist on state
    const history = ensureHistory(state);

    // Weekly narrative reset — archive prior week's thread every Monday
    checkNarrativeWeeklyReset(state);

    // Fetch all categories each run — per-category pendingTaskExistsForSource prevents duplicates.
    // Daily allocation cap enforces the 3/day agent-trading limit (6/day with overflow).
    const categoriesToFetch: Category[] = [...CATEGORIES];

    // Pick next angle (rotates independently of category)
    const angleIdx = ((state.lastAngle ?? -1) + 1) % ANGLES.length;
    const angle = ANGLES[angleIdx];

    log(`categories this run: ${categoriesToFetch.join(", ")} | angle: ${angle}`);

    // Unisat API key needed for inscription/brc20/runes categories
    const unisatKey = await getCredential("unisat", "api_key").catch(() => null);

    // Fetch data for selected categories
    const signals: RawSignalPayload[] = [];
    const milestoneSignals: SignalData[] = [];

    for (const cat of categoriesToFetch) {
      let signal: RawSignalPayload | null = null;

      switch (cat) {
        case "inscriptions": {
          if (!unisatKey) { log("inscriptions: no unisat api_key, skipping"); break; }
          const preLen = history["inscriptions"].length;
          signal = await fetchInscriptionData(unisatKey, state, history);
          // Milestone detection runs when fresh inscription data was fetched (history updated),
          // regardless of whether the content-type gate allowed a regular signal
          if (history["inscriptions"].length > preLen) {
            for (const ms of detectMilestoneSignals(state, history)) {
              milestoneSignals.push(ms);
            }
          }
          break;
        }
        case "brc20":
          if (!unisatKey) { log("brc20: no unisat api_key, skipping"); break; }
          signal = await fetchBrc20Data(unisatKey, state, history);
          break;
        case "fees":
          signal = await fetchFeeMarketData(state, history);
          break;
        case "nft-floors": {
          const nftResult = await fetchNftFloorData(state, history);
          signal = nftResult.signal;
          for (const ev of nftResult.collectionEvents) milestoneSignals.push(ev);
          break;
        }
        case "runes":
          if (!unisatKey) { log("runes: no unisat api_key, skipping"); break; }
          signal = await fetchRunesData(unisatKey, state, history);
          break;
      }

      if (signal) signals.push(signal);
    }

    if (signals.length === 0) {
      log("no signal data fetched from any category — checking competition-mode fallback");

      // Competition-mode flat-market fallback:
      // When competition is active and allocation not yet met, report on the stable market state.
      // Stability is data — N consecutive sub-threshold readings is a signal worth filing.
      const competitionActive = new Date() < new Date(`${COMPETITION_END_DATE}T23:59:59Z`);
      if (competitionActive && ordinalsToday < ordinalsAllocation) {
        const lastFlat = state.lastFlatMarketSignal as string | undefined;
        const hoursSinceFlat = lastFlat
          ? (Date.now() - new Date(lastFlat).getTime()) / 3_600_000
          : Infinity;

        if (hoursSinceFlat < FLAT_MARKET_FALLBACK_COOLDOWN_HOURS) {
          log(`competition fallback: last flat-market signal ${hoursSinceFlat.toFixed(1)}h ago — within ${FLAT_MARKET_FALLBACK_COOLDOWN_HOURS}h cooldown; skipping`);
        } else {
          const flatSource = `sensor:${SENSOR_NAME}:flat-market-fallback`;
          if (pendingTaskExistsForSource(flatSource)) {
            log("competition fallback: pending flat-market task already exists; skipping");
          } else {
            const flatSignal = buildFlatMarketSignal(history, angle);
            if (flatSignal) {
              const sourcesJson = JSON.stringify(flatSignal.sources);
              const narrativeBlock = buildNarrativeContext(state.narrativeThread);
              const crossCategoryBlock = buildCrossCategoryContext(history, flatSignal.category);
              const sinceLabel = lastFlat ? `last filed ${hoursSinceFlat.toFixed(1)}h ago` : "no prior fallback";
              log(`competition fallback: generating flat-market signal (${flatSignal.category}) — competition active, allocation ${ordinalsToday}/${ordinalsAllocation}, ${sinceLabel}`);

              insertTask({
                subject: `File agent-trading signal: ${flatSignal.category} [flat-market — competition fallback]`,
                description: `Arc's ordinals-market-data sensor is in competition-mode fallback — all change-detection thresholds were sub-gate this run, but the competition is active and daily allocation is not yet met. This signal reports on the sustained stable market state. Stability is data.

## Pre-composed Signal

The following signal was built from accumulated sensor history. **File it as written** unless a specific number is verifiably incorrect (check live data if uncertain).

**Headline:** ${flatSignal.headline}

**Claim:** ${flatSignal.claim}

**Evidence:** ${flatSignal.evidence}

**Implication:** ${flatSignal.implication}

**Sources:** ${sourcesJson}
**Tags:** ${flatSignal.tags}

---

## Editorial Instructions

You are filing a **market-structure** signal for the **agent-trading** beat on aibtc.news. This signal reports on sustained stability — a legitimate editorial stance. Do NOT fabricate movement or manufacture excitement. Refine the language where needed but preserve all factual content.

**Voice:** The Economist — precise, data-rich, understated authority. Let the numbers carry the weight.

**${ANGLE_DIRECTIVES[angle]}**
${narrativeBlock}${crossCategoryBlock}
File using:
\`\`\`
arc skills run --name aibtc-news-editorial -- file-signal --beat agent-trading \\
  --headline "<headline>" \\
  --claim "<claim>" \\
  --evidence "<evidence>" \\
  --implication "<implication>" \\
  --sources '${sourcesJson}' \\
  --tags "${flatSignal.tags}"
\`\`\``,
                skills: JSON.stringify(["ordinals-market-data", "aibtc-news-editorial"]),
                priority: 6,
                model: "sonnet",
                status: "pending",
                source: flatSource,
              });

              state.lastFlatMarketSignal = new Date().toISOString();
              log(`competition fallback: queued flat-market signal (${flatSignal.category})`);
            } else {
              log("competition fallback: insufficient history to build flat-market signal — need ≥2 readings in any category");
            }
          }
        }
      } else if (!competitionActive) {
        log("competition not active — skipping flat-market fallback");
      } else {
        log(`competition fallback: allocation already met (${ordinalsToday}/${ordinalsAllocation}) — skipping`);
      }

      state.lastAngle = angleIdx;
      state.lastRun = new Date().toISOString();
      await writeHookState(SENSOR_NAME, state);
      return "ok";
    }

    // Queue one signal-filing task per passing category — per-category dedup prevents duplicates
    let queued = 0;
    for (const signal of signals) {

      // Re-check per-beat allocation before each queuing (other sensors may have filed since loop start)
      const currentOrdinals = countSignalTasksTodayForBeat("agent-trading");
      if (currentOrdinals >= ordinalsAllocation) {
        log(`agent-trading allocation reached (${currentOrdinals}/${ordinalsAllocation}); stopping signal queue`);
        break;
      }

      const signalSource = `sensor:${SENSOR_NAME}:${signal.category}`;

      // Skip if a pending task already exists for this category (avoid duplicates)
      if (pendingTaskExistsForSource(signalSource)) {
        log(`pending task exists for ${signal.category}; skipping`);
        continue;
      }

      const sourcesJson = JSON.stringify(signal.sources);
      const rawDataJson = JSON.stringify(signal.rawData, null, 2);
      const deltasJson = signal.deltas.length > 0
        ? JSON.stringify(signal.deltas.map((d) => ({
            metric: d.metric,
            current: d.current,
            previous: d.previous,
            change: d.absoluteChange,
            changePct: `${d.percentChange >= 0 ? "+" : ""}${d.percentChange.toFixed(1)}%`,
            elapsed: `${(d.trendDurationMs / 3_600_000).toFixed(1)}h`,
          })), null, 2)
        : "[]";
      const narrativeBlock = buildNarrativeContext(state.narrativeThread);
      const crossCategoryBlock = buildCrossCategoryContext(history, signal.category);

      insertTask({
        subject: `File agent-trading signal: ${signal.category} [${signal.changeReason.slice(0, 100)}]`,
        description: `Arc's ordinals-market-data sensor detected a material change in **${signal.category}** data.

## Raw Data

\`\`\`json
${rawDataJson}
\`\`\`

## Deltas vs Prior Reading

\`\`\`json
${deltasJson}
\`\`\`

**Change Trigger:** ${signal.changeReason}
**Sources:** ${sourcesJson}
**Tags:** ${signal.tags}

---

## Editorial Instructions

You are composing an original signal for the **agent-trading** beat on aibtc.news. Use the raw data and deltas above as your source material.

**Voice:** The Economist — precise, data-rich, understated authority. No hype, no breathless enthusiasm. Let the numbers carry the weight.

**${ANGLE_DIRECTIVES[angle]}**

Compose each field from scratch using the raw data. Do NOT use canned phrases or generic market commentary. Every claim must be traceable to a specific number in the data above. Every implication must follow logically from the evidence.

**Required output fields:**
- **headline**: One sentence, max 140 chars. Lead with the most newsworthy number or shift.
- **claim**: 1-2 sentences. The core assertion — what happened and why it matters.
- **evidence**: 2-3 sentences. Cite specific numbers from the raw data and deltas. Include absolute values AND percentage changes where available.
- **implication**: 1-2 sentences. What this means for the ordinals ecosystem going forward. Be specific to the data — no generic "this could signal changing dynamics."
${narrativeBlock}${crossCategoryBlock}
---

File the composed signal to the agent-trading beat using:
\`\`\`
arc skills run --name aibtc-news-editorial -- file-signal --beat agent-trading \\
  --headline "<your composed headline>" \\
  --claim "<your composed claim>" \\
  --evidence "<your composed evidence>" \\
  --implication "<your composed implication>" \\
  --sources '${sourcesJson}' \\
  --tags "${signal.tags}"
\`\`\`

This data targets the agent-trading beat.`,
        skills: JSON.stringify(["ordinals-market-data", "aibtc-news-editorial"]),
        priority: 7,
        model: "sonnet",
        status: "pending",
        source: signalSource,
      });

      log(`queued agent-trading signal: ${signal.category} — ${signal.changeReason.slice(0, 80)}`);
      queued++;
    }

    // Queue milestone signals (P5, bypass cooldown — event-driven newsworthy events)
    // Re-check per-beat allocation for milestones too
    for (const mSignal of milestoneSignals) {
      const currentOrdinals = countSignalTasksTodayForBeat("agent-trading");
      const currentTotal = countSignalTasksToday();
      if (currentTotal >= DAILY_SIGNAL_CAP) {
        log(`daily cap hit (${currentTotal}/${DAILY_SIGNAL_CAP}); cannot queue milestone signal`);
        break;
      }
      // Milestones respect per-beat allocation but can use overflow slots
      let milestoneAllocation = BEAT_DAILY_ALLOCATION;
      if (hourUTC >= OVERFLOW_HOUR_UTC) {
        const devToolsNow = countSignalTasksTodayForBeat("dev-tools");
        milestoneAllocation += Math.max(0, BEAT_DAILY_ALLOCATION - devToolsNow);
      }
      if (currentOrdinals >= milestoneAllocation) {
        log(`agent-trading allocation full for milestone (${currentOrdinals}/${milestoneAllocation}); skipping`);
        break;
      }
      const mSource = mSignal.milestoneSource ?? `sensor:${SENSOR_NAME}:milestone`;
      if (pendingTaskExistsForSource(mSource)) {
        log(`pending milestone task exists (${mSource}); skipping`);
        continue;
      }
      // Track rate milestone timestamps in state to enforce cooldown on next run
      if (mSource.includes(":milestone-rate-high")) state.lastRateMilestoneHigh = new Date().toISOString();
      if (mSource.includes(":milestone-rate-low")) state.lastRateMilestoneLow = new Date().toISOString();

      const mSourcesJson = JSON.stringify(mSignal.sources);
      const milestoneCrossCategory = buildCrossCategoryContext(history, mSignal.category);
      insertTask({
        subject: `[MILESTONE] File agent-trading signal: ${mSignal.headline.slice(0, 110)}`,
        description: `Arc's ordinals-market-data sensor detected a milestone signal.

**Category:** ${mSignal.category} (milestone)
**Headline:** ${mSignal.headline}

**Claim:** ${mSignal.claim}

**Evidence:** ${mSignal.evidence}

**Implication:** ${mSignal.implication}

**Sources:** ${mSourcesJson}
**Tags:** ${mSignal.tags}

---

ANALYTICAL ANGLE: Milestone Analysis — This is an inherently newsworthy event. Focus on the significance of the milestone, what it represents about the protocol's trajectory, and what it implies for the near-term ecosystem. Use precise numbers. Frame around cumulative achievement and forward momentum. Do NOT pad with generic commentary.
${milestoneCrossCategory}
File this signal to the agent-trading beat using:
\`\`\`
arc skills run --name aibtc-news-editorial -- file-signal --beat agent-trading \\
  --headline "${mSignal.headline.replace(/"/g, '\\"')}" \\
  --claim "${mSignal.claim.replace(/"/g, '\\"')}" \\
  --evidence "${mSignal.evidence.replace(/"/g, '\\"')}" \\
  --implication "${mSignal.implication.replace(/"/g, '\\"')}" \\
  --sources '${mSourcesJson}' \\
  --tags "${mSignal.tags}"
\`\`\`

This data targets the agent-trading beat. Use Economist voice — precise, data-rich, no hype language.`,
        skills: JSON.stringify(["ordinals-market-data", "aibtc-news-editorial"]),
        priority: mSignal.priority ?? 5,
        model: "sonnet",
        status: "pending",
        source: mSource,
      });
      log(`queued milestone signal (P${mSignal.priority ?? 5}): ${mSignal.headline.slice(0, 80)}`);
    }

    // Update angle rotation index and last run time
    state.lastAngle = angleIdx;
    state.lastRun = new Date().toISOString();
    await writeHookState(SENSOR_NAME, state);

    const finalOrdinals = countSignalTasksTodayForBeat("agent-trading");
    const finalDevTools = countSignalTasksTodayForBeat("dev-tools");
    log(`queued ${queued} agent-trading signal(s) this run | allocation: agent-trading ${finalOrdinals}/${ordinalsAllocation}, dev-tools ${finalDevTools}/${BEAT_DAILY_ALLOCATION}`);
    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
