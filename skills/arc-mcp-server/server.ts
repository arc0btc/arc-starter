#!/usr/bin/env bun
/**
 * Arc MCP Server — Exposes task queue, skills, memory, and dispatch state
 * via Model Context Protocol.
 *
 * Transports:
 *   stdio (default) — for local Claude Code integration
 *   http            — for remote MCP clients
 *
 * Usage:
 *   bun skills/arc-mcp-server/server.ts                          # stdio
 *   bun skills/arc-mcp-server/server.ts --transport http         # HTTP on :3100
 *   bun skills/arc-mcp-server/server.ts --transport http --port 3100 --auth-key KEY
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  initDatabase,
  getTaskById,
  insertTask,
  markTaskCompleted,
  markTaskFailed,
  getRecentCycles,
  getTodayCostUsd,
} from "../../src/db.ts";
import { discoverSkills } from "../../src/skills.ts";
import { parseFlags } from "../../src/utils.ts";

// ---- Constants ----

const ROOT = join(import.meta.dir, "../..");
const MEMORY_PATH = join(ROOT, "memory/MEMORY.md");
const DEFAULT_PORT = 3100;

// ---- MCP Server setup ----

function createServer(): McpServer {
  const server = new McpServer({
    name: "arc",
    version: "1.0.0",
  });

  // Initialize database for all tool calls
  initDatabase();

  // ---- Tools ----

  server.tool(
    "list_tasks",
    "List Arc tasks filtered by status and/or priority",
    {
      status: z.enum(["pending", "active", "completed", "failed", "blocked"]).optional(),
      limit: z.number().min(1).max(100).optional(),
    },
    async ({ status, limit }) => {
      const db = (await import("../../src/db.ts")).getDatabase();
      const max = limit ?? 20;

      let rows;
      if (status) {
        rows = db
          .query(
            "SELECT id, subject, priority, status, source, skills, created_at, cost_usd FROM tasks WHERE status = ? ORDER BY priority ASC, id DESC LIMIT ?"
          )
          .all(status, max);
      } else {
        // Default: pending + active
        rows = db
          .query(
            "SELECT id, subject, priority, status, source, skills, created_at, cost_usd FROM tasks WHERE status IN ('pending', 'active') ORDER BY priority ASC, id DESC LIMIT ?"
          )
          .all(max);
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    }
  );

  server.tool(
    "create_task",
    "Create a new task in Arc's queue",
    {
      subject: z.string().min(1).max(500),
      description: z.string().max(2000).optional(),
      priority: z.number().min(1).max(10).optional(),
      skills: z.string().optional(), // comma-separated: "skill1,skill2"
    },
    async ({ subject, description, priority, skills }) => {
      const taskId = insertTask({
        subject,
        description: description ?? null,
        priority: priority ?? 5,
        skills: skills ? JSON.stringify(skills.split(",").map((s) => s.trim())) : null,
        source: "mcp",
      });

      const task = getTaskById(taskId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "get_task",
    "Get details of a specific task by ID",
    {
      id: z.number().int().positive(),
    },
    async ({ id }) => {
      const task = getTaskById(id);
      if (!task) {
        return {
          content: [{ type: "text" as const, text: `Task ${id} not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "close_task",
    "Close a task as completed or failed",
    {
      id: z.number().int().positive(),
      status: z.enum(["completed", "failed"]),
      summary: z.string().min(1).max(500),
    },
    async ({ id, status, summary }) => {
      const task = getTaskById(id);
      if (!task) {
        return {
          content: [{ type: "text" as const, text: `Task ${id} not found` }],
          isError: true,
        };
      }

      if (status === "completed") {
        markTaskCompleted(id, summary);
      } else {
        markTaskFailed(id, summary);
      }

      const updated = getTaskById(id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
      };
    }
  );

  server.tool(
    "list_skills",
    "List all installed Arc skills with metadata",
    {},
    async () => {
      const skills = discoverSkills();
      const result = skills.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        has_sensor: s.hasSensor,
        has_cli: s.hasCli,
        has_agent: s.hasAgent,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "get_status",
    "Get Arc agent status: task counts, costs, last cycle",
    {},
    async () => {
      const db = (await import("../../src/db.ts")).getDatabase();

      const pending = db
        .query("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'")
        .get() as { count: number };
      const active = db
        .query("SELECT COUNT(*) as count FROM tasks WHERE status = 'active'")
        .get() as { count: number };
      const completedToday = db
        .query(
          "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND date(completed_at) = date('now')"
        )
        .get() as { count: number };

      const costToday = getTodayCostUsd();

      const lastCycle = db
        .query(
          "SELECT started_at, task_id, duration_ms, cost_usd FROM cycle_log ORDER BY started_at DESC LIMIT 1"
        )
        .get() as { started_at: string; task_id: number | null; duration_ms: number | null; cost_usd: number } | null;

      const status = {
        pending: pending.count,
        active: active.count,
        completed_today: completedToday.count,
        cost_today_usd: Math.round(costToday * 100) / 100,
        last_cycle: lastCycle,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      };
    }
  );

  // ---- Resources ----

  server.resource(
    "memory",
    "arc://memory",
    { description: "Arc's long-term memory (MEMORY.md)", mimeType: "text/markdown" },
    async (uri) => {
      let text = "";
      if (existsSync(MEMORY_PATH)) {
        text = readFileSync(MEMORY_PATH, "utf-8");
      } else {
        text = "# Memory\n\nNo memory file found.";
      }
      return {
        contents: [{ uri: uri.href, text }],
      };
    }
  );

  server.resource(
    "cycles",
    "arc://cycles",
    { description: "Recent dispatch cycle log (last 20 entries)", mimeType: "application/json" },
    async (uri) => {
      const cycles = getRecentCycles(20);
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(cycles, null, 2) }],
      };
    }
  );

  return server;
}

// ---- Transport startup ----

async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio server runs until stdin closes
}

async function startHttp(
  port: number,
  authKey: string
): Promise<void> {
  // Each session gets its own McpServer + transport pair
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  // Restrict CORS to localhost origins only
  const ALLOWED_ORIGINS = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);

  function setCors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers["origin"];
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    // No Allow-Origin header if origin not in allowlist — browser will block
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  }

  function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  // Read request body as parsed JSON
  function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve(body ? JSON.parse(body) : undefined);
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    setCors(req, res);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check — unauthenticated for monitoring
    if (url.pathname === "/health") {
      jsonResponse(res, 200, { status: "ok", name: "arc-mcp" });
      return;
    }

    // Auth check — required for all other endpoints
    const authHeader = req.headers["authorization"];
    if (!authHeader || authHeader !== `Bearer ${authKey}`) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        let session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session) {
          // Create new McpServer + transport per session
          const server = createServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            enableJsonResponse: true,
          });
          await server.connect(transport);
          session = { server, transport };

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) sessions.delete(sid);
          };
        }

        const body = await readBody(req);
        await session.transport.handleRequest(req, res, body);

        // Track session after first successful request
        const sid = session.transport.sessionId;
        if (sid && !sessions.has(sid)) {
          sessions.set(sid, session);
        }
        return;
      }

      if (req.method === "GET") {
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (session) {
            await session.transport.handleRequest(req, res);
            return;
          }
        }
        jsonResponse(res, 404, { error: "Session not found" });
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (session) {
            await session.transport.handleRequest(req, res);
            sessions.delete(sessionId);
            return;
          }
        }
        jsonResponse(res, 404, { error: "Session not found" });
        return;
      }

      jsonResponse(res, 405, { error: "Method not allowed" });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`Arc MCP server (HTTP) running on http://0.0.0.0:${port}/mcp`);
  });
}

// ---- Main ----

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2));
  const transport = flags["transport"] ?? "stdio";
  const port = parseInt(flags["port"] ?? String(DEFAULT_PORT), 10);

  if (transport === "http") {
    // Resolve auth key: CLI flag > credential store
    let authKey = flags["auth-key"];
    if (!authKey) {
      try {
        const { getCredential } = await import("../../src/credentials.ts");
        authKey = (await getCredential("mcp-server", "auth_key")) ?? undefined;
      } catch {
        // Credential store unavailable — fall through to error
      }
    }
    if (!authKey) {
      console.error(
        "Error: HTTP transport requires an auth key.\n" +
        "Provide --auth-key FLAG or set credential: arc creds set --service mcp-server --key auth_key --value YOUR_KEY"
      );
      process.exit(1);
    }
    // Initialize DB once for all sessions
    initDatabase();
    await startHttp(port, authKey!);
  } else {
    const server = createServer();
    await startStdio(server);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
