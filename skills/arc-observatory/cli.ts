// arc-observatory/cli.ts — Fleet observability CLI + server
//
// Usage:
//   arc skills run --name arc-observatory -- start     # start observatory server
//   arc skills run --name arc-observatory -- status    # show fleet health summary
//   arc skills run --name arc-observatory -- agents    # list configured agents + connectivity

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---- Types ----

interface AgentConfig {
  name: string;
  bns?: string;
  url: string;
}

interface FleetConfig {
  agents: AgentConfig[];
  poll_interval_seconds: number;
  port: number;
}

interface AgentSnapshot {
  name: string;
  bns: string | null;
  url: string;
  online: boolean;
  last_poll: string | null;
  latency_ms: number | null;
  status: AgentStatus | null;
  error: string | null;
}

interface AgentStatus {
  pending: number;
  active: number;
  completed_today: number;
  failed_today: number;
  cost_today_usd: number;
  api_cost_today_usd: number;
  last_cycle: { started_at: string; task_id: number | null; duration_ms: number | null } | null;
  uptime_hours: number;
}

interface AgentIdentity {
  name: string;
  bns?: string;
  btc?: string;
  stx?: string;
}

// ---- Config ----

const CONFIG_PATH = join(import.meta.dir, "fleet.json");

function loadConfig(): FleetConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.error("Fleet config not found:", CONFIG_PATH);
    process.exit(1);
  }
  const content = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(content) as FleetConfig;
}

// ---- Bitcoin Faces Cache ----

const FACES_CACHE_DIR = join(import.meta.dir, "cache");

function getBnsPrefixFromBns(bns: string): string {
  return bns.replace(/\.btc$/, "");
}

