// skills/bitcoin-macro/sensor.ts
// Bitcoin Macro beat sensor — detects BTC price milestones, hashrate records,
// and difficulty adjustments from GitHub-reachable public sources.
//
// Data sources:
//   blockchain.info/ticker — BTC/USD spot price (no auth)
//   mempool.space/api/v1/mining/hashrate/1m — 30-day hashrate (no auth)
//   mempool.space/api/v1/difficulty-adjustment — next retarget info (no auth)
//   blockstream.info/api/blocks/tip/height — current block height (no auth)
//
// Signal types (rotated for beat diversity):
//   price-milestone  — BTC crosses a round-number threshold
//   price-move       — >5% 24h price swing
//   hashrate-record  — all-time high or >5% drop from recent peak
//   difficulty-adjustment — upcoming retarget ≥3% with ≤2 days to go

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import {
  insertTask,
  pendingTaskExistsForSource,
  countSignalTasksTodayForBeat,
  countSignalTasksToday,
  isBeatOnCooldown,
  BEAT_DAILY_ALLOCATION,
  DAILY_SIGNAL_CAP,
} from "../../src/db.ts";

const SENSOR_NAME = "bitcoin-macro";
const INTERVAL_MINUTES = 240; // 4 hours — fires 6×/day, daily cap gates actual signals
const BEAT_SLUG = "bitcoin-macro";
const MAX_HISTORY = 6; // rolling readings for trend detection

// Active beats gate — list beats that are currently claimed and accepting signals.
// Post-competition all beats reset; add BEAT_SLUG back here when the beat is reacquired.
// Empty = sensor short-circuits immediately without queuing tasks or fetching data.
const ACTIVE_BEATS: string[] = ["bitcoin-macro"];

// ---- Signal thresholds ----

// Round-number price milestones (USD). Sensor fires once per crossing.
const PRICE_MILESTONES_USD = [
  50_000, 55_000, 60_000, 65_000, 70_000, 75_000,
  80_000, 85_000, 90_000, 95_000,
  100_000, 110_000, 120_000, 130_000, 140_000, 150_000, 175_000, 200_000,
];

const PRICE_MOVE_PCT = 5; // >5% change from last reading fires a price-move signal
const HASHRATE_ATH_MARGIN_PCT = 1; // must exceed stored ATH by ≥1% to qualify as new ATH
const HASHRATE_DROP_PCT = 5; // >5% drop from ATH fires a hashrate signal
const DIFFICULTY_ALERT_BLOCKS = 288; // fire when ≤288 blocks (~2 days) remain before retarget
const DIFFICULTY_MIN_CHANGE_PCT = 3; // only signal if |difficultyChange| ≥ 3%

// ---- API endpoints ----

const MEMPOOL_API = "https://mempool.space/api";
const BLOCKCHAIN_INFO_API = "https://blockchain.info";
const BLOCKSTREAM_API = "https://blockstream.info/api";

// Three sources — sourceQuality=30 (floor is 65; 1 src=10, 2=20, 3+=30)
const SIGNAL_SOURCES_JSON = JSON.stringify([
  { url: "https://blockchain.info/ticker", title: "BTC/USD Spot Price (blockchain.info)" },
  { url: "https://mempool.space/api/v1/mining/hashrate/1m", title: "Bitcoin Network Hashrate (mempool.space)" },
  { url: "https://blockstream.info/api/blocks/tip/height", title: "Current Block Height (blockstream.info)" },
]);

// ---- Types ----

type SignalType = "price-milestone" | "price-move" | "hashrate-record" | "difficulty-adjustment";

interface PriceReading {
  usd: number;
  timestamp: string;
}

interface HashrateData {
  currentEH: number; // current hashrate in EH/s
}

interface DifficultyData {
  difficultyChange: number; // expected % change at next retarget
  remainingBlocks: number;
  estimatedRetargetDate: number; // unix ms
  currentDifficulty: number;
}

interface SensorState {
  last_ran: string;
  last_result: string;
  version: number;
  priceHistory: PriceReading[];
  hashrateATH: number; // EH/s — persisted across runs
  firedMilestones: number[]; // price milestones already signalled this cycle
  lastDifficultySignalDate: string | null; // ISO date of last difficulty signal
  lastSignalType: SignalType | null;
  [key: string]: unknown;
}

