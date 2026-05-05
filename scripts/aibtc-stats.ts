#!/usr/bin/env bun
// Reusable AIBTC weekly stats aggregator.
// Outputs JSON to src/web/data/network-stats.json (configurable) for consumption by presentation deck.
//
// Usage:
//   bun scripts/aibtc-stats.ts                       # current week (Mon UTC → now)
//   bun scripts/aibtc-stats.ts --week 2026-04-28     # week starting given Monday
//   bun scripts/aibtc-stats.ts --weeks 6             # also emit last-N-weeks rollup
//
// Pulls from public APIs:
//   - https://aibtc.com/api/agents     (agent directory, levels, verifiedAt)
//   - https://aibtc.news/api/report    (today's signals, totals, active correspondents)
//   - https://aibtc.news/api/signals?since=ISO  (paginated signal feed)
//
// x402 message counts come from agent-news D1 — that part needs `npm run wrangler` from
// /home/dev/aibtcdev/agent-news. Run it manually and paste into the JSON, or extend
// this script with the wrangler shell-out once we know the query.

const args = Bun.argv.slice(2);
const flag = (k: string): string | null => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? null : null;
};

const weekArg = flag("--week");
const weeksBack = parseInt(flag("--weeks") ?? "6", 10);
const outPath = flag("--out") ?? "src/web/data/network-stats.json";

function isoMonday(d: Date): string {
  const day = d.getUTCDay();
  const offset = (day + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const thisMonday = weekArg ?? isoMonday(new Date());
const weekStart = new Date(`${thisMonday}T00:00:00Z`);

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

type Agent = { btcAddress: string; displayName: string; level: number; levelName: string; verifiedAt: string };
type AgentsResponse = { agents: Agent[]; total: number };
type Report = { date: string; signalsToday: number; totalSignals: number; totalBeats: number; activeCorrespondents: number };

function bucketByWeek(dates: string[], weeksBack: number): { weekStart: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = 0; i < weeksBack; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    buckets.set(isoMonday(d), 0);
  }
  for (const date of dates) {
    if (!date) continue;
    const d = new Date(date);
    const wk = isoMonday(new Date(d.getTime()));
    if (buckets.has(wk)) buckets.set(wk, buckets.get(wk)! + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => ({ weekStart, count }));
}

console.log(`AIBTC stats — week of ${thisMonday}\n`);

const [agentsRes, report] = await Promise.all([
  fetchJson<AgentsResponse>("https://aibtc.com/api/agents"),
  fetchJson<Report>("https://aibtc.news/api/report"),
]);

const agents = agentsRes.agents;
const verifiedAtAll = agents.map((a) => a.verifiedAt).filter(Boolean);
const agentBuckets = bucketByWeek(verifiedAtAll, weeksBack);

const thisWeek = agents.filter((a) => a.verifiedAt >= thisMonday);
const lastMonday = (() => {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
})();
const lastWeek = agents.filter((a) => a.verifiedAt >= lastMonday && a.verifiedAt < thisMonday);

const result = {
  generated_at: new Date().toISOString(),
  week_start: thisMonday,
  totals: {
    aibtc_agents: agents.length,
    active_correspondents: report.activeCorrespondents,
    total_signals: report.totalSignals,
    total_beats: report.totalBeats,
  },
  this_week: {
    new_agents: thisWeek.length,
    new_agents_l1_plus: thisWeek.filter((a) => a.level >= 1).length,
    new_agents_genesis: thisWeek.filter((a) => a.level >= 2).length,
  },
  last_week: {
    new_agents: lastWeek.length,
  },
  wow_delta: {
    new_agents: thisWeek.length - lastWeek.length,
  },
  agent_signups_by_week: agentBuckets,
  // x402 messages — populate from `npm run wrangler d1 execute ... --command "SELECT ..."`
  // in /home/dev/aibtcdev/agent-news. Leave null until filled.
  x402_messages: {
    total: null,
    this_week: null,
    by_week: agentBuckets.map((b) => ({ weekStart: b.weekStart, count: null })),
    note: "Fill from agent-news D1 via wrangler",
  },
  this_week_agents: thisWeek
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))
    .map((a) => ({
      verifiedAt: a.verifiedAt,
      displayName: a.displayName,
      btcAddress: a.btcAddress,
      level: a.level,
      levelName: a.levelName,
    })),
};

await Bun.write(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`Total AIBTC agents: ${result.totals.aibtc_agents}`);
console.log(`This week (since ${thisMonday}): ${result.this_week.new_agents} new`);
console.log(`Last week: ${result.last_week.new_agents} new`);
console.log(`WoW: ${result.wow_delta.new_agents >= 0 ? "+" : ""}${result.wow_delta.new_agents}`);
console.log(`\nAgent signups by week (${weeksBack}-wk rolling):`);
for (const b of agentBuckets) console.log(`  ${b.weekStart}  ${"█".repeat(b.count)} ${b.count}`);
console.log(`\nWrote ${outPath}`);