async function cacheBitcoinFace(bns: string): Promise<string | null> {
  const prefix = getBnsPrefixFromBns(bns);
  const cachePath = join(FACES_CACHE_DIR, `${prefix}.png`);

  if (existsSync(cachePath)) return cachePath;

  try {
    mkdirSync(FACES_CACHE_DIR, { recursive: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://bitcoinfaces.xyz/api/get-image?name=${prefix}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    writeFileSync(cachePath, Buffer.from(buf));
    return cachePath;
  } catch {
    return null;
  }
}

async function cacheAllFaces(agents: AgentConfig[]): Promise<void> {
  const bnsAgents = agents.filter((a) => a.bns);
  await Promise.allSettled(bnsAgents.map((a) => cacheBitcoinFace(a.bns!)));
}

function serveFace(name: string): Response {
  const cachePath = join(FACES_CACHE_DIR, `${name}.png`);
  if (!existsSync(cachePath)) {
    return new Response("Not found", { status: 404 });
  }
  const file = readFileSync(cachePath);
  return new Response(file, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ---- Feed Types ----

interface FeedTask {
  agent: string;
  agent_bns: string | null;
  id: number;
  subject: string;
  priority: number;
  status: string;
  source: string | null;
  model: string | null;
  created_at: string;
  cost_usd: number;
}

// ---- Polling ----

const cache = new Map<string, AgentSnapshot>();
const feedCache = new Map<string, FeedTask[]>();

async function pollAgent(agent: AgentConfig): Promise<AgentSnapshot> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${agent.url}/api/status`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = (await res.json()) as AgentStatus;
    const latency = Date.now() - start;

    const snapshot: AgentSnapshot = {
      name: agent.name,
      bns: agent.bns ?? null,
      url: agent.url,
      online: true,
      last_poll: new Date().toISOString(),
      latency_ms: latency,
      status,
      error: null,
    };
    cache.set(agent.name, snapshot);
    return snapshot;
  } catch (err) {
    const snapshot: AgentSnapshot = {
      name: agent.name,
      bns: agent.bns ?? null,
      url: agent.url,
      online: false,
      last_poll: new Date().toISOString(),
      latency_ms: null,
      status: cache.get(agent.name)?.status ?? null, // keep stale data
      error: err instanceof Error ? err.message : String(err),
    };
    cache.set(agent.name, snapshot);
    return snapshot;
  }
}

async function pollAll(agents: AgentConfig[]): Promise<AgentSnapshot[]> {
  const results = await Promise.allSettled(agents.map(pollAgent));
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : { name: "unknown", bns: null, url: "", online: false, last_poll: null, latency_ms: null, status: null, error: "poll failed" }
  );
}

// ---- Feed Polling ----

async function pollAgentFeed(agent: AgentConfig): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${agent.url}/api/tasks?limit=30`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;
    const data = (await res.json()) as { tasks: Array<{ id: number; subject: string; priority: number; status: string; source: string | null; model: string | null; created_at: string; cost_usd: number }> };

    const tasks: FeedTask[] = data.tasks.map((t) => ({
      agent: agent.name,
      agent_bns: agent.bns ?? null,
      id: t.id,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      source: t.source,
      model: t.model,
      created_at: t.created_at,
      cost_usd: t.cost_usd ?? 0,
    }));
    feedCache.set(agent.name, tasks);
  } catch {
    // Keep stale feed data on failure
  }
}

async function pollAllFeeds(agents: AgentConfig[]): Promise<void> {
  await Promise.allSettled(agents.map(pollAgentFeed));
}

// ---- API Handlers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function handleFleetStatus(): Response {
  const snapshots = Array.from(cache.values());
  const online = snapshots.filter((s) => s.online).length;
  const total = snapshots.length;

  let totalPending = 0;
  let totalActive = 0;
  let totalCompletedToday = 0;
  let totalFailedToday = 0;
  let totalCostToday = 0;

  for (const s of snapshots) {
    if (s.status) {
      totalPending += s.status.pending;
      totalActive += s.status.active;
      totalCompletedToday += s.status.completed_today;
      totalFailedToday += s.status.failed_today;
      totalCostToday += s.status.cost_today_usd;
    }
  }

  return json({
    fleet: { online, total, agents: snapshots.map((s) => s.name) },
    totals: {
      pending: totalPending,
      active: totalActive,
      completed_today: totalCompletedToday,
      failed_today: totalFailedToday,
      cost_today_usd: Math.round(totalCostToday * 100) / 100,
    },
    agents: snapshots.map((s) => ({
      name: s.name,
      bns: s.bns,
      url: s.url,
      face_url: s.bns ? `/api/fleet/faces/${getBnsPrefixFromBns(s.bns)}` : null,
      online: s.online,
      latency_ms: s.latency_ms,
      last_poll: s.last_poll,
      pending: s.status?.pending ?? null,
      active: s.status?.active ?? null,
      completed_today: s.status?.completed_today ?? null,
      cost_today_usd: s.status?.cost_today_usd ?? null,
      last_cycle: s.status?.last_cycle ?? null,
      error: s.error,
    })),
  });
}

function handleFleetAgents(): Response {
  return json({
    agents: Array.from(cache.values()).map((s) => ({
      name: s.name,
      bns: s.bns,
      face_url: s.bns ? `/api/fleet/faces/${getBnsPrefixFromBns(s.bns)}` : null,
      url: s.url,
      online: s.online,
      latency_ms: s.latency_ms,
      last_poll: s.last_poll,
      error: s.error,
    })),
  });
}

async function proxyToAgent(agentName: string, apiPath: string, url: URL): Promise<Response> {
  const snapshot = cache.get(agentName);
  if (!snapshot) return json({ error: `Agent '${agentName}' not found` }, 404);

  try {
    const targetUrl = new URL(apiPath, snapshot.url);
    // Forward query params
    url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(targetUrl.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return json({ error: `Failed to reach ${agentName}: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
}

function handleFleetFeed(): Response {
  const allTasks: FeedTask[] = [];
  for (const tasks of feedCache.values()) {
    allTasks.push(...tasks);
  }
  // Sort by created_at descending (newest first), then by id descending
  allTasks.sort((a, b) => {
    const timeCompare = (b.created_at || "").localeCompare(a.created_at || "");
    return timeCompare !== 0 ? timeCompare : b.id - a.id;
  });
  // Return top 50 merged items
  return json({ feed: allTasks.slice(0, 50), updated_at: new Date().toISOString() });
}

function handleFleetCosts(): Response {
  const snapshots = Array.from(cache.values());
  return json({
    agents: snapshots.map((s) => ({
      name: s.name,
      online: s.online,
      cost_today_usd: s.status?.cost_today_usd ?? null,
      api_cost_today_usd: s.status?.api_cost_today_usd ?? null,
    })),
    total_cost_today_usd: Math.round(
      snapshots.reduce((sum, s) => sum + (s.status?.cost_today_usd ?? 0), 0) * 100
    ) / 100,
    total_api_cost_today_usd: Math.round(
      snapshots.reduce((sum, s) => sum + (s.status?.api_cost_today_usd ?? 0), 0) * 100
    ) / 100,
  });
}

// ---- Static Dashboard ----

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arc Observatory</title>
<style>
  :root { --bg: #0a0a0a; --card: #141414; --border: #222; --text: #e0e0e0; --dim: #666; --green: #22c55e; --red: #ef4444; --amber: #f59e0b; --blue: #3b82f6; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', monospace; background: var(--bg); color: var(--text); padding: 1.5rem; }
  h1 { font-size: 1.1rem; margin-bottom: 1rem; color: var(--dim); }
  h1 span { color: var(--text); }
  .fleet-bar { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; padding: 0.75rem 1rem; background: var(--card); border: 1px solid var(--border); border-radius: 6px; flex-wrap: wrap; }
  .fleet-stat { display: flex; flex-direction: column; }
  .fleet-stat .label { font-size: 0.7rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .fleet-stat .value { font-size: 1.2rem; font-weight: 600; }
  /* Tabs */
  .tabs { display: flex; gap: 0; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .tab { padding: 0.5rem 1.25rem; font-size: 0.8rem; font-family: inherit; color: var(--dim); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.05em; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text); border-bottom-color: var(--blue); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Live Feed */
  .feed { display: flex; flex-direction: column; gap: 0; max-height: 75vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--card); }
  .feed::-webkit-scrollbar { width: 6px; }
  .feed::-webkit-scrollbar-track { background: var(--card); }
  .feed::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .feed-item { display: grid; grid-template-columns: 28px 70px 1fr auto auto auto; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); animation: feedSlideIn 0.3s ease-out; transition: background 0.15s; }
  .feed-item:last-child { border-bottom: none; }
  .feed-item:hover { background: rgba(255,255,255,0.02); }
  .feed-item.status-active { border-left: 2px solid var(--blue); }
  .feed-item.status-completed { border-left: 2px solid var(--green); }
  .feed-item.status-failed { border-left: 2px solid var(--red); }
  .feed-item.status-pending { border-left: 2px solid var(--dim); }
  .feed-item.status-blocked { border-left: 2px solid var(--amber); }
  .feed-face { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border); }
  .feed-agent { font-size: 0.7rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-subject { font-size: 0.8rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-status { font-size: 0.6rem; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; text-align: center; min-width: 60px; }
  .feed-status.s-pending { background: rgba(102,102,102,0.2); color: var(--dim); }
  .feed-status.s-active { background: rgba(59,130,246,0.15); color: var(--blue); }
  .feed-status.s-completed { background: rgba(34,197,94,0.15); color: var(--green); }
  .feed-status.s-failed { background: rgba(239,68,68,0.15); color: var(--red); }
  .feed-status.s-blocked { background: rgba(245,158,11,0.15); color: var(--amber); }
  .feed-cost { font-size: 0.7rem; color: var(--dim); white-space: nowrap; min-width: 45px; text-align: right; }
  .feed-time { font-size: 0.65rem; color: var(--dim); white-space: nowrap; min-width: 55px; text-align: right; }
  .feed-empty { padding: 2rem; text-align: center; color: var(--dim); font-size: 0.8rem; }
  @keyframes feedSlideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 768px) {
    .feed-item { grid-template-columns: 24px 50px 1fr auto; }
    .feed-cost, .feed-time { display: none; }
  }

  .agents { display: flex; flex-direction: column; gap: 0.75rem; }
  .agent-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem 1rem; display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0.75rem 1rem; cursor: pointer; transition: border-color 0.15s; }
  .agent-card.offline { border-color: var(--red); opacity: 0.7; }
  .agent-card:hover { border-color: var(--blue); }
  .agent-card.selected { border-color: var(--blue); box-shadow: 0 0 0 1px var(--blue); }
  .agent-identity { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .agent-face { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border); flex-shrink: 0; }
  .agent-name { font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
  .agent-bns { font-size: 0.75rem; color: var(--dim); margin-left: 0.25rem; }
  .badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
  .badge.online { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.offline { background: rgba(239,68,68,0.15); color: var(--red); }
  .agent-location { font-size: 0.75rem; color: var(--dim); font-family: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agent-stats-inline { display: flex; gap: 1rem; font-size: 0.75rem; white-space: nowrap; }
  .agent-stats-inline .stat-item { display: flex; gap: 0.3rem; }
  .agent-stats-inline .stat-label { color: var(--dim); }
  .agent-stats-inline .stat-value { color: var(--text); }
  .agent-actions { display: flex; gap: 0.5rem; align-items: center; }
  .agent-btn { font-size: 0.7rem; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--dim); cursor: pointer; white-space: nowrap; font-family: inherit; transition: all 0.15s; }
  .agent-btn:hover { border-color: var(--blue); color: var(--blue); }
  .last-poll { font-size: 0.6rem; color: var(--dim); }
  .error-msg { font-size: 0.7rem; color: var(--red); grid-column: 1 / -1; }
  @media (max-width: 768px) {
    .agent-card { grid-template-columns: 1fr; gap: 0.5rem; }
    .agent-identity { justify-content: space-between; }
    .agent-stats-inline { flex-wrap: wrap; gap: 0.5rem; }
    .agent-actions { justify-content: flex-start; }
  }
  .agent-frame-wrap { margin-top: 1rem; display: none; }
  .agent-frame-wrap.visible { display: block; }
  .frame-header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--card); border: 1px solid var(--blue); border-bottom: none; border-radius: 6px 6px 0 0; font-size: 0.8rem; }
  .frame-header .frame-title { color: var(--text); }
  .frame-header .frame-close { color: var(--dim); cursor: pointer; padding: 2px 6px; border-radius: 3px; }
  .frame-header .frame-close:hover { background: var(--border); color: var(--text); }
  .agent-frame { width: 100%; height: 80vh; border: 1px solid var(--blue); border-radius: 0 0 6px 6px; background: var(--bg); }
</style>
</head>
<body>
<h1>arc-observatory <span>// fleet</span></h1>
<div class="fleet-bar" id="fleet-bar">loading...</div>
<div class="tabs">
  <button class="tab active" data-tab="feed" onclick="switchTab('feed')">Live Feed</button>
  <button class="tab" data-tab="agents" onclick="switchTab('agents')">Agents</button>
</div>
<div class="tab-content active" id="tab-feed">
  <div class="feed" id="feed"><div class="feed-empty">loading feed...</div></div>
</div>
<div class="tab-content" id="tab-agents">
  <div class="agents" id="agents"></div>
</div>
<div class="agent-frame-wrap" id="frame-wrap">
  <div class="frame-header">
    <span class="frame-title" id="frame-title"></span>
    <span class="frame-close" id="frame-close">✕ close</span>
  </div>
  <iframe class="agent-frame" id="agent-frame" frameborder="0"></iframe>
</div>
<script>
let activeTab = 'feed';
let knownFeedIds = new Set();

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

async function refresh() {
  try {
    const res = await fetch('/api/fleet/status');
    const data = await res.json();
    // Fleet bar
    const bar = document.getElementById('fleet-bar');
    bar.innerHTML = [
      stat('agents', data.fleet.online + '/' + data.fleet.total),
      stat('pending', data.totals.pending),
      stat('active', data.totals.active),
      stat('completed', data.totals.completed_today),
      stat('failed', data.totals.failed_today),
      stat('cost today', '$' + data.totals.cost_today_usd.toFixed(2)),
    ].join('');
    // Agent cards
    const container = document.getElementById('agents');
    container.innerHTML = data.agents.map(a => agentCard(a)).join('');
    // Restore selected state after refresh
    if (selectedAgent) {
      const sel = container.querySelector('[data-name="' + selectedAgent + '"]');
      if (sel) sel.classList.add('selected');
    }
  } catch(e) { console.error('poll failed', e); }
}

async function refreshFeed() {
  try {
    const res = await fetch('/api/fleet/feed');
    const data = await res.json();
    const feed = document.getElementById('feed');
    if (!data.feed || data.feed.length === 0) {
      feed.innerHTML = '<div class="feed-empty">no tasks yet</div>';
      return;
    }
    const newIds = new Set(data.feed.map(t => t.agent + ':' + t.id));
    feed.innerHTML = data.feed.map(t => feedItem(t, !knownFeedIds.has(t.agent + ':' + t.id))).join('');
    knownFeedIds = newIds;
  } catch(e) { console.error('feed poll failed', e); }
}

function feedItem(t, isNew) {
  var bnsPrefix = t.agent_bns ? t.agent_bns.replace(/\\.btc$/, '') : null;
  var faceHtml = bnsPrefix ? '<img class="feed-face" src="/api/fleet/faces/' + bnsPrefix + '" alt="' + t.agent + '">' : '<div class="feed-face" style="background:var(--border)"></div>';
  var statusCls = 's-' + (t.status || 'pending');
  var statusItemCls = 'status-' + (t.status || 'pending');
  var cost = t.cost_usd > 0 ? '$' + t.cost_usd.toFixed(2) : '';
  var timeStr = '';
  if (t.created_at) {
    try { timeStr = new Date(t.created_at + 'Z').toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch(e) { timeStr = ''; }
  }
  var animStyle = isNew ? '' : ' style="animation:none"';
  return '<div class="feed-item ' + statusItemCls + '"' + animStyle + '>' +
    faceHtml +
    '<span class="feed-agent">' + t.agent + '</span>' +
    '<span class="feed-subject" title="' + (t.subject || '').replace(/"/g, '&quot;') + '">#' + t.id + ' ' + (t.subject || '') + '</span>' +
    '<span class="feed-status ' + statusCls + '">' + (t.status || '') + '</span>' +
    '<span class="feed-cost">' + cost + '</span>' +
    '<span class="feed-time">' + timeStr + '</span>' +
  '</div>';
}
function stat(label, value) {
  return '<div class="fleet-stat"><span class="label">' + label + '</span><span class="value">' + value + '</span></div>';
}
function agentCard(a) {
  const cls = a.online ? '' : ' offline';
  const badge = a.online ? '<span class="badge online">online</span>' : '<span class="badge offline">offline</span>';
  const face = a.face_url ? '<img class="agent-face" src="' + a.face_url + '" alt="' + a.name + '">' : '';
  const bns = a.bns ? '<span class="agent-bns">' + a.bns + '</span>' : '';
  // Extract host from URL for location display
  var loc = '';
  try { var u = new URL(a.url); loc = u.hostname + (u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : ''); } catch(e) { loc = a.url || ''; }
  var statsHtml = '';
  if (a.pending !== null) {
    statsHtml = '<div class="agent-stats-inline">' +
      '<span class="stat-item"><span class="stat-label">P</span><span class="stat-value">' + a.pending + '</span></span>' +
      '<span class="stat-item"><span class="stat-label">A</span><span class="stat-value">' + (a.active || 0) + '</span></span>' +
      '<span class="stat-item"><span class="stat-label">C</span><span class="stat-value">' + (a.completed_today || 0) + '</span></span>' +
      '<span class="stat-item"><span class="stat-label">$</span><span class="stat-value">' + (a.cost_today_usd || 0).toFixed(2) + '</span></span>' +
      (a.latency_ms ? '<span class="stat-item"><span class="stat-label">ms</span><span class="stat-value">' + a.latency_ms + '</span></span>' : '') +
      '</div>';
  }
  var lastPoll = a.last_poll ? '<span class="last-poll">polled ' + new Date(a.last_poll).toLocaleTimeString() + '</span>' : '';
  var error = a.error ? '<div class="error-msg">' + a.error + '</div>' : '';
  return '<div class="agent-card' + cls + '" data-url="' + (a.url || '') + '" data-name="' + a.name + '">' +
    '<div class="agent-identity">' + face + '<span class="agent-name">' + a.name + '</span>' + bns + ' ' + badge + '</div>' +
    '<span class="agent-location">' + loc + '</span>' +
    statsHtml +
    '<div class="agent-actions">' +
      '<button class="agent-btn" onclick="selectAgent(this.closest(\'.agent-card\'))">dashboard</button>' +
      lastPoll +
    '</div>' +
    error +
  '</div>';
}
let selectedAgent = null;
function selectAgent(el) {
  const url = el.dataset.url;
  const name = el.dataset.name;
  if (!url) return;
  const wrap = document.getElementById('frame-wrap');
  const frame = document.getElementById('agent-frame');
  const title = document.getElementById('frame-title');
  // Toggle off if same agent clicked
  if (selectedAgent === name) {
    selectedAgent = null;
    wrap.classList.remove('visible');
    frame.src = '';
    document.querySelectorAll('.agent-card.selected').forEach(c => c.classList.remove('selected'));
    return;
  }
  selectedAgent = name;
  document.querySelectorAll('.agent-card.selected').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  title.textContent = name + ' dashboard';
  frame.src = url;
  wrap.classList.add('visible');
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('frame-close').addEventListener('click', function() {
  selectedAgent = null;
  document.getElementById('frame-wrap').classList.remove('visible');
  document.getElementById('agent-frame').src = '';
  document.querySelectorAll('.agent-card.selected').forEach(c => c.classList.remove('selected'));
});
refresh();
refreshFeed();
setInterval(refresh, 15000);
setInterval(refreshFeed, 5000);
</script>
</body>
</html>`;

// ---- Server ----

function startServer(config: FleetConfig): void {
  // Cache Bitcoin Faces
  cacheAllFaces(config.agents).then(() => {
    console.log(`[observatory] Bitcoin Faces cached`);
  });

  // Initial poll
  pollAll(config.agents).then(() => {
    console.log(`[observatory] Initial poll complete: ${cache.size} agents`);
  });

  // Initial feed poll
  pollAllFeeds(config.agents).then(() => {
    console.log(`[observatory] Initial feed poll complete`);
  });

  // Recurring status poll
  setInterval(() => {
    pollAll(config.agents);
  }, config.poll_interval_seconds * 1000);

  // Recurring feed poll (every 5s for live feed)
  setInterval(() => {
    pollAllFeeds(config.agents);
  }, 5000);

  const server = Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Fleet API
      if (path === "/api/fleet/status") return handleFleetStatus();
      if (path === "/api/fleet/agents") return handleFleetAgents();
      if (path === "/api/fleet/costs") return handleFleetCosts();
      if (path === "/api/fleet/feed") return handleFleetFeed();

      // Bitcoin Faces images
      const faceMatch = path.match(/^\/api\/fleet\/faces\/([a-zA-Z0-9]+)$/);
      if (faceMatch) return serveFace(faceMatch[1]);

      // Proxy: /api/fleet/agents/:name/tasks|cycles|sensors|skills|status
      const proxyMatch = path.match(/^\/api\/fleet\/agents\/([^/]+)\/(tasks|cycles|sensors|skills|status|costs|identity)$/);
      if (proxyMatch) {
        const [, agentName, endpoint] = proxyMatch;
        return proxyToAgent(agentName, `/api/${endpoint}`, url);
      }

      // Dashboard
      if (path === "/" || path === "/index.html") {
        return new Response(DASHBOARD_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return json({ error: "Not found" }, 404);
    },
  });

  console.log(`Arc Observatory running on http://0.0.0.0:${server.port}`);
  console.log(`Monitoring ${config.agents.length} agents: ${config.agents.map((a) => a.name).join(", ")}`);
}

// ---- CLI Commands ----

async function cmdStatus(config: FleetConfig): Promise<void> {
  const snapshots = await pollAll(config.agents);
  const online = snapshots.filter((s) => s.online);
  const offline = snapshots.filter((s) => !s.online);

  console.log(`\nFleet: ${online.length}/${snapshots.length} agents online\n`);

  for (const s of snapshots) {
    const indicator = s.online ? "●" : "○";
    const status = s.online ? "online" : "OFFLINE";
    const cost = s.status ? `$${s.status.cost_today_usd.toFixed(2)}` : "-";
    const pending = s.status ? `${s.status.pending}p/${s.status.active}a/${s.status.completed_today}c` : "-";
    const latency = s.latency_ms ? `${s.latency_ms}ms` : "-";

    console.log(`  ${indicator} ${s.name.padEnd(10)} ${status.padEnd(8)} tasks: ${pending.padEnd(12)} cost: ${cost.padEnd(8)} latency: ${latency}`);
    if (s.error) console.log(`    └─ ${s.error}`);
  }

  if (online.length > 0) {
    const totalCost = online.reduce((sum, s) => sum + (s.status?.cost_today_usd ?? 0), 0);
    const totalPending = online.reduce((sum, s) => sum + (s.status?.pending ?? 0), 0);
    const totalCompleted = online.reduce((sum, s) => sum + (s.status?.completed_today ?? 0), 0);
    console.log(`\n  Totals: ${totalPending} pending, ${totalCompleted} completed today, $${totalCost.toFixed(2)} cost`);
  }
  console.log();
}

async function cmdAgents(config: FleetConfig): Promise<void> {
  const snapshots = await pollAll(config.agents);
  console.log("\nConfigured agents:\n");
  for (const s of snapshots) {
    const status = s.online ? "online" : "OFFLINE";
    console.log(`  ${s.name.padEnd(10)} ${s.url.padEnd(35)} ${status}${s.latency_ms ? ` (${s.latency_ms}ms)` : ""}`);
  }
  console.log();
}

// ---- Main ----

const args = process.argv.slice(2);
const command = args[0];
const config = loadConfig();

switch (command) {
  case "start":
    startServer(config);
    break;
  case "status":
    await cmdStatus(config);
    break;
  case "agents":
    await cmdAgents(config);
    break;
  default:
    console.log("Usage: arc skills run --name arc-observatory -- <command>");
    console.log("Commands: start, status, agents");
    process.exit(1);
}
