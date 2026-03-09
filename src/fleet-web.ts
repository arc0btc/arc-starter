// fleet-web.ts — Aggregate fleet dashboard server
//
// Standalone Bun HTTP server on port 4000.
// Proxies /api/fleet/agents/:name/* to each agent's :3000 API.
// Serves static files from src/fleet-web/.
// Arena runs are proxied to Arc's local :3000 arena API.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { AGENTS, type AgentConfig } from "./ssh.ts";

// ---- Constants ----

const PORT = parseInt(process.env.ARC_FLEET_WEB_PORT || "4000");
const STATIC_DIR = join(import.meta.dir, "fleet-web");
const ARC_API = "http://127.0.0.1:3000";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Fleet agent list: arc (local) + remote agents
interface FleetAgent {
  name: string;
  displayName: string;
  ip: string;
  port: number;
  role: string;
}

const FLEET: FleetAgent[] = [
  { name: "arc", displayName: "Arc", ip: "127.0.0.1", port: 3000, role: "orchestrator" },
  ...Object.entries(AGENTS).map(([name, cfg]: [string, AgentConfig]) => ({
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    ip: cfg.ip,
    port: 3000,
    role: name === "spark" ? "protocol" : name === "iris" ? "research" : name === "loom" ? "integrations" : "infrastructure",
  })),
];

// ---- Helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function proxyToAgent(agentIp: string, agentPort: number, apiPath: string, timeout = 8000): Promise<Response> {
  const url = `http://${agentIp}:${agentPort}${apiPath}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const contentType = resp.headers.get("Content-Type") || "application/json";
    const body = await resp.arrayBuffer();
    return new Response(body, {
      status: resp.status,
      headers: { "Content-Type": contentType, ...corsHeaders() },
    });
  } catch {
    return json({ error: "unreachable", agent_ip: agentIp }, 502);
  }
}

// ---- Fleet status aggregation ----

interface AgentStatus {
  name: string;
  displayName: string;
  role: string;
  ip: string;
  port: number;
  reachable: boolean;
  status: Record<string, unknown> | null;
  identity: Record<string, unknown> | null;
}

async function fetchAgentStatus(agent: FleetAgent): Promise<AgentStatus> {
  const base = `http://${agent.ip}:${agent.port}`;
  const timeout = 5000;

  const result: AgentStatus = {
    name: agent.name,
    displayName: agent.displayName,
    role: agent.role,
    ip: agent.ip,
    port: agent.port,
    reachable: false,
    status: null,
    identity: null,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const [statusResp, identityResp] = await Promise.allSettled([
      fetch(`${base}/api/status`, { signal: controller.signal }),
      fetch(`${base}/api/identity`, { signal: controller.signal }),
    ]);
    clearTimeout(timer);

    if (statusResp.status === "fulfilled" && statusResp.value.ok) {
      result.status = await statusResp.value.json() as Record<string, unknown>;
      result.reachable = true;
    }
    if (identityResp.status === "fulfilled" && identityResp.value.ok) {
      result.identity = await identityResp.value.json() as Record<string, unknown>;
    }
  } catch {
    // unreachable
  }

  return result;
}

async function handleFleetStatus(): Promise<Response> {
  const results = await Promise.allSettled(FLEET.map(fetchAgentStatus));
  const agents = results.map(r => r.status === "fulfilled" ? r.value : null).filter(Boolean);
  return json({ agents, updated_at: new Date().toISOString() });
}

// ---- Route handler ----

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ---- API routes ----

  // Fleet overview (aggregate all agents)
  if (method === "GET" && path === "/api/fleet/status") {
    return handleFleetStatus();
  }

  // Fleet agent list (static config)
  if (method === "GET" && path === "/api/fleet/agents") {
    return json({ agents: FLEET });
  }

  // Proxy to specific agent's API: /api/fleet/agents/:name/api/*
  const agentApiMatch = path.match(/^\/api\/fleet\/agents\/([a-z]+)\/api\/(.+)$/);
  if (agentApiMatch) {
    const agentName = agentApiMatch[1];
    const apiPath = `/api/${agentApiMatch[2]}${url.search}`;
    const agent = FLEET.find(a => a.name === agentName);
    if (!agent) return json({ error: `Unknown agent: ${agentName}` }, 404);
    return proxyToAgent(agent.ip, agent.port, apiPath);
  }

  // Arena: proxy to Arc's local :3000 arena API
  if (method === "POST" && path === "/api/arena/run") {
    const body = await req.text();
    try {
      const resp = await fetch(`${ARC_API}/api/arena/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await resp.text();
      return new Response(data, {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    } catch {
      return json({ error: "Arena API unreachable" }, 502);
    }
  }

  if (method === "GET" && path === "/api/arena/history") {
    return proxyToAgent("127.0.0.1", 3000, "/api/arena/history");
  }

  const arenaRunMatch = path.match(/^\/api\/arena\/runs\/(.+)$/);
  if (arenaRunMatch) {
    return proxyToAgent("127.0.0.1", 3000, path);
  }

  // ---- Static files ----

  let filePath = path === "/" ? "/index.html" : path;

  // Serve shared CSS/JS from the per-agent web dir
  if (filePath === "/shared.css" || filePath === "/shared.js") {
    const sharedPath = join(import.meta.dir, "web", filePath.slice(1));
    if (existsSync(sharedPath)) {
      const ext = extname(sharedPath);
      return new Response(readFileSync(sharedPath), {
        headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", ...corsHeaders() },
      });
    }
  }

  const absPath = join(STATIC_DIR, filePath.slice(1));
  if (existsSync(absPath) && statSync(absPath).isFile()) {
    const ext = extname(absPath);
    return new Response(readFileSync(absPath), {
      headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", ...corsHeaders() },
    });
  }

  return new Response("Not Found", { status: 404 });
}

// ---- Server ----

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`[fleet-web] Fleet dashboard running at http://0.0.0.0:${PORT}`);
