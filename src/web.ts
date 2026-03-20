// web.ts — Loom dashboard API server
//
// Read-only SQLite connection. Serves JSON API endpoints and static files from src/web/.
// Run: bun src/web.ts (or via arc skills run --name dashboard -- start)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { initDatabase, getDatabase, insertTask, markTaskFailed, getEmailThreads, getEmailMessagesByFromAddress, type EmailMessage } from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { IDENTITY } from "./identity.ts";

// ---- Database ----

// Initialize singleton database on startup
initDatabase();
const db = getDatabase();

// ---- Constants ----

const PORT = parseInt(process.env.ARC_WEB_PORT || "3000");
const STATIC_DIR = join(import.meta.dir, "web");
const HOOK_STATE_DIR = join(import.meta.dir, "../db/hook-state");
const SKILLS_DIR = join(import.meta.dir, "../skills");

const MAX_SSE_CLIENTS = 50;
const SSE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseCleanups = new WeakMap<ReadableStreamDefaultController<Uint8Array>, () => void>();

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ---- Email thread helpers ----

function normalizeSubjectForThreading(subject: string | null): string {
  if (!subject) return "(no subject)";
  return subject.replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "").trim().toLowerCase() || "(no subject)";
}

interface EmailThread {
  thread_key: string;
  from_address: string;
  from_name: string | null;
  normalized_subject: string;
  latest_subject: string | null;
  message_count: number;
  unread_count: number;
  last_received: string;
  over_threshold: boolean;
}

function buildThreads(rows: EmailMessage[]): EmailThread[] {
  const threadMap = new Map<string, EmailThread & { messages: EmailMessage[] }>();
  for (const msg of rows) {
    const normSubj = normalizeSubjectForThreading(msg.subject);
    const key = `${msg.from_address}:${normSubj}`;
    if (!threadMap.has(key)) {
      threadMap.set(key, {
        thread_key: key,
        from_address: msg.from_address,
        from_name: msg.from_name,
        normalized_subject: normSubj,
        latest_subject: msg.subject,
        message_count: 0,
        unread_count: 0,
        last_received: msg.received_at,
        over_threshold: false,
        messages: [],
      });
    }
    const thread = threadMap.get(key)!;
    thread.message_count++;
    if (msg.is_read === 0 && msg.folder === "inbox") thread.unread_count++;
    if (msg.received_at > thread.last_received) {
      thread.last_received = msg.received_at;
      thread.latest_subject = msg.subject;
      thread.from_name = msg.from_name ?? thread.from_name;
    }
    thread.messages.push(msg);
  }
  return [...threadMap.values()]
    .map(({ messages: _m, ...t }) => ({ ...t, over_threshold: t.message_count >= 15 }))
    .sort((a, b) => b.last_received.localeCompare(a.last_received));
}

function handleEmailThreads(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 2000);
  const rows = getEmailThreads(limit);
  const threads = buildThreads(rows);
  return json({ threads, total: threads.length });
}

function handleEmailThread(encodedKey: string): Response {
  const key = decodeURIComponent(encodedKey);
  const colonIdx = key.indexOf(":");
  if (colonIdx === -1) return errorResponse("Invalid thread key", 400);
  const fromAddress = key.slice(0, colonIdx);
  const normalizedSubject = key.slice(colonIdx + 1);
  const rows = getEmailMessagesByFromAddress(fromAddress);
  const messages = rows.filter(m => normalizeSubjectForThreading(m.subject) === normalizedSubject);
  return json({ thread_key: key, from_address: fromAddress, normalized_subject: normalizedSubject, message_count: messages.length, over_threshold: messages.length >= 15, messages });
}

// ---- API Handlers ----

