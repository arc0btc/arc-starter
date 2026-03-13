#!/usr/bin/env bun

import {
  initDatabase,
  getPendingTasks,
  getActiveTasks,
  getTaskById,
} from "../../src/db.ts";
import { discoverSkills } from "../../src/skills.ts";
import type { Task } from "../../src/db.ts";

initDatabase();

const args = process.argv.slice(2);
const command = args[0];

if (command !== "serve") {
  console.log("Usage: arc skills run --name arc-mcp -- serve [--port PORT]");
  console.log("");
  console.log("Commands:");
  console.log("  serve    Start the MCP HTTP server (default port: 3100)");
  process.exit(1);
}

const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3100;

if (isNaN(port) || port < 1 || port > 65535) {
  console.error("Invalid port number");
  process.exit(1);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function taskSummary(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    skills: t.skills ? JSON.parse(t.skills) : [],
    source: t.source,
    created_at: t.created_at,
    scheduled_for: t.scheduled_for,
  };
}

const server = Bun.serve({
  port,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check
    if (path === "/health") {
      return jsonResponse({ status: "ok", uptime: process.uptime() });
    }

    // Single task by ID
    const taskMatch = path.match(/^\/tasks\/(\d+)$/);
    if (taskMatch) {
      const id = parseInt(taskMatch[1], 10);
      const task = getTaskById(id);
      if (!task) {
        return jsonResponse({ error: "Task not found" }, 404);
      }
      return jsonResponse(taskSummary(task));
    }

    // Task listing
    if (path === "/tasks") {
      const status = url.searchParams.get("status") || "pending";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

      let tasks: Task[];
      if (status === "pending") {
        tasks = getPendingTasks();
      } else if (status === "active") {
        tasks = getActiveTasks();
      } else {
        // For other statuses, use pending as default
        tasks = getPendingTasks();
      }

      const result = tasks.slice(0, limit).map(taskSummary);
      return jsonResponse({ count: result.length, tasks: result });
    }

    // Skill listing
    if (path === "/skills") {
      const skills = discoverSkills().map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        hasSensor: s.hasSensor,
        hasCli: s.hasCli,
        hasAgent: s.hasAgent,
      }));
      return jsonResponse({ count: skills.length, skills });
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
});

console.log(`arc-mcp server listening on http://localhost:${server.port}`);
