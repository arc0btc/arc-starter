/**
 * Arc Server
 *
 * Bun HTTP server with health endpoint and task scheduler.
 * This is the heart of the Arc architecture - an always-running server
 * that orchestrates scheduled tasks, sensors, and channels.
 *
 * Pattern:
 * - Server runs continuously (not a cron job)
 * - Tasks are scheduled internally (not via systemd timer)
 * - Events flow through the event bus for observability
 * - Graceful shutdown on SIGTERM/SIGINT
 */

import { Hono } from "hono";
import { eventBus } from "./events";
import { scheduler } from "./scheduler";
import {
  queryRecentCyclesAPI,
  queryLearningsAPI,
  queryEventsAPI,
} from "../query-tools/memory-query";

/**
 * HTTP server application
 */
const app = new Hono();

/**
 * Health endpoint
 * Returns server status and uptime
 */
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    uptime: process.uptime(),
    tasks: scheduler.list(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Root endpoint
 * Returns server info
 */
app.get("/", (c) => {
  return c.json({
    name: "Arc Starter",
    version: "1.0.0",
    description: "Autonomous agent server template",
    endpoints: {
      health: "/health",
      memory: {
        cycles: "/api/memory/cycles",
        learnings: "/api/memory/learnings",
        events: "/api/memory/events",
      },
    },
  });
});

/**
 * Memory API endpoints
 * Query the agent's SQLite memory from HTTP.
 */

/**
 * GET /api/memory/cycles
 * Query params: count (default 10)
 * Returns recent non-idle cycles with phase results and timing.
 */
app.get("/api/memory/cycles", (c) => {
  const count = parseInt(c.req.query("count") ?? "10", 10);
  return c.json(queryRecentCyclesAPI(count));
});

/**
 * GET /api/memory/learnings
 * Query params: search (optional text query), count (default 20)
 * With search: FTS5 BM25-ranked results.
 * Without search: top N by importance.
 */
app.get("/api/memory/learnings", (c) => {
  const search = c.req.query("search");
  const count = parseInt(c.req.query("count") ?? "20", 10);
  return c.json(queryLearningsAPI(search, count));
});

/**
 * GET /api/memory/events
 * Query params: type (optional event type filter), count (default 20)
 * Returns recent events from event_history, newest first.
 */
app.get("/api/memory/events", (c) => {
  const type = c.req.query("type");
  const count = parseInt(c.req.query("count") ?? "20", 10);
  return c.json(queryEventsAPI(type, count));
});

/**
 * Start the server
 */
export async function startServer(port: number = 3000): Promise<void> {
  // Start Bun HTTP server
  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  console.log(`\n🚀 Arc Server started on port ${port}`);
  console.log(`   Health check: http://localhost:${port}/health\n`);

  // Emit server started event
  eventBus.emit("server:started", {
    port,
    uptime: process.uptime(),
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n\n⚠️  Received ${signal}, shutting down gracefully...`);

    // Stop all scheduled tasks
    scheduler.stopAll();

    // Emit server stopped event
    eventBus.emit("server:stopped", {
      uptime: process.uptime(),
    });

    // Close server
    server.stop();

    console.log("✅ Shutdown complete\n");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