function handleStatus(): Response {
  const pending = db.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'").get() as { count: number };
  const active = db.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'active'").get() as { count: number };
  const completedToday = db.query(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND date(completed_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { count: number };
  const failedToday = db.query(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND date(completed_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { count: number };

  const costs = db.query(
    "SELECT COALESCE(SUM(cost_usd), 0) as cost_today_usd, COALESCE(SUM(api_cost_usd), 0) as api_cost_today_usd FROM tasks WHERE date(created_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { cost_today_usd: number; api_cost_today_usd: number };

  const lastCycleRow = db.query(
    "SELECT started_at, task_id, duration_ms FROM cycle_log ORDER BY started_at DESC LIMIT 1"
  ).get() as { started_at: string; task_id: number | null; duration_ms: number | null } | null;

  const lastCycle = lastCycleRow
    ? { started_at: lastCycleRow.started_at, task_id: lastCycleRow.task_id, duration_ms: lastCycleRow.duration_ms }
    : null;

  // Uptime: hours since earliest pending/active task or first cycle today
  const firstCycleToday = db.query(
    "SELECT started_at FROM cycle_log WHERE date(started_at, '-7 hours') = date('now', '-7 hours') ORDER BY started_at ASC LIMIT 1"
  ).get() as { started_at: string } | null;

  let uptimeHours = 0;
  if (firstCycleToday) {
    const firstTime = new Date(firstCycleToday.started_at + "Z").getTime();
    uptimeHours = Math.round(((Date.now() - firstTime) / 3600000) * 10) / 10;
  }

  return json({
    pending: pending.count,
    active: active.count,
    completed_today: completedToday.count,
    failed_today: failedToday.count,
    cost_today_usd: Math.round(costs.cost_today_usd * 100) / 100,
    api_cost_today_usd: Math.round(costs.api_cost_today_usd * 100) / 100,
    last_cycle: lastCycle,
    uptime_hours: uptimeHours,
  });
}

function handleTasks(url: URL): Response {
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  let rows;
  if (status && q) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE status = ? AND subject LIKE ? ORDER BY priority ASC, id DESC LIMIT ?"
    ).all(status, `%${q}%`, limit);
  } else if (status) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE status = ? ORDER BY priority ASC, id DESC LIMIT ?"
    ).all(status, limit);
  } else if (q) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE subject LIKE ? ORDER BY id DESC LIMIT ?"
    ).all(`%${q}%`, limit);
  } else {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks ORDER BY id DESC LIMIT ?"
    ).all(limit);
  }

  return json({ tasks: rows });
}

function handleTaskById(id: string): Response {
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return errorResponse("Invalid task ID", 400);

  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return errorResponse("Task not found", 404);

  return json(task);
}

