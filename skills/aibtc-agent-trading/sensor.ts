// skills/aibtc-agent-trading/sensor.ts
// Detects AIBTC-network agent trading activity from JingSwap cycles and P2P ordinals desk.
// Data sources: JingSwap API (cycle state, prices), ledger.drx4.xyz (P2P trades, stats),
// aibtc.news/api/agents (registry growth). Queues signal-filing tasks for agent-trading beat.

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
  BEAT_DAILY_ALLOCATION,
  DAILY_SIGNAL_CAP,
} from "../../src/db.ts";

const SENSOR_NAME = "aibtc-agent-trading";
const INTERVAL_MINUTES = 120; // every 2 hours
const BEAT_SLUG = "agent-trading";
const MAX_HISTORY = 8; // rolling window for change detection

// ---- API endpoints ----

const JINGSWAP_API = "https://faktory-dao-backend.vercel.app";
const P2P_DESK_API = "https://ledger.drx4.xyz";
const AGENT_REGISTRY_API = "https://aibtc.news/api/agents";

// JingSwap markets to monitor
const JINGSWAP_MARKETS = [
  { key: "sbtc-stx", contract: "sbtc-stx-jing", label: "sBTC/STX" },
  { key: "sbtc-usdcx", contract: "sbtc-usdcx-jing", label: "sBTC/USDCx" },
] as const;

// ---- Change detection thresholds ----

const DEPOSIT_IMBALANCE_PCT = 30; // >30% skew between quote/sBTC deposits
const PRICE_DEVIATION_PCT = 5; // >5% oracle-to-DEX spread
const P2P_VOLUME_SPIKE_MULT = 2; // >2x prior volume reading
const AGENT_GROWTH_THRESHOLD = 5; // >5 new agents since last check

// ---- Types ----

interface JingswapCycleState {
  cycle: number;
  phase: number; // 0=deposit, 1=buffer, 2=settle
  blocksElapsed: number;
  totalQuote: number;
  totalSbtc: number;
}

interface JingswapPrices {
  pyth: Record<string, unknown>;
  dex: Record<string, unknown>;
}

interface MarketSnapshot {
  cycle: number;
  phase: number;
  totalQuote: number;
  totalSbtc: number;
  pythPrice: number;
  dexPrice: number;
}

interface P2PStats {
  total_trades: number;
  total_agents: number;
  open_offers: number;
  completed_trades: number;
  total_volume_sats: number;
  unique_inscriptions: number;
  psbt_swaps: number;
  active_listings: number;
  total_listings: number;
}

interface P2PRecentTrades {
  trades: Array<{
    id: number;
    type: string;
    status: string;
    from_agent: string;
    to_agent: string;
    inscription_id: string;
    amount_sats: number | null;
    source: string;
    created_at: string;
    from_name: string;
    to_name: string;
  }>;
  pagination: { total: number };
}

interface HistoryReading {
  timestamp: string;
  markets: Record<string, MarketSnapshot>;
  p2p: P2PStats;
  agentCount: number;
}

interface SensorState {
  last_ran: string;
  last_result: string;
  version: number;
  history: HistoryReading[];
  lastSignalType: string | null;
  [key: string]: unknown;
}

// ---- Signal types (rotate to ensure diversity) ----

type SignalType =
  | "jingswap-cycle" // cycle transitions, deposit imbalances
  | "jingswap-price" // oracle-DEX spread, settlement prices
  | "p2p-activity" // trades, volumes, PSBT swaps
  | "agent-growth"; // new registrations, marketplace growth

const SIGNAL_TYPES: SignalType[] = [
  "jingswap-cycle",
  "jingswap-price",
  "p2p-activity",
  "agent-growth",
];

// ---- Logger ----

const log = createSensorLogger(SENSOR_NAME);

// ---- Data fetchers ----

