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

// ---- Chat Types ----

interface FleetMessage {
  agent: string;
  agent_bns: string | null;
  id: number;
  from_agent: string;
  from_bns: string | null;
  message_type: string;
  content: string;
  created_at: string;
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
const chatCache = new Map<string, FleetMessage[]>();

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

// ---- Chat Polling ----

async function pollAgentChat(agent: AgentConfig): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${agent.url}/api/messages/fleet?limit=50`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;
    const data = (await res.json()) as { messages: Array<{ id: number; from_agent: string; from_bns: string | null; message_type: string; content: string; created_at: string }> };

    const messages: FleetMessage[] = data.messages.map((m) => ({
      agent: agent.name,
      agent_bns: agent.bns ?? null,
      id: m.id,
      from_agent: m.from_agent,
      from_bns: m.from_bns,
      message_type: m.message_type,
      content: m.content,
      created_at: m.created_at,
    }));
    chatCache.set(agent.name, messages);
  } catch {
    // Keep stale chat data on failure
  }
}

async function pollAllChats(agents: AgentConfig[]): Promise<void> {
  await Promise.allSettled(agents.map(pollAgentChat));
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

function handleFleetChat(): Response {
  const allMessages: FleetMessage[] = [];
  for (const messages of chatCache.values()) {
    allMessages.push(...messages);
  }
  // Deduplicate by from_agent + id (same message seen on multiple agents)
  const seen = new Set<string>();
  const deduped = allMessages.filter((m) => {
    const key = `${m.from_agent}:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Sort chronologically (oldest first for chat)
  deduped.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  return json({ messages: deduped.slice(-100), updated_at: new Date().toISOString() });
}

