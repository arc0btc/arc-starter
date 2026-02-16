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
    },
  });
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
