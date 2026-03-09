// arc-observatory/cli.ts — Fleet observability CLI + server
//
// Usage:
//   arc skills run --name arc-observatory -- start     # start observatory server
//   arc skills run --name arc-observatory -- status    # show fleet health summary
//   arc skills run --name arc-observatory -- agents    # list configured agents + connectivity

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---- Types ----

interface AgentConfig {
  name: string;
  url: string;
}

interface FleetConfig {
  agents: AgentConfig[];
  poll_interval_seconds: number;
  port: number;
}

interface AgentSnapshot {
  name: string;
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

// ---- Polling ----

const cache = new Map<string, AgentSnapshot>();

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
    r.status === "fulfilled" ? r.value : { name: "unknown", url: "", online: false, last_poll: null, latency_ms: null, status: null, error: "poll failed" }
  );
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
  .agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .agent-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; }
  .agent-card.offline { border-color: var(--red); opacity: 0.7; }
  .agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .agent-name { font-size: 0.95rem; font-weight: 600; }
  .badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge.online { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.offline { background: rgba(239,68,68,0.15); color: var(--red); }
  .agent-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; font-size: 0.8rem; }
  .agent-stats dt { color: var(--dim); }
  .agent-stats dd { text-align: right; }
  .last-poll { font-size: 0.65rem; color: var(--dim); margin-top: 0.5rem; }
  .error-msg { font-size: 0.7rem; color: var(--red); margin-top: 0.3rem; }
</style>
</head>
<body>
<h1>arc-observatory <span>// fleet</span></h1>
<div class="fleet-bar" id="fleet-bar">loading...</div>
<div class="agents" id="agents"></div>
<script>
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
  } catch(e) { console.error('poll failed', e); }
}
function stat(label, value) {
  return '<div class="fleet-stat"><span class="label">' + label + '</span><span class="value">' + value + '</span></div>';
}
function agentCard(a) {
  const cls = a.online ? '' : ' offline';
  const badge = a.online ? '<span class="badge online">online</span>' : '<span class="badge offline">offline</span>';
  let stats = '';
  if (a.pending !== null) {
    stats = '<dl class="agent-stats">' +
      '<dt>pending</dt><dd>' + a.pending + '</dd>' +
      '<dt>active</dt><dd>' + (a.active || 0) + '</dd>' +
      '<dt>completed</dt><dd>' + (a.completed_today || 0) + '</dd>' +
      '<dt>cost</dt><dd>$' + (a.cost_today_usd || 0).toFixed(2) + '</dd>' +
      (a.latency_ms ? '<dt>latency</dt><dd>' + a.latency_ms + 'ms</dd>' : '') +
      '</dl>';
  }
  const lastPoll = a.last_poll ? '<div class="last-poll">polled ' + new Date(a.last_poll).toLocaleTimeString() + '</div>' : '';
  const error = a.error ? '<div class="error-msg">' + a.error + '</div>' : '';
  return '<div class="agent-card' + cls + '">' +
    '<div class="agent-header"><span class="agent-name">' + a.name + '</span>' + badge + '</div>' +
    stats + lastPoll + error + '</div>';
}
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;

// ---- Server ----

function startServer(config: FleetConfig): void {
  // Initial poll
  pollAll(config.agents).then(() => {
    console.log(`[observatory] Initial poll complete: ${cache.size} agents`);
  });

  // Recurring poll
  setInterval(() => {
    pollAll(config.agents);
  }, config.poll_interval_seconds * 1000);

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