async function handleKillTask(req: Request, id: string): Promise<Response> {
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return errorResponse("Invalid task ID", 400);

  let body: { reason?: string };
  try {
    body = await req.json() as { reason?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return errorResponse("'reason' is required", 400);

  const task = db.query("SELECT id, status FROM tasks WHERE id = ?").get(taskId) as { id: number; status: string } | null;
  if (!task) return errorResponse("Task not found", 404);
  if (task.status !== "active" && task.status !== "pending") {
    return errorResponse(`Task is not active or pending (current status: ${task.status})`, 409);
  }

  markTaskFailed(taskId, reason);

  const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return json(updated);
}

function handleCycles(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 100);
  const cycles = db.query(
    "SELECT id, task_id, started_at, completed_at, duration_ms, cost_usd, api_cost_usd, tokens_in, tokens_out, skills_loaded FROM cycle_log ORDER BY started_at DESC LIMIT ?"
  ).all(limit);
  return json({ cycles });
}

function handleSensors(): Response {
  const sensors: Array<{
    name: string;
    description: string;
    interval_minutes: number | null;
    last_ran: string | null;
    last_result: string | null;
    version: number | null;
    consecutive_failures: number | null;
  }> = [];

  // Get skill metadata for sensor descriptions
  const skills = discoverSkills();
  const skillMap = new Map(skills.filter(s => s.hasSensor).map(s => [s.name, s]));

  // Read hook-state JSON files (skip orphaned entries with no matching skill)
  if (existsSync(HOOK_STATE_DIR)) {
    const files = readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const name = file.replace(".json", "");
      const skill = skillMap.get(name);
      if (!skill) continue; // skip stale hook-state from renamed/removed sensors

      try {
        const content = readFileSync(join(HOOK_STATE_DIR, file), "utf-8");
        const state = JSON.parse(content) as {
          last_ran: string;
          last_result: string;
          version: number;
          consecutive_failures: number;
        };

        // Try to parse interval from sensor.ts (INTERVAL_MINUTES constant)
        let interval: number | null = null;
        const sensorPath = join(skill.path, "sensor.ts");
        if (existsSync(sensorPath)) {
          const sensorContent = readFileSync(sensorPath, "utf-8");
          const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
          if (match) interval = parseInt(match[1], 10);
        }

        sensors.push({
          name,
          description: skill.description,
          interval_minutes: interval,
          last_ran: state.last_ran,
          last_result: state.last_result,
          version: state.version,
          consecutive_failures: state.consecutive_failures,
        });
      } catch {
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: null,
          last_ran: null,
          last_result: "error",
          version: null,
          consecutive_failures: null,
        });
      }
    }
  }

  // Also include sensors with a skill but no hook-state yet (never ran)
  for (const [name, skill] of skillMap) {
    if (!sensors.some(s => s.name === name)) {
      let interval: number | null = null;
      const sensorPath = join(skill.path, "sensor.ts");
      if (existsSync(sensorPath)) {
        const sensorContent = readFileSync(sensorPath, "utf-8");
        const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
        if (match) interval = parseInt(match[1], 10);
      }
      sensors.push({
        name,
        description: skill.description,
        interval_minutes: interval,
        last_ran: null,
        last_result: null,
        version: null,
        consecutive_failures: null,
      });
    }
  }

  sensors.sort((a, b) => a.name.localeCompare(b.name));
  return json({ sensors });
}