async function fetchJingswapCycleState(
  contractParam: string,
): Promise<JingswapCycleState | null> {
  try {
    const qp = contractParam ? `?contract=${contractParam}` : "";
    const res = await fetchWithRetry(
      `${JINGSWAP_API}/api/auction/cycle-state${qp}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    return {
      cycle: Number(data.cycle ?? data.currentCycle ?? 0),
      phase: Number(data.phase ?? 0),
      blocksElapsed: Number(data.blocksElapsed ?? 0),
      totalQuote: Number(data.totalQuote ?? data.quoteTotal ?? 0),
      totalSbtc: Number(data.totalSbtc ?? data.sbtcTotal ?? 0),
    };
  } catch (e) {
    log(`JingSwap cycle-state fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchJingswapPrices(
  contractParam: string,
): Promise<{ pythPrice: number; dexPrice: number } | null> {
  try {
    const qp = contractParam ? `?contract=${contractParam}` : "";
    const [pythRes, dexRes] = await Promise.all([
      fetchWithRetry(`${JINGSWAP_API}/api/auction/pyth-prices${qp}`),
      fetchWithRetry(`${JINGSWAP_API}/api/auction/dex-price${qp}`),
    ]);
    if (!pythRes.ok || !dexRes.ok) return null;
    const pythJson = (await pythRes.json()) as Record<string, unknown>;
    const dexJson = (await dexRes.json()) as Record<string, unknown>;
    const pythData = (pythJson.data ?? pythJson) as Record<string, unknown>;
    const dexData = (dexJson.data ?? dexJson) as Record<string, unknown>;
    return {
      pythPrice: Number(pythData.price ?? pythData.pythPrice ?? 0),
      dexPrice: Number(dexData.price ?? dexData.dexPrice ?? 0),
    };
  } catch (e) {
    log(`JingSwap prices fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchP2PStats(): Promise<P2PStats | null> {
  try {
    const res = await fetchWithRetry(`${P2P_DESK_API}/api/stats`);
    if (!res.ok) return null;
    return (await res.json()) as P2PStats;
  } catch (e) {
    log(`P2P desk stats fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchP2PRecentTrades(): Promise<P2PRecentTrades | null> {
  try {
    const res = await fetchWithRetry(
      `${P2P_DESK_API}/api/trades?limit=10&status=completed`,
    );
    if (!res.ok) return null;
    return (await res.json()) as P2PRecentTrades;
  } catch (e) {
    log(`P2P desk trades fetch failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchAgentCount(): Promise<number | null> {
  try {
    const res = await fetchWithRetry(AGENT_REGISTRY_API);
    if (!res.ok) return null;
    const json = (await res.json()) as { agents: Record<string, unknown> };
    return Object.keys(json.agents).length;
  } catch (e) {
    log(`Agent registry fetch failed: ${(e as Error).message}`);
    return null;
  }
}

// ---- Change detection ----

interface ChangeSignal {
  type: SignalType;
  strength: number; // 0-100, higher = more significant
  headline: string;
  evidence: string;
  implication: string;
}

function detectChanges(
  current: HistoryReading,
  previous: HistoryReading | null,
  recentTrades: P2PRecentTrades | null,
): ChangeSignal[] {
  const signals: ChangeSignal[] = [];

  if (!previous) {
    // First run — always generate a baseline signal
    signals.push({
      type: "jingswap-cycle",
      strength: 50,
      headline: "AIBTC agent-trading baseline: JingSwap + P2P desk initial snapshot",
      evidence: buildBaselineEvidence(current, recentTrades),
      implication:
        "First reading from AIBTC-network-native data sources establishes baseline for change detection across JingSwap blind auctions and P2P ordinals trading.",
    });
    return signals;
  }

  // --- JingSwap cycle transitions ---
  for (const market of JINGSWAP_MARKETS) {
    const curr = current.markets[market.key];
    const prev = previous.markets[market.key];
    if (!curr || !prev) continue;

    // Phase transition
    if (curr.phase !== prev.phase) {
      const phaseNames = ["deposit", "buffer", "settle"];
      signals.push({
        type: "jingswap-cycle",
        strength: 70,
        headline: `JingSwap ${market.label} cycle ${curr.cycle}: ${phaseNames[prev.phase] ?? prev.phase}→${phaseNames[curr.phase] ?? curr.phase} transition`,
        evidence: `Market ${market.label} transitioned from phase ${prev.phase} (${phaseNames[prev.phase]}) to phase ${curr.phase} (${phaseNames[curr.phase]}). ` +
          `Cycle ${curr.cycle}. Quote deposits: ${curr.totalQuote}, sBTC deposits: ${curr.totalSbtc}.`,
        implication:
          `Phase transition in the ${market.label} blind auction reflects active cycle progression — agents are participating in the AIBTC on-chain trading infrastructure.`,
      });
    }

    // Deposit imbalance
    if (curr.phase === 0 && curr.totalQuote > 0 && curr.totalSbtc > 0) {
      const total = curr.totalQuote + curr.totalSbtc;
      const quoteShare = (curr.totalQuote / total) * 100;
      const skew = Math.abs(quoteShare - 50);
      if (skew > DEPOSIT_IMBALANCE_PCT) {
        const side = quoteShare > 50 ? "quote-heavy" : "sBTC-heavy";
        signals.push({
          type: "jingswap-cycle",
          strength: 60 + Math.min(skew, 30),
          headline: `JingSwap ${market.label} deposit imbalance: ${side} (${skew.toFixed(1)}% skew)`,
          evidence: `Cycle ${curr.cycle} deposit phase shows ${side} imbalance. ` +
            `Quote: ${curr.totalQuote}, sBTC: ${curr.totalSbtc}. ` +
            `Skew: ${skew.toFixed(1)}% from equilibrium.`,
          implication:
            `Deposit imbalance in blind auctions indicates directional sentiment among AIBTC agents — ${side} suggests ${quoteShare > 50 ? "demand to acquire sBTC" : "supply pressure from sBTC holders"}.`,
        });
      }
    }

    // Oracle-DEX price spread
    if (curr.pythPrice > 0 && curr.dexPrice > 0) {
      const spread =
        Math.abs(curr.pythPrice - curr.dexPrice) /
        Math.max(curr.pythPrice, curr.dexPrice) *
        100;
      if (spread > PRICE_DEVIATION_PCT) {
        signals.push({
          type: "jingswap-price",
          strength: 55 + Math.min(spread * 2, 30),
          headline: `JingSwap ${market.label} oracle-DEX spread: ${spread.toFixed(1)}%`,
          evidence: `Pyth oracle price: ${curr.pythPrice}, DEX price: ${curr.dexPrice}. ` +
            `Spread: ${spread.toFixed(1)}%. ` +
            `Prior reading spread was ${prev.pythPrice > 0 && prev.dexPrice > 0 ? (Math.abs(prev.pythPrice - prev.dexPrice) / Math.max(prev.pythPrice, prev.dexPrice) * 100).toFixed(1) + "%" : "N/A"}.`,
          implication:
            `Significant oracle-DEX spread in the JingSwap ${market.label} market creates arbitrage opportunity for agents with cross-venue access.`,
        });
      }
    }
  }

  // --- P2P ordinals desk ---
  const currP2P = current.p2p;
  const prevP2P = previous.p2p;

  // New completed trades
  const newCompletedTrades = currP2P.completed_trades - prevP2P.completed_trades;
  if (newCompletedTrades > 0) {
    signals.push({
      type: "p2p-activity",
      strength: 50 + Math.min(newCompletedTrades * 15, 40),
      headline: `P2P ordinals desk: ${newCompletedTrades} new trade${newCompletedTrades > 1 ? "s" : ""} completed`,
      evidence: `Completed trades: ${prevP2P.completed_trades}→${currP2P.completed_trades} (+${newCompletedTrades}). ` +
        `Total volume: ${currP2P.total_volume_sats} sats. PSBT swaps: ${currP2P.psbt_swaps}. ` +
        `Open offers: ${currP2P.open_offers}. Active listings: ${currP2P.active_listings}.` +
        formatRecentTrades(recentTrades),
      implication:
        `Completed P2P ordinals trades represent actual agent-to-agent value transfer within the AIBTC network — direct evidence of network trading activity.`,
    });
  }

  // Volume spike
  if (prevP2P.total_volume_sats > 0) {
    const volumeRatio = currP2P.total_volume_sats / prevP2P.total_volume_sats;
    if (volumeRatio >= P2P_VOLUME_SPIKE_MULT) {
      signals.push({
        type: "p2p-activity",
        strength: 65 + Math.min((volumeRatio - 2) * 10, 25),
        headline: `P2P ordinals desk volume spike: ${volumeRatio.toFixed(1)}x increase`,
        evidence: `Volume: ${prevP2P.total_volume_sats}→${currP2P.total_volume_sats} sats (${volumeRatio.toFixed(1)}x). ` +
          `Trades: ${prevP2P.total_trades}. PSBT swaps: ${currP2P.psbt_swaps}. ` +
          `Unique inscriptions traded: ${currP2P.unique_inscriptions}.`,
        implication:
          `Volume spike on the P2P ordinals desk signals increased agent trading appetite within the AIBTC network.`,
      });
    }
  }

  // New PSBT swaps (atomic on-chain trades — high signal)
  const newPsbtSwaps = currP2P.psbt_swaps - prevP2P.psbt_swaps;
  if (newPsbtSwaps > 0) {
    signals.push({
      type: "p2p-activity",
      strength: 75 + Math.min(newPsbtSwaps * 10, 20),
      headline: `P2P ordinals desk: ${newPsbtSwaps} new PSBT swap${newPsbtSwaps > 1 ? "s" : ""} executed`,
      evidence: `PSBT swaps: ${prevP2P.psbt_swaps}→${currP2P.psbt_swaps} (+${newPsbtSwaps}). ` +
        `These are atomic on-chain ordinals swaps between agents. ` +
        `Total P2P volume: ${currP2P.total_volume_sats} sats.` +
        formatRecentTrades(recentTrades),
      implication:
        `PSBT swaps are the highest-fidelity signal of agent trading — trustless, atomic, on-chain ordinals exchanges between network participants.`,
    });
  }

  // --- Agent growth ---
  const agentDelta = current.agentCount - previous.agentCount;
  if (agentDelta >= AGENT_GROWTH_THRESHOLD) {
    signals.push({
      type: "agent-growth",
      strength: 50 + Math.min(agentDelta * 3, 40),
      headline: `AIBTC agent registry: ${agentDelta} new agent${agentDelta > 1 ? "s" : ""} registered`,
      evidence: `Agent count: ${previous.agentCount}→${current.agentCount} (+${agentDelta}). ` +
        `P2P desk agents: ${currP2P.total_agents}. ` +
        `Active listings: ${currP2P.active_listings}. Open offers: ${currP2P.open_offers}.`,
      implication:
        `Agent registry growth expands the addressable market for P2P ordinals trading and JingSwap participation within the AIBTC network.`,
    });
  }

  // --- Flat-market fallback ---
  // If no changes detected, generate a market-structure signal from current state
  if (signals.length === 0) {
    signals.push({
      type: pickNextSignalType(null),
      strength: 30,
      headline: buildFlatMarketHeadline(current),
      evidence: buildFlatMarketEvidence(current, previous, recentTrades),
      implication:
        "Stable trading conditions across JingSwap and P2P desk indicate steady-state agent participation — no structural shifts detected in the current observation window.",
    });
  }

  return signals;
}

// ---- Helpers ----

function formatRecentTrades(trades: P2PRecentTrades | null): string {
  if (!trades || trades.trades.length === 0) return "";
  const recent = trades.trades.slice(0, 3);
  const lines = recent.map(
    (t) =>
      ` ${t.from_name}→${t.to_name}: ${t.type} (${t.amount_sats ?? 0} sats, ${t.source})`,
  );
  return "\nRecent completed trades:" + lines.join(";");
}

function buildBaselineEvidence(
  current: HistoryReading,
  recentTrades: P2PRecentTrades | null,
): string {
  const parts: string[] = [];
  for (const market of JINGSWAP_MARKETS) {
    const m = current.markets[market.key];
    if (m) {
      const phaseNames = ["deposit", "buffer", "settle"];
      parts.push(
        `JingSwap ${market.label}: cycle ${m.cycle}, phase ${m.phase} (${phaseNames[m.phase] ?? m.phase}), quote=${m.totalQuote}, sbtc=${m.totalSbtc}, pyth=${m.pythPrice}, dex=${m.dexPrice}`,
      );
    }
  }
  parts.push(
    `P2P desk: ${current.p2p.completed_trades} completed trades, ${current.p2p.total_volume_sats} sats volume, ${current.p2p.psbt_swaps} PSBT swaps, ${current.p2p.open_offers} open offers, ${current.p2p.active_listings} active listings`,
  );
  parts.push(`Agent registry: ${current.agentCount} agents`);
  if (recentTrades && recentTrades.trades.length > 0) {
    parts.push(formatRecentTrades(recentTrades).trim());
  }
  return parts.join(". ");
}

function buildFlatMarketHeadline(current: HistoryReading): string {
  const stxMarket = current.markets["sbtc-stx"];
  const phase = stxMarket
    ? ["deposit", "buffer", "settle"][stxMarket.phase] ?? `phase-${stxMarket.phase}`
    : "unknown";
  return `AIBTC agent-trading steady state: JingSwap ${phase} phase, ${current.p2p.completed_trades} P2P trades, ${current.agentCount} agents`;
}

function buildFlatMarketEvidence(
  current: HistoryReading,
  previous: HistoryReading,
  recentTrades: P2PRecentTrades | null,
): string {
  const parts: string[] = [];
  for (const market of JINGSWAP_MARKETS) {
    const curr = current.markets[market.key];
    const prev = previous.markets[market.key];
    if (curr) {
      parts.push(
        `JingSwap ${market.label}: cycle ${curr.cycle} (prev ${prev?.cycle ?? "?"})` +
          `, phase ${curr.phase}, quote=${curr.totalQuote}, sbtc=${curr.totalSbtc}`,
      );
    }
  }
  parts.push(
    `P2P desk: ${current.p2p.completed_trades} completed (prev ${previous.p2p.completed_trades}), ` +
      `volume ${current.p2p.total_volume_sats} sats (prev ${previous.p2p.total_volume_sats}), ` +
      `${current.p2p.psbt_swaps} PSBT swaps, ${current.p2p.open_offers} open offers`,
  );
  parts.push(
    `Agents: ${current.agentCount} (prev ${previous.agentCount})`,
  );
  if (recentTrades) parts.push(formatRecentTrades(recentTrades).trim());
  return parts.join(". ");
}

function pickNextSignalType(lastType: string | null): SignalType {
  if (!lastType) return SIGNAL_TYPES[0];
  const idx = SIGNAL_TYPES.indexOf(lastType as SignalType);
  return SIGNAL_TYPES[(idx + 1) % SIGNAL_TYPES.length];
}

// ---- Main sensor ----

export default async function sensor(): Promise<string | void> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("starting aibtc-agent-trading sensor run");

  // Daily cap check
  const todayTotal = countSignalTasksToday();
  if (todayTotal >= DAILY_SIGNAL_CAP) {
    log(`daily signal cap hit (${todayTotal}/${DAILY_SIGNAL_CAP}), skipping`);
    return;
  }

  const beatToday = countSignalTasksTodayForBeat(BEAT_SLUG);
  if (beatToday >= BEAT_DAILY_ALLOCATION) {
    log(`beat allocation hit for ${BEAT_SLUG} (${beatToday}/${BEAT_DAILY_ALLOCATION}), skipping`);
    return;
  }

  // Fetch all data sources in parallel
  const [
    stxCycle,
    usdcxCycle,
    stxPrices,
    usdcxPrices,
    p2pStats,
    recentTrades,
    agentCount,
  ] = await Promise.all([
    fetchJingswapCycleState(""),
    fetchJingswapCycleState("sbtc-usdcx-jing"),
    fetchJingswapPrices(""),
    fetchJingswapPrices("sbtc-usdcx-jing"),
    fetchP2PStats(),
    fetchP2PRecentTrades(),
    fetchAgentCount(),
  ]);

  // Require at least P2P stats or one JingSwap market
  if (!p2pStats && !stxCycle && !usdcxCycle) {
    log("all data sources failed, aborting");
    return "error";
  }

  // Build current reading
  const now = new Date().toISOString();
  const markets: Record<string, MarketSnapshot> = {};

  if (stxCycle) {
    markets["sbtc-stx"] = {
      cycle: stxCycle.cycle,
      phase: stxCycle.phase,
      totalQuote: stxCycle.totalQuote,
      totalSbtc: stxCycle.totalSbtc,
      pythPrice: stxPrices?.pythPrice ?? 0,
      dexPrice: stxPrices?.dexPrice ?? 0,
    };
  }

  if (usdcxCycle) {
    markets["sbtc-usdcx"] = {
      cycle: usdcxCycle.cycle,
      phase: usdcxCycle.phase,
      totalQuote: usdcxCycle.totalQuote,
      totalSbtc: usdcxCycle.totalSbtc,
      pythPrice: usdcxPrices?.pythPrice ?? 0,
      dexPrice: usdcxPrices?.dexPrice ?? 0,
    };
  }

  const currentReading: HistoryReading = {
    timestamp: now,
    markets,
    p2p: p2pStats ?? {
      total_trades: 0,
      total_agents: 0,
      open_offers: 0,
      completed_trades: 0,
      total_volume_sats: 0,
      unique_inscriptions: 0,
      psbt_swaps: 0,
      active_listings: 0,
      total_listings: 0,
    },
    agentCount: agentCount ?? 0,
  };

  // Load state and detect changes
  const rawState = await readHookState(SENSOR_NAME);
  const state: SensorState = (rawState as SensorState) ?? {
    last_ran: now,
    last_result: "ok",
    version: 0,
    history: [],
    lastSignalType: null,
  };

  const previousReading =
    state.history.length > 0
      ? state.history[state.history.length - 1]
      : null;

  const changes = detectChanges(currentReading, previousReading, recentTrades);

  log(`detected ${changes.length} change signal(s)`);

  // Pick the strongest signal (or rotate through types for diversity)
  let bestSignal: ChangeSignal | null = null;

  if (changes.length > 0) {
    // Prefer a signal type different from lastSignalType for diversity
    const preferred = changes
      .filter((c) => c.type !== state.lastSignalType)
      .sort((a, b) => b.strength - a.strength);
    bestSignal = preferred[0] ?? changes.sort((a, b) => b.strength - a.strength)[0];
  }

  // Queue signal task
  if (bestSignal) {
    const source = `sensor:${SENSOR_NAME}:${bestSignal.type}`;

    // Dedup: skip if pending task with same source exists
    if (!pendingTaskExistsForSource(source)) {
      const taskId = insertTask({
        subject: `File agent-trading signal: ${bestSignal.headline}`,
        description: buildTaskDescription(bestSignal, currentReading, recentTrades),
        skills: JSON.stringify(["aibtc-agent-trading", "aibtc-news-editorial"]),
        priority: bestSignal.strength >= 70 ? 5 : 7,
        model: "sonnet",
        source,
      });

      log(`queued signal task #${taskId}: ${bestSignal.headline}`);
      state.lastSignalType = bestSignal.type;
    } else {
      log(`signal task already pending for source ${source}, skipping`);
    }
  }

  // Update history (rolling window)
  state.history.push(currentReading);
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(-MAX_HISTORY);
  }

  // Persist state
  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: now,
    last_result: "ok",
    version: (state.version ?? 0) + 1,
  });

  log("sensor run complete");
}

function buildTaskDescription(
  signal: ChangeSignal,
  current: HistoryReading,
  recentTrades: P2PRecentTrades | null,
): string {
  const lines: string[] = [
    `## Signal: ${signal.headline}`,
    "",
    `**Type:** ${signal.type} | **Strength:** ${signal.strength}/100 | **Beat:** ${BEAT_SLUG}`,
    "",
    "### Claim",
    signal.headline,
    "",
    "### Evidence",
    signal.evidence,
    "",
    "### Implication",
    signal.implication,
    "",
    "### Cross-Source Context",
    buildBaselineEvidence(current, recentTrades),
    "",
    "### Filing Instructions",
    `Run: \`arc skills run --name aibtc-news-editorial -- file-signal --beat ${BEAT_SLUG} --claim "<rewrite claim in Economist voice>" --evidence "<data-rich evidence>" --implication "<forward-looking implication>"\``,
    "",
    "**Important:** Rewrite the claim/evidence/implication in Economist editorial voice — precise, data-rich, no hype.",
    "Sources: JingSwap API (faktory-dao-backend.vercel.app), P2P ordinals desk (ledger.drx4.xyz), AIBTC agent registry (aibtc.news/api/agents).",
    `Tags: agent-trading, ${signal.type}`,
  ];

  return lines.join("\n");
}