async function handlePostFleetChat(req: Request, config: FleetConfig): Promise<Response> {
  let body: { from_agent?: string; from_bns?: string; message_type?: string; content?: string };
  try {
    body = (await req.json()) as { from_agent?: string; from_bns?: string; message_type?: string; content?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const fromAgent = typeof body.from_agent === "string" ? body.from_agent.trim() : "";
  if (!fromAgent) return json({ error: "'from_agent' is required" }, 400);

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return json({ error: "'content' is required" }, 400);

  // Broadcast to all online agents
  const results: Array<{ agent: string; ok: boolean; error?: string }> = [];
  await Promise.allSettled(
    config.agents.map(async (agent) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${agent.url}/api/messages/fleet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        results.push({ agent: agent.name, ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` });
      } catch (err) {
        results.push({ agent: agent.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  return json({ broadcast: results, delivered: results.filter((r) => r.ok).length, total: results.length }, 201);
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

  /* Chat Panel */
  .chat-panel { position: fixed; right: 0; top: 0; width: 380px; height: 100vh; background: var(--card); border-left: 1px solid var(--border); display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.25s ease; z-index: 100; }
  .chat-panel.open { transform: translateX(0); }
  .chat-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .chat-header-title { font-size: 0.85rem; font-weight: 600; }
  .chat-header-hint { font-size: 0.6rem; color: var(--dim); }
  .chat-close { color: var(--dim); cursor: pointer; padding: 2px 8px; border-radius: 3px; font-size: 0.8rem; border: none; background: none; font-family: inherit; }
  .chat-close:hover { background: var(--border); color: var(--text); }
  .chat-messages { flex: 1; overflow-y: auto; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .chat-messages::-webkit-scrollbar { width: 5px; }
  .chat-messages::-webkit-scrollbar-track { background: var(--card); }
  .chat-messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .chat-msg { display: flex; gap: 0.5rem; align-items: flex-start; animation: feedSlideIn 0.2s ease-out; }
  .chat-msg-face { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border); flex-shrink: 0; margin-top: 2px; }
  .chat-msg-body { flex: 1; min-width: 0; }
  .chat-msg-header { display: flex; gap: 0.5rem; align-items: baseline; margin-bottom: 2px; }
  .chat-msg-name { font-size: 0.75rem; font-weight: 600; color: var(--text); }
  .chat-msg-type { font-size: 0.55rem; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
  .chat-msg-type.t-status { background: rgba(59,130,246,0.15); color: var(--blue); }
  .chat-msg-type.t-question { background: rgba(245,158,11,0.15); color: var(--amber); }
  .chat-msg-type.t-alert { background: rgba(239,68,68,0.15); color: var(--red); }
  .chat-msg-time { font-size: 0.6rem; color: var(--dim); margin-left: auto; }
  .chat-msg-content { font-size: 0.8rem; color: var(--text); line-height: 1.4; word-break: break-word; }
  .chat-empty { text-align: center; color: var(--dim); font-size: 0.8rem; margin-top: 2rem; }
  .chat-input-wrap { display: flex; gap: 0.5rem; padding: 0.75rem; border-top: 1px solid var(--border); flex-shrink: 0; }
  .chat-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem 0.75rem; color: var(--text); font-family: inherit; font-size: 0.8rem; outline: none; resize: none; }
  .chat-input:focus { border-color: var(--blue); }
  .chat-send { background: var(--blue); color: #fff; border: none; border-radius: 4px; padding: 0.5rem 1rem; font-family: inherit; font-size: 0.75rem; cursor: pointer; white-space: nowrap; }
  .chat-send:hover { opacity: 0.9; }
  .chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
  .chat-toggle { position: fixed; bottom: 1.5rem; right: 1.5rem; width: 44px; height: 44px; border-radius: 50%; background: var(--blue); color: #fff; border: none; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; z-index: 99; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.15s; }
  .chat-toggle:hover { transform: scale(1.1); }
  .chat-toggle.hidden { display: none; }
  .chat-unread { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px; background: var(--red); color: #fff; font-size: 0.6rem; display: flex; align-items: center; justify-content: center; padding: 0 4px; }
  @media (max-width: 768px) { .chat-panel { width: 100%; } }
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
<button class="chat-toggle" id="chat-toggle" title="Fleet Chat (C)">💬<span class="chat-unread" id="chat-unread" style="display:none">0</span></button>
<div class="chat-panel" id="chat-panel">
  <div class="chat-header">
    <div>
      <div class="chat-header-title">Fleet Chat</div>
      <div class="chat-header-hint">press C to toggle</div>
    </div>
    <button class="chat-close" id="chat-close">✕</button>
  </div>
  <div class="chat-messages" id="chat-messages"><div class="chat-empty">no messages yet</div></div>
  <div class="chat-input-wrap">
    <input class="chat-input" id="chat-input" placeholder="Message the fleet..." maxlength="2000">
    <button class="chat-send" id="chat-send">Send</button>
  </div>
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
// ---- Chat ----
let chatOpen = false;
let chatMessageCount = 0;
let chatUnreadCount = 0;
let chatKnownIds = new Set();

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('chat-toggle').classList.toggle('hidden', chatOpen);
  if (chatOpen) {
    chatUnreadCount = 0;
    document.getElementById('chat-unread').style.display = 'none';
    var msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chat-input').focus();
  }
}

document.getElementById('chat-toggle').addEventListener('click', toggleChat);
document.getElementById('chat-close').addEventListener('click', toggleChat);

document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'c' || e.key === 'C') { e.preventDefault(); toggleChat(); }
});

async function refreshChat() {
  try {
    var res = await fetch('/api/fleet/chat');
    var data = await res.json();
    var container = document.getElementById('chat-messages');
    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<div class="chat-empty">no messages yet</div>';
      return;
    }
    // Count new messages for unread badge
    var newIds = new Set(data.messages.map(function(m) { return m.from_agent + ':' + m.id; }));
    var newCount = 0;
    data.messages.forEach(function(m) {
      if (!chatKnownIds.has(m.from_agent + ':' + m.id)) newCount++;
    });
    if (newCount > 0 && !chatOpen && chatKnownIds.size > 0) {
      chatUnreadCount += newCount;
      var badge = document.getElementById('chat-unread');
      badge.textContent = chatUnreadCount > 99 ? '99+' : chatUnreadCount;
      badge.style.display = 'flex';
    }
    chatKnownIds = newIds;

    container.innerHTML = data.messages.map(chatMsg).join('');
    // Auto-scroll if near bottom
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 100) {
      container.scrollTop = container.scrollHeight;
    }
  } catch(e) { console.error('chat poll failed', e); }
}

function chatMsg(m) {
  var bnsPrefix = m.from_bns ? m.from_bns.replace(/\\.btc$/, '') : null;
  var faceHtml = bnsPrefix
    ? '<img class="chat-msg-face" src="/api/fleet/faces/' + bnsPrefix + '" alt="' + esc(m.from_agent) + '">'
    : '<div class="chat-msg-face" style="background:var(--border)"></div>';
  var typeCls = 't-' + (m.message_type || 'status');
  var timeStr = '';
  if (m.created_at) {
    try { timeStr = new Date(m.created_at + 'Z').toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch(e) {}
  }
  return '<div class="chat-msg">' +
    faceHtml +
    '<div class="chat-msg-body">' +
      '<div class="chat-msg-header">' +
        '<span class="chat-msg-name">' + esc(m.from_agent) + '</span>' +
        '<span class="chat-msg-type ' + typeCls + '">' + (m.message_type || 'status') + '</span>' +
        '<span class="chat-msg-time">' + timeStr + '</span>' +
      '</div>' +
      '<div class="chat-msg-content">' + esc(m.content) + '</div>' +
    '</div>' +
  '</div>';
}

function esc(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Send message
async function sendChatMessage() {
  var input = document.getElementById('chat-input');
  var content = input.value.trim();
  if (!content) return;
  var btn = document.getElementById('chat-send');
  btn.disabled = true;
  try {
    await fetch('/api/fleet/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_agent: 'Observatory', content: content, message_type: 'status' })
    });
    input.value = '';
    await refreshChat();
  } catch(e) { console.error('send failed', e); }
  btn.disabled = false;
  input.focus();
}

document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

refresh();
refreshFeed();
refreshChat();
setInterval(refresh, 15000);
setInterval(refreshFeed, 5000);
setInterval(refreshChat, 3000);
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

  // Initial chat poll
  pollAllChats(config.agents).then(() => {
    console.log(`[observatory] Initial chat poll complete`);
  });

  // Recurring status poll
  setInterval(() => {
    pollAll(config.agents);
  }, config.poll_interval_seconds * 1000);

  // Recurring feed poll (every 5s for live feed)
  setInterval(() => {
    pollAllFeeds(config.agents);
  }, 5000);

  // Recurring chat poll (every 3s for responsiveness)
  setInterval(() => {
    pollAllChats(config.agents);
  }, 3000);

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
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Fleet chat
      if (path === "/api/fleet/chat") {
        if (req.method === "POST") return handlePostFleetChat(req, config);
        return handleFleetChat();
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