function handleSensorSchedule(): Response {
  // Get base sensor data (reuse handleSensors logic)
  const sensors: Array<{
    name: string;
    description: string;
    interval_minutes: number | null;
    last_ran: string | null;
    last_result: string | null;
    version: number | null;
    consecutive_failures: number | null;
    next_expected: string | null;
    task_count_24h: number;
    task_count_total: number;
    task_types: string[];
    hourly_activity: number[];
  }> = [];

  const skills = discoverSkills();
  const skillMap = new Map(skills.filter(s => s.hasSensor).map(s => [s.name, s]));

  // Query task counts per sensor source (last 24h and total)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const taskCounts24h = db.query(
    "SELECT source, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' AND created_at >= ? GROUP BY source"
  ).all(yesterday) as Array<{ source: string; cnt: number }>;

  const taskCountsTotal = db.query(
    "SELECT source, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' GROUP BY source"
  ).all() as Array<{ source: string; cnt: number }>;

  // Query hourly activity for last 24h (tasks created per hour per sensor)
  const hourlyRows = db.query(
    "SELECT source, strftime('%H', created_at) as hour, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' AND created_at >= ? GROUP BY source, hour"
  ).all(yesterday) as Array<{ source: string; hour: string; cnt: number }>;

  // Query distinct task subjects per sensor source (for task types)
  const taskTypeRows = db.query(
    "SELECT source, subject FROM tasks WHERE source LIKE 'sensor:%' GROUP BY source, subject"
  ).all() as Array<{ source: string; subject: string }>;

  // Build lookup maps: sensor name -> aggregated data
  // Sources can be "sensor:name" or "sensor:name:subsource"
  function sensorNameFromSource(source: string): string {
    const parts = source.replace("sensor:", "").split(":");
    return parts[0];
  }

  const count24hMap = new Map<string, number>();
  for (const row of taskCounts24h) {
    const name = sensorNameFromSource(row.source);
    count24hMap.set(name, (count24hMap.get(name) || 0) + row.cnt);
  }

  const countTotalMap = new Map<string, number>();
  for (const row of taskCountsTotal) {
    const name = sensorNameFromSource(row.source);
    countTotalMap.set(name, (countTotalMap.get(name) || 0) + row.cnt);
  }

  const hourlyMap = new Map<string, number[]>();
  for (const row of hourlyRows) {
    const name = sensorNameFromSource(row.source);
    if (!hourlyMap.has(name)) hourlyMap.set(name, new Array(24).fill(0));
    const hours = hourlyMap.get(name)!;
    hours[parseInt(row.hour, 10)] += row.cnt;
  }

  const typeMap = new Map<string, Set<string>>();
  for (const row of taskTypeRows) {
    const name = sensorNameFromSource(row.source);
    if (!typeMap.has(name)) typeMap.set(name, new Set());
    typeMap.get(name)!.add(row.subject);
  }

  // Build sensor entries from hook-state files
  if (existsSync(HOOK_STATE_DIR)) {
    const files = readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const name = file.replace(".json", "");
      const skill = skillMap.get(name);
      if (!skill) continue;

      try {
        const content = readFileSync(join(HOOK_STATE_DIR, file), "utf-8");
        const state = JSON.parse(content) as {
          last_ran: string;
          last_result: string;
          version: number;
          consecutive_failures: number;
        };

        let interval: number | null = null;
        const sensorPath = join(skill.path, "sensor.ts");
        if (existsSync(sensorPath)) {
          const sensorContent = readFileSync(sensorPath, "utf-8");
          const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
          if (match) interval = parseInt(match[1], 10);
        }

        let nextExpected: string | null = null;
        if (state.last_ran && interval) {
          const lastRan = new Date(state.last_ran.endsWith("Z") ? state.last_ran : state.last_ran + "Z");
          nextExpected = new Date(lastRan.getTime() + interval * 60000).toISOString();
        }

        const types = typeMap.get(name);
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: interval,
          last_ran: state.last_ran,
          last_result: state.last_result,
          version: state.version,
          consecutive_failures: state.consecutive_failures,
          next_expected: nextExpected,
          task_count_24h: count24hMap.get(name) || 0,
          task_count_total: countTotalMap.get(name) || 0,
          task_types: types ? Array.from(types).slice(0, 5) : [],
          hourly_activity: hourlyMap.get(name) || new Array(24).fill(0),
        });
      } catch {
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: null,
          last_ran: null,
          last_result: "error",
          version: null,
          consecutive_failures: null,
          next_expected: null,
          task_count_24h: count24hMap.get(name) || 0,
          task_count_total: countTotalMap.get(name) || 0,
          task_types: [],
          hourly_activity: new Array(24).fill(0),
        });
      }
    }
  }

  // Include sensors with no hook-state yet
  for (const [name, skill] of skillMap) {
    if (!sensors.some(s => s.name === name)) {
      let interval: number | null = null;
      const sensorPath = join(skill.path, "sensor.ts");
      if (existsSync(sensorPath)) {
        const sensorContent = readFileSync(sensorPath, "utf-8");
        const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
        if (match) interval = parseInt(match[1], 10);
      }
      sensors.push({
        name,
        description: skill.description,
        interval_minutes: interval,
        last_ran: null,
        last_result: null,
        version: null,
        consecutive_failures: null,
        next_expected: null,
        task_count_24h: 0,
        task_count_total: 0,
        task_types: [],
        hourly_activity: new Array(24).fill(0),
      });
    }
  }

  sensors.sort((a, b) => a.name.localeCompare(b.name));
  return json({ sensors, generated_at: now.toISOString() });
}