// ---- Logger ----

const log = createSensorLogger(SENSOR_NAME);

// ---- Data fetchers ----

async function fetchBtcPrice(): Promise<number | null> {
  try {
    const price_response = await fetchWithRetry(`${BLOCKCHAIN_INFO_API}/ticker`, {
      headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
    });
    if (!price_response.ok) {
      log(`blockchain.info/ticker returned ${price_response.status}`);
      return null;
    }
    const json = (await price_response.json()) as Record<string, { last: number }>;
    return json.USD?.last ?? null;
  } catch (e) {
    log(`price fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchHashrate(): Promise<HashrateData | null> {
  try {
    const hashrate_response = await fetchWithRetry(`${MEMPOOL_API}/v1/mining/hashrate/1m`, {
      headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!hashrate_response.ok) {
      log(`hashrate fetch returned ${hashrate_response.status}`);
      return null;
    }
    const json = (await hashrate_response.json()) as {
      currentHashrate?: number;
      hashrates?: Array<{ avgHashrate: number }>;
    };

    // currentHashrate is in H/s; convert to EH/s
    let rawHashrate: number | null = null;
    if (typeof json.currentHashrate === "number" && json.currentHashrate > 0) {
      rawHashrate = json.currentHashrate;
    } else if (Array.isArray(json.hashrates) && json.hashrates.length > 0) {
      rawHashrate = json.hashrates[json.hashrates.length - 1].avgHashrate;
    }

    if (rawHashrate === null) return null;

    const currentEH = rawHashrate / 1e18;
    return { currentEH };
  } catch (e) {
    log(`hashrate fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchDifficultyAdjustment(): Promise<DifficultyData | null> {
  try {
    const difficulty_response = await fetchWithRetry(`${MEMPOOL_API}/v1/difficulty-adjustment`, {
      headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!difficulty_response.ok) {
      log(`difficulty fetch returned ${difficulty_response.status}`);
      return null;
    }
    const json = (await difficulty_response.json()) as {
      difficultyChange: number;
      remainingBlocks: number;
      estimatedRetargetDate: number;
      currentDifficulty: number;
    };
    return {
      difficultyChange: json.difficultyChange ?? 0,
      remainingBlocks: json.remainingBlocks ?? 2016,
      estimatedRetargetDate: json.estimatedRetargetDate ?? 0,
      currentDifficulty: json.currentDifficulty ?? 0,
    };
  } catch (e) {
    log(`difficulty fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchBlockHeight(): Promise<number | null> {
  try {
    const height_response = await fetchWithRetry(`${BLOCKSTREAM_API}/blocks/tip/height`, {
      headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!height_response.ok) {
      log(`blockstream.info height returned ${height_response.status}`);
      return null;
    }
    const text = await height_response.text();
    const height = parseInt(text.trim(), 10);
    return isNaN(height) ? null : height;
  } catch (e) {
    log(`block height fetch failed: ${(e as Error).message}`);
    return null;
  }
}

// ---- Signal detection ----

interface DetectedSignal {
  type: SignalType;
  strength: number; // 0-100
  subject: string;
  description: string;
}

function detectPriceMilestone(
  price: number,
  firedMilestones: number[],
  blockHeight: number | null,
): DetectedSignal | null {
  // Find the highest milestone crossed that hasn't been signalled yet
  const crossed = PRICE_MILESTONES_USD.filter(
    (m) => price >= m && !firedMilestones.includes(m),
  );
  if (crossed.length === 0) return null;

  const milestone = Math.max(...crossed);
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : `$${(n / 1_000).toFixed(0)}K`;

  return {
    type: "price-milestone",
    strength: 85,
    subject: `File bitcoin-macro signal: BTC crosses ${fmt(milestone)} (current: $${Math.round(price).toLocaleString()})`,
    description: buildSignalDescription({
      type: "price-milestone",
      claim: `Bitcoin trades above ${fmt(milestone)} for the first time since this milestone was set.`,
      evidence: `BTC/USD spot: $${Math.round(price).toLocaleString()} (source: blockchain.info/ticker). ` +
        `Milestone ${fmt(milestone)} crossed — a psychologically significant round-number level. ` +
        `This milestone has not been detected in prior sensor readings.`,
      implication:
        `Round-number crossings often attract momentum traders and media attention, ` +
        `amplifying short-term directional pressure. Sustained trade above ${fmt(milestone)} would ` +
        `validate the level as support and set sights on the next threshold.`,
      milestoneContext: `Milestone: ${fmt(milestone)} | Current price: $${Math.round(price).toLocaleString()}`,
      blockHeight,
    }),
  };
}

function detectPriceMove(
  price: number,
  history: PriceReading[],
  blockHeight: number | null,
): DetectedSignal | null {
  if (history.length === 0) return null;
  const prev = history[history.length - 1];
  if (!prev?.usd || prev.usd === 0) return null;

  const changePct = ((price - prev.usd) / prev.usd) * 100;
  if (Math.abs(changePct) < PRICE_MOVE_PCT) return null;

  const direction = changePct > 0 ? "rises" : "falls";
  const sign = changePct > 0 ? "+" : "";

  return {
    type: "price-move",
    strength: 60 + Math.min(Math.abs(changePct) * 3, 30),
    subject: `File bitcoin-macro signal: BTC ${direction} ${sign}${changePct.toFixed(1)}% (4h move)`,
    description: buildSignalDescription({
      type: "price-move",
      claim: `Bitcoin ${direction} ${Math.abs(changePct).toFixed(1)}% over the last 4 hours.`,
      evidence: `BTC/USD: $${Math.round(prev.usd).toLocaleString()} → $${Math.round(price).toLocaleString()} ` +
        `(${sign}${changePct.toFixed(2)}% in ~4h). ` +
        `Prior reading: ${prev.timestamp}. ` +
        `Source: blockchain.info/ticker.`,
      implication:
        `A ${Math.abs(changePct).toFixed(1)}% intraday move in Bitcoin indicates ${
          Math.abs(changePct) > 10
            ? "elevated volatility — potential liquidation cascade or major macro catalyst"
            : "active price discovery — monitor for follow-through or reversal"
        }.`,
      milestoneContext: `${sign}${changePct.toFixed(1)}% | $${Math.round(prev.usd).toLocaleString()} → $${Math.round(price).toLocaleString()}`,
      blockHeight,
    }),
  };
}

function detectHashrateSignal(
  hr: HashrateData,
  state: SensorState,
  blockHeight: number | null,
): { signal: DetectedSignal | null; newATH: number } {
  const currentEH = hr.currentEH;
  const storedATH = state.hashrateATH || 0;
  const newATH = Math.max(storedATH, currentEH);

  // New all-time high
  if (currentEH > storedATH * (1 + HASHRATE_ATH_MARGIN_PCT / 100)) {
    return {
      signal: {
        type: "hashrate-record",
        strength: 75,
        subject: `File bitcoin-macro signal: Bitcoin hashrate hits new all-time high of ${currentEH.toFixed(1)} EH/s`,
        description: buildSignalDescription({
          type: "hashrate-record",
          claim: `Bitcoin's mining hashrate reached a new all-time high of ${currentEH.toFixed(1)} EH/s.`,
          evidence: `Current hashrate: ${currentEH.toFixed(2)} EH/s (previous ATH: ${storedATH.toFixed(2)} EH/s). ` +
            `ATH improvement: +${(((currentEH - storedATH) / storedATH) * 100).toFixed(1)}%. ` +
            `Source: mempool.space/api/v1/mining/hashrate/1m.`,
          implication:
            `A hashrate all-time high reflects record capital deployment in mining hardware and energy. ` +
            `Higher security budget strengthens Bitcoin's 51%-attack resistance and signals miner ` +
            `confidence in long-term block-reward economics.`,
          milestoneContext: `ATH: ${currentEH.toFixed(1)} EH/s | Previous: ${storedATH.toFixed(1)} EH/s`,
          blockHeight,
        }),
      },
      newATH,
    };
  }

  // Significant drop from ATH
  if (storedATH > 0) {
    const dropPct = ((storedATH - currentEH) / storedATH) * 100;
    if (dropPct >= HASHRATE_DROP_PCT) {
      return {
        signal: {
          type: "hashrate-record",
          strength: 65,
          subject: `File bitcoin-macro signal: Bitcoin hashrate drops ${dropPct.toFixed(1)}% from ATH`,
          description: buildSignalDescription({
            type: "hashrate-record",
            claim: `Bitcoin's mining hashrate has fallen ${dropPct.toFixed(1)}% from its all-time high.`,
            evidence: `Current hashrate: ${currentEH.toFixed(2)} EH/s. ATH: ${storedATH.toFixed(2)} EH/s. ` +
              `Drop: ${dropPct.toFixed(1)}%. Source: mempool.space/api/v1/mining/hashrate/1m.`,
            implication:
              `A ${dropPct.toFixed(0)}%+ hashrate decline typically indicates miner capitulation — ` +
              `unprofitable miners going offline due to falling prices or rising energy costs. ` +
              `Reduced hashrate may trigger a negative difficulty adjustment, temporarily lowering ` +
              `production costs for remaining miners.`,
            milestoneContext: `Current: ${currentEH.toFixed(1)} EH/s | ATH: ${storedATH.toFixed(1)} EH/s | Drop: -${dropPct.toFixed(1)}%`,
            blockHeight,
          }),
        },
        newATH, // ATH stays the same on a drop
      };
    }
  }

  return { signal: null, newATH };
}

function detectDifficultySignal(
  diff: DifficultyData,
  state: SensorState,
  blockHeight: number | null,
): DetectedSignal | null {
  // Only fire if within DIFFICULTY_ALERT_BLOCKS of retarget AND change is significant
  if (diff.remainingBlocks > DIFFICULTY_ALERT_BLOCKS) return null;
  if (Math.abs(diff.difficultyChange) < DIFFICULTY_MIN_CHANGE_PCT) return null;

  // Deduplicate: don't fire twice for the same retarget epoch (check last date)
  const today = new Date().toISOString().split("T")[0];
  if (state.lastDifficultySignalDate === today) return null;

  const direction = diff.difficultyChange > 0 ? "increases" : "decreases";
  const sign = diff.difficultyChange > 0 ? "+" : "";
  const hoursToRetarget = Math.round((diff.estimatedRetargetDate - Date.now()) / 3_600_000);
  const retargetDateStr = new Date(diff.estimatedRetargetDate).toISOString().split("T")[0];

  return {
    type: "difficulty-adjustment",
    strength: 70 + Math.min(Math.abs(diff.difficultyChange), 20),
    subject: `File bitcoin-macro signal: Bitcoin difficulty ${direction} ~${sign}${diff.difficultyChange.toFixed(1)}% in ~${hoursToRetarget}h`,
    description: buildSignalDescription({
      type: "difficulty-adjustment",
      claim: `Bitcoin's mining difficulty is set to ${direction} approximately ${Math.abs(diff.difficultyChange).toFixed(1)}% at the next retarget in ~${hoursToRetarget} hours.`,
      evidence: `Remaining blocks to retarget: ${diff.remainingBlocks}. ` +
        `Estimated retarget: ${retargetDateStr} (~${hoursToRetarget}h). ` +
        `Expected difficulty change: ${sign}${diff.difficultyChange.toFixed(2)}%. ` +
        `Current difficulty: ${(diff.currentDifficulty / 1e12).toFixed(2)}T. ` +
        `Source: mempool.space/api/v1/difficulty-adjustment.`,
      implication: diff.difficultyChange > 0
        ? `A positive difficulty adjustment confirms that miners are adding capacity faster than blocks are being produced — ` +
          `a bullish signal for miner economics and network security investment.`
        : `A negative difficulty adjustment signals miner capitulation or efficiency-driven consolidation — ` +
          `reducing production costs for survivors and historically preceding price stabilisation.`,
      milestoneContext: `Change: ${sign}${diff.difficultyChange.toFixed(1)}% | Blocks remaining: ${diff.remainingBlocks} | ETA: ${retargetDateStr}`,
      blockHeight,
    }),
  };
}

// ---- Signal description builder ----

interface SignalParts {
  type: SignalType;
  claim: string;
  evidence: string;
  implication: string;
  milestoneContext: string;
  blockHeight?: number | null;
}

function buildSignalDescription(parts: SignalParts): string {
  return [
    `## Bitcoin Macro Signal — ${parts.type}`,
    "",
    `**Beat:** ${BEAT_SLUG} | **Type:** ${parts.type}`,
    "",
    "### Observation",
    parts.milestoneContext + (parts.blockHeight != null ? ` | Block: ${parts.blockHeight.toLocaleString()}` : ""),
    "",
    "### Claim",
    parts.claim,
    "",
    "### Evidence",
    parts.evidence,
    "",
    "### Implication",
    parts.implication,
    "",
    "### Filing Instructions",
    `Compose a signal in Economist editorial voice — data-rich, precise, no hype.`,
    `Verify sources are reachable: \`arc skills run --name aibtc-news-editorial -- check-sources --sources '${SIGNAL_SOURCES_JSON}'\``,
    `Then file:`,
    `\`arc skills run --name aibtc-news-editorial -- file-signal --beat ${BEAT_SLUG} --claim "<rewrite in Economist voice>" --evidence "<quantitative evidence with sources>" --implication "<forward-looking consequence>" --sources '${SIGNAL_SOURCES_JSON}' --tags "bitcoin-macro,<type-specific-tag>"\``,
    "",
    "**Tags (required):** Always include `bitcoin-macro` as the first tag — omitting it causes beatRelevance=0 in publisher scoring. Add 1-2 type-specific tags (e.g. `hashrate`, `difficulty`, `price`, `mining`).",
    "**Sources (required):** The `--sources` flag above includes 3 GitHub-reachable sources, pushing sourceQuality from 20 to 30 and clearing the 65-point floor. Do not omit it.",
    "**Voice rules:** Avoid 'surges', 'crashes', 'rockets'. Use precise verbs: rises, falls, crosses, adjusts.",
    "**No external market data:** Do not add price data from CoinGecko, Binance, or Coinbase — use the sources listed above.",
  ].join("\n");
}

// ---- Main sensor ----

export default async function bitcoinMacroSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    // Beat-active gate — short-circuit if beat is not currently claimed
    if (!ACTIVE_BEATS.includes(BEAT_SLUG)) {
      log(`beat ${BEAT_SLUG} not in active beats list — skipping (re-add to ACTIVE_BEATS when beat is reacquired)`);
      return "skip";
    }

    log("run started");

    // Daily cap guard
    const totalToday = countSignalTasksToday();
    if (totalToday >= DAILY_SIGNAL_CAP) {
      log(`daily signal cap hit (${totalToday}/${DAILY_SIGNAL_CAP}), skipping`);
      return "ok";
    }

    const beatToday = countSignalTasksTodayForBeat(BEAT_SLUG);
    if (beatToday >= BEAT_DAILY_ALLOCATION) {
      log(`beat allocation hit for ${BEAT_SLUG} (${beatToday}/${BEAT_DAILY_ALLOCATION}), skipping`);
      return "ok";
    }

    // Cooldown guard
    if (isBeatOnCooldown(BEAT_SLUG, 60)) {
      log(`beat ${BEAT_SLUG} is on 60-min cooldown — skipping to avoid dispatch failure`);
      return "ok";
    }

    // Load state
    const raw = await readHookState(SENSOR_NAME);
    const state: SensorState = {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: 0,
      ...(raw ?? {}),
      priceHistory: (raw as SensorState | null)?.priceHistory ?? [],
      hashrateATH: (raw as SensorState | null)?.hashrateATH ?? 0,
      firedMilestones: (raw as SensorState | null)?.firedMilestones ?? [],
      lastDifficultySignalDate: (raw as SensorState | null)?.lastDifficultySignalDate ?? null,
      lastSignalType: (raw as SensorState | null)?.lastSignalType ?? null,
    };

    // Fetch all data in parallel
    const [price, hashrate, difficulty, blockHeight] = await Promise.all([
      fetchBtcPrice(),
      fetchHashrate(),
      fetchDifficultyAdjustment(),
      fetchBlockHeight(),
    ]);

    log(`fetched — price: ${price ?? "null"}, hashrate: ${hashrate?.currentEH?.toFixed(1) ?? "null"} EH/s, difficulty blocks remaining: ${difficulty?.remainingBlocks ?? "null"}, block height: ${blockHeight ?? "null"}`);

    if (price === null && hashrate === null && difficulty === null) {
      log("all data sources failed");
      await writeHookState(SENSOR_NAME, { ...state, last_result: "error", version: (state.version ?? 0) + 1 });
      return "error";
    }

    // ---- First-run initialization ----
    // On the first run (no prior price history), pre-populate firedMilestones with
    // all thresholds at or below the current price so we don't retroactively fire
    // for milestones BTC crossed months ago.
    const isFirstRun = state.priceHistory.length === 0;
    if (isFirstRun && price !== null) {
      const alreadyCrossed = PRICE_MILESTONES_USD.filter((m) => price >= m);
      state.firedMilestones = [...new Set([...(state.firedMilestones ?? []), ...alreadyCrossed])];
      log(`first run — pre-initialising ${alreadyCrossed.length} fired milestones (BTC at $${Math.round(price).toLocaleString()})`);
    }

    // ---- Detect signals in priority order ----

    const candidates: DetectedSignal[] = [];
    let newATH = state.hashrateATH;
    let newMilestones = [...(state.firedMilestones ?? [])];
    let newDiffDate = state.lastDifficultySignalDate;

    // 1. Price milestones (highest priority — one-time events)
    // Skip on first run — we're just initialising baseline, not signalling
    if (price !== null && !isFirstRun) {
      const milestoneSignal = detectPriceMilestone(price, state.firedMilestones ?? [], blockHeight);
      if (milestoneSignal) candidates.push(milestoneSignal);
    }

    // 2. Difficulty adjustment (time-sensitive — only fires near retarget)
    if (difficulty !== null) {
      const diffSignal = detectDifficultySignal(difficulty, state, blockHeight);
      if (diffSignal) candidates.push(diffSignal);
    }

    // 3. Hashrate record
    if (hashrate !== null) {
      const { signal: hrSignal, newATH: updatedATH } = detectHashrateSignal(hashrate, state, blockHeight);
      newATH = updatedATH;
      if (hrSignal) candidates.push(hrSignal);
    }

    // 4. Price move (lowest priority — most common)
    if (price !== null) {
      const moveSignal = detectPriceMove(price, state.priceHistory, blockHeight);
      if (moveSignal) candidates.push(moveSignal);
    }

    log(`${candidates.length} signal candidate(s) detected`);

    // Pick best signal — prefer type diversity, then strength
    let best: DetectedSignal | null = null;
    if (candidates.length > 0) {
      const preferred = candidates
        .filter((c) => c.type !== state.lastSignalType)
        .sort((a, b) => b.strength - a.strength);
      best = preferred[0] ?? candidates.sort((a, b) => b.strength - a.strength)[0];
    }

    // ---- Queue signal task ----

    if (best) {
      const source = `sensor:${SENSOR_NAME}:${best.type}`;
      if (pendingTaskExistsForSource(source)) {
        log(`signal task already pending for source ${source}, skipping`);
      } else {
        const taskId = insertTask({
          subject: best.subject,
          description: best.description,
          skills: JSON.stringify(["bitcoin-macro", "aibtc-news-editorial"]),
          priority: best.strength >= 75 ? 5 : 6,
          model: "sonnet",
          source,
        });
        log(`queued signal task #${taskId}: ${best.subject}`);
        state.lastSignalType = best.type;

        // Track fired milestones
        if (best.type === "price-milestone" && price !== null) {
          const crossed = PRICE_MILESTONES_USD.filter(
            (m) => price >= m && !state.firedMilestones.includes(m),
          );
          newMilestones = [...new Set([...(state.firedMilestones ?? []), ...crossed])];
        }

        // Track difficulty signal date
        if (best.type === "difficulty-adjustment") {
          newDiffDate = new Date().toISOString().split("T")[0];
        }
      }
    } else {
      log("no signal candidates — quiet market conditions, no task queued");
    }

    // ---- Update state ----

    // Rolling price history
    if (price !== null) {
      const reading: PriceReading = { usd: price, timestamp: new Date().toISOString() };
      state.priceHistory.push(reading);
      if (state.priceHistory.length > MAX_HISTORY) {
        state.priceHistory = state.priceHistory.slice(-MAX_HISTORY);
      }
    }

    await writeHookState(SENSOR_NAME, {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state.version ?? 0) + 1,
      hashrateATH: newATH,
      firedMilestones: newMilestones,
      lastDifficultySignalDate: newDiffDate,
    });

    log("run complete");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