function handleSkills(): Response {
  const skills = discoverSkills();

  // Count how often each skill is referenced in tasks (skills JSON array)
  const usageRows = db.query(
    "SELECT skills FROM tasks WHERE skills IS NOT NULL AND skills != '[]' AND skills != ''"
  ).all() as Array<{ skills: string }>;

  const usageMap = new Map<string, number>();
  for (const row of usageRows) {
    try {
      const arr = JSON.parse(row.skills) as string[];
      for (const name of arr) {
        usageMap.set(name, (usageMap.get(name) || 0) + 1);
      }
    } catch { /* skip malformed */ }
  }

  const result = skills.map(s => ({
    name: s.name,
    description: s.description,
    tags: s.tags,
    has_sensor: s.hasSensor,
    has_cli: s.hasCli,
    has_agent: s.hasAgent,
    usage_count: usageMap.get(s.name) || 0,
  }));
  return json({ skills: result });
}

function handleCosts(url: URL): Response {
  const range = url.searchParams.get("range") || "day";

  let rows;
  if (range === "week") {
    rows = db.query(`
      SELECT
        strftime('%Y-%m-%d %H:00', started_at, '-7 hours') as hour,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COALESCE(SUM(api_cost_usd), 0) as api_cost_usd,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out,
        COUNT(*) as cycles
      FROM cycle_log
      WHERE datetime(started_at) >= datetime('now', '-7 days')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();
  } else {
    rows = db.query(`
      SELECT
        strftime('%Y-%m-%d %H:00', started_at, '-7 hours') as hour,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COALESCE(SUM(api_cost_usd), 0) as api_cost_usd,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out,
        COUNT(*) as cycles
      FROM cycle_log
      WHERE date(started_at, '-7 hours') = date('now', '-7 hours')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();
  }

  return json({ range, costs: rows });
}

function handleIdentity(): Response {
  return json(IDENTITY);
}

// ---- Bitcoin Face Avatar ----

const FACE_CACHE_DIR = join(import.meta.dir, "../db");

async function handleFace(): Promise<Response> {
  const bnsPrefix = IDENTITY.bns.replace(/\.btc$/, "");
  // Check for cached face in either format
  const svgPath = join(FACE_CACHE_DIR, `face-${bnsPrefix}.svg`);
  const pngPath = join(FACE_CACHE_DIR, `face-${bnsPrefix}.png`);

  // Serve cached SVG first, then PNG
  if (existsSync(svgPath)) {
    return new Response(readFileSync(svgPath), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (existsSync(pngPath)) {
    const content = readFileSync(pngPath);
    // Detect if the "png" file is actually SVG (legacy cache)
    const isSvg = content.length > 4 && content.slice(0, 100).toString().includes("<svg");
    return new Response(content, {
      headers: {
        "Content-Type": isSvg ? "image/svg+xml" : "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Fetch and cache from bitcoinfaces.xyz
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://bitcoinfaces.xyz/api/get-image?name=${bnsPrefix}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return errorResponse("Face not found", 404);

    const contentType = res.headers.get("content-type") || "image/png";
    const isSvg = contentType.includes("svg");
    const ext = isSvg ? "svg" : "png";
    const buf = await res.arrayBuffer();
    writeFileSync(join(FACE_CACHE_DIR, `face-${bnsPrefix}.${ext}`), Buffer.from(buf));

    return new Response(Buffer.from(buf), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return errorResponse("Failed to fetch face", 502);
  }
}

function handleReputation(): Response {
  try {
    // Check if reviews table exists (created by arc-reputation skill on first use)
    const tableExists = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='reviews'"
    ).get() as { name: string } | null;

    if (!tableExists) {
      return json({
        submitted: { count: 0, recent: [] },
        received: { count: 0, avg_rating: null, recent: [] },
        btc_address: IDENTITY.btc,
        stx_address: IDENTITY.stx,
      });
    }

    const arc_btc = IDENTITY.btc;

    const submittedCount = db.query(
      "SELECT COUNT(*) as count FROM reviews WHERE reviewer_address = ?"
    ).get(arc_btc) as { count: number };

    const submittedRecent = db.query(
      "SELECT id, subject, reviewee_address, rating, comment, tags, created_at FROM reviews WHERE reviewer_address = ? ORDER BY created_at DESC LIMIT 5"
    ).all(arc_btc) as Array<{ id: number; subject: string; reviewee_address: string; rating: number; comment: string; tags: string; created_at: string }>;

    const receivedCount = db.query(
      "SELECT COUNT(*) as count FROM reviews WHERE reviewee_address = ?"
    ).get(arc_btc) as { count: number };

    const receivedRecent = db.query(
      "SELECT id, subject, reviewer_address, rating, comment, tags, created_at FROM reviews WHERE reviewee_address = ? ORDER BY created_at DESC LIMIT 5"
    ).all(arc_btc) as Array<{ id: number; subject: string; reviewer_address: string; rating: number; comment: string; tags: string; created_at: string }>;

    const receivedAvg = db.query(
      "SELECT AVG(rating) as avg FROM reviews WHERE reviewee_address = ?"
    ).get(arc_btc) as { avg: number | null };

    return json({
      submitted: {
        count: submittedCount.count,
        recent: submittedRecent.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
      },
      received: {
        count: receivedCount.count,
        avg_rating: receivedAvg.avg !== null ? Math.round(receivedAvg.avg * 100) / 100 : null,
        recent: receivedRecent.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
      },
      btc_address: IDENTITY.btc,
      stx_address: IDENTITY.stx,
    });
  } catch {
    return json({
      submitted: { count: 0, recent: [] },
      received: { count: 0, avg_rating: null, recent: [] },
      btc_address: IDENTITY.btc,
      stx_address: IDENTITY.stx,
    });
  }
}

// ---- POST /api/tasks: Agent-to-agent task creation ----

const TASK_API_DAILY_LIMIT = 50;
const taskApiDayCounts = new Map<string, { day: string; count: number }>();

function checkTaskApiRateLimit(sourceIp: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = taskApiDayCounts.get(sourceIp);
  if (!entry || entry.day !== today) {
    taskApiDayCounts.set(sourceIp, { day: today, count: 0 });
    return true;
  }
  return entry.count < TASK_API_DAILY_LIMIT;
}

function incrementTaskApiCount(sourceIp: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const entry = taskApiDayCounts.get(sourceIp);
  if (!entry || entry.day !== today) {
    taskApiDayCounts.set(sourceIp, { day: today, count: 1 });
  } else {
    entry.count++;
  }
}

async function handlePostTask(req: Request): Promise<Response> {
  const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  if (!checkTaskApiRateLimit(sourceIp)) {
    return json({
      error: "Daily task creation limit reached",
      code: "RATE_LIMITED",
      limit: TASK_API_DAILY_LIMIT,
    }, 429);
  }

  let body: {
    subject?: string;
    priority?: number;
    description?: string;
    skills?: string[];
    source?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // Validate subject
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return errorResponse("'subject' is required", 400);
  if (subject.length > 500) return errorResponse("Subject too long (max 500 chars)", 400);

  // Validate source (required for agent-to-agent)
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) return errorResponse("'source' is required (e.g. 'agent:spark', 'agent:iris')", 400);
  if (source.length > 200) return errorResponse("Source too long (max 200 chars)", 400);

  // Validate priority
  let priority = 5;
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 1 || body.priority > 10) {
      return errorResponse("'priority' must be an integer 1-10", 400);
    }
    priority = body.priority;
  }

  // Validate description
  let description: string | undefined;
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return errorResponse("'description' must be a string", 400);
    if (body.description.length > 5000) return errorResponse("Description too long (max 5000 chars)", 400);
    description = body.description.trim() || undefined;
  }

  // Validate skills
  let skills: string | undefined;
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || !body.skills.every((s): s is string => typeof s === "string")) {
      return errorResponse("'skills' must be an array of strings", 400);
    }
    if (body.skills.length > 10) return errorResponse("Too many skills (max 10)", 400);
    skills = JSON.stringify(body.skills);
  }

  const taskId = insertTask({
    subject,
    description,
    skills,
    priority,
    source,
  });

  incrementTaskApiCount(sourceIp);

  const task = db.query(
    "SELECT id, subject, description, skills, priority, status, source, created_at FROM tasks WHERE id = ?"
  ).get(taskId);

  return json(task, 201);
}

async function handlePostMessage(req: Request): Promise<Response> {
  let body: { message?: string; priority?: number; parent_id?: number };
  try {
    body = await req.json() as { message?: string; priority?: number; parent_id?: number };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return errorResponse("Message is required", 400);
  if (message.length > 1000) return errorResponse("Message too long (max 1000 chars)", 400);

  const parentId = typeof body.parent_id === "number" && Number.isInteger(body.parent_id) && body.parent_id > 0
    ? body.parent_id
    : undefined;

  if (parentId !== undefined) {
    const parent = db.query("SELECT id FROM tasks WHERE id = ?").get(parentId);
    if (!parent) return errorResponse("Parent task not found", 404);
  }

  const taskId = insertTask({
    subject: message,
    source: parentId ? `human:web:re:${parentId}` : "human:web",
    parent_id: parentId,
    priority: 1,
  });

  const task = db.query("SELECT id, subject, priority, status, source, parent_id, created_at FROM tasks WHERE id = ?").get(taskId);
  return json(task, 201);
}

// ---- SSE ----

function handleEvents(): Response {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    console.log(`[SSE] Connection rejected: limit reached (${sseClients.size}/${MAX_SSE_CLIENTS})`);
    return new Response("Too many connections", { status: 503 });
  }

  let lastTaskId = (db.query("SELECT MAX(id) as max_id FROM tasks").get() as { max_id: number | null })?.max_id ?? 0;
  let lastCycleId = (db.query("SELECT MAX(id) as max_id FROM cycle_log").get() as { max_id: number | null })?.max_id ?? 0;

  // Track sensor hook-state mtimes for sensor:ran events
  const sensorMtimes = new Map<string, number>();
  if (existsSync(HOOK_STATE_DIR)) {
    for (const file of readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"))) {
      try {
        const mtime = statSync(join(HOOK_STATE_DIR, file)).mtimeMs;
        sensorMtimes.set(file, mtime);
      } catch { /* skip */ }
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      sseClients.add(controller);
      console.log(`[SSE] Client connected (${sseClients.size}/${MAX_SSE_CLIENTS} active)`);

      const encoder = new TextEncoder();

      const send = (event: string, data: unknown): boolean => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          // Controller closed — client disconnected; trigger cleanup
          const fn = sseCleanups.get(controller);
          fn?.();
          return false;
        }
      };

      // Send initial heartbeat
      send("heartbeat", { time: new Date().toISOString() });

      const refs = {
        interval: null as ReturnType<typeof setInterval> | null,
        timeout: null as ReturnType<typeof setTimeout> | null,
      };

      refs.interval = setInterval(() => {
        try {
          // Heartbeat — also detects dead connections early
          if (!send("heartbeat", { time: new Date().toISOString() })) return;

          // Check for new tasks and status changes (single query to avoid double-sends)
          const newTasks = db.query(
            "SELECT id, subject, status, priority, source, created_at FROM tasks WHERE id > ? ORDER BY id ASC"
          ).all(lastTaskId) as Array<{ id: number; subject: string; status: string; priority: number; source: string | null; created_at: string }>;

          for (const task of newTasks) {
            if (task.status === "completed") {
              send("task:completed", task);
            } else if (task.status === "failed") {
              send("task:failed", task);
            } else {
              send("task:created", task);
            }
            lastTaskId = task.id;
          }

          // Check for new cycles
          const newCycles = db.query(
            "SELECT id, task_id, started_at, completed_at, duration_ms, cost_usd FROM cycle_log WHERE id > ? ORDER BY id ASC"
          ).all(lastCycleId) as Array<{ id: number; task_id: number | null; started_at: string; completed_at: string | null; duration_ms: number | null; cost_usd: number }>;

          for (const cycle of newCycles) {
            send(cycle.completed_at ? "cycle:completed" : "cycle:started", cycle);
            lastCycleId = cycle.id;
          }

          // Check for sensor activity (hook-state file mtime changes)
          if (existsSync(HOOK_STATE_DIR)) {
            for (const file of readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"))) {
              try {
                const filePath = join(HOOK_STATE_DIR, file);
                const mtime = statSync(filePath).mtimeMs;
                const prev = sensorMtimes.get(file);
                if (prev !== undefined && mtime > prev) {
                  const name = file.replace(".json", "");
                  const state = JSON.parse(readFileSync(filePath, "utf-8")) as { last_ran: string; last_result: string };
                  send("sensor:ran", { name, last_ran: state.last_ran, last_result: state.last_result });
                }
                sensorMtimes.set(file, mtime);
              } catch { /* skip */ }
            }
          }
        } catch {
          // DB might be busy, skip this tick
        }
      }, 5000);

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (refs.interval) clearInterval(refs.interval);
        if (refs.timeout) clearTimeout(refs.timeout);
        sseClients.delete(controller);
        console.log(`[SSE] Client disconnected (${sseClients.size}/${MAX_SSE_CLIENTS} active)`);
      };

      sseCleanups.set(controller, cleanup);

      refs.timeout = setTimeout(() => {
        send("timeout", { time: new Date().toISOString() });
        try { controller.close(); } catch { /* already closed */ }
        cleanup();
      }, SSE_TIMEOUT_MS);
    },
    cancel(controller) {
      const cleanup = sseCleanups.get(controller);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ---- Static file serving ----

function serveStatic(pathname: string): Response | null {
  // Default to index.html
  const filePath = pathname === "/" ? join(STATIC_DIR, "index.html") : join(STATIC_DIR, pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const file = Bun.file(filePath);

  const cacheHeader = [".html", ".js", ".css"].includes(ext)
    ? "no-cache"
    : "public, max-age=3600";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheHeader,
    },
  });
}

// ---- Router ----

function route(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // POST routes
  if (method === "POST" && path === "/api/tasks") return handlePostTask(req);
  if (method === "POST" && path === "/api/messages") return handlePostMessage(req);

  // Email thread API
  if (path === "/api/email/threads") return handleEmailThreads(url);
  const emailThreadMatch = path.match(/^\/api\/email\/threads\/(.+)$/);
  if (emailThreadMatch) return handleEmailThread(emailThreadMatch[1]);

  // API routes
  if (path === "/api/status") return handleStatus();
  if (path === "/api/tasks") return handleTasks(url);
  if (path === "/api/cycles") return handleCycles(url);
  if (path === "/api/sensors") return handleSensors();
  if (path === "/api/sensors/schedule") return handleSensorSchedule();
  if (path === "/api/skills") return handleSkills();
  if (path === "/api/costs") return handleCosts(url);
  if (path === "/api/identity") return handleIdentity();
  if (path === "/api/face") return handleFace();
  if (path === "/api/reputation") return handleReputation();
  if (path === "/api/events") return handleEvents();

  // Task kill: POST /api/tasks/:id/kill
  const killMatch = path.match(/^\/api\/tasks\/(\d+)\/kill$/);
  if (method === "POST" && killMatch) return handleKillTask(req, killMatch[1]);

  // Task by ID: /api/tasks/:id
  const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) return handleTaskById(taskMatch[1]);

  // Clean URL routing for multi-page app
  if (path === "/sensors" || path === "/sensors/schedule" || path === "/skills" || path === "/identity" || path === "/email") {
    const htmlPath = join(STATIC_DIR, path + ".html");
    if (existsSync(htmlPath)) {
      return new Response(Bun.file(htmlPath), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // Static files
  const staticResponse = serveStatic(path);
  if (staticResponse) return staticResponse;

  // 404
  return errorResponse("Not found", 404);
}

// ---- Server ----

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: route,
});

console.log(`Loom dashboard running on http://0.0.0.0:${server.port}`);
