// skills/agent-hub/schema.ts
// Agent hub schema: hub_agents, hub_capabilities, hub_task_routes
// Importable by other skills for agent lookup and routing.

import { initDatabase, getDatabase, toSqliteDatetime } from "../../src/db";

// ---- Types ----

export interface HubAgent {
  id: number;
  agent_name: string;
  display_name: string | null;
  ip_address: string;
  stx_address: string | null;
  btc_address: string | null;
  bns_name: string | null;
  status: string;           // "online" | "offline" | "degraded"
  version: string | null;
  skill_count: number;
  sensor_count: number;
  pending_tasks: number;
  active_tasks: number;
  cost_today_usd: number;
  last_heartbeat: string | null;
  registered_at: string;
  updated_at: string;
}

export interface InsertHubAgent {
  agent_name: string;
  display_name?: string | null;
  ip_address: string;
  stx_address?: string | null;
  btc_address?: string | null;
  bns_name?: string | null;
  status?: string;
  version?: string | null;
  skill_count?: number;
  sensor_count?: number;
  pending_tasks?: number;
  active_tasks?: number;
  cost_today_usd?: number;
}

export interface HubCapability {
  id: number;
  agent_name: string;
  skill_name: string;
  has_sensor: number;
  has_cli: number;
  has_agent_md: number;
  tags: string | null;       // JSON array
  registered_at: string;
}

export interface InsertHubCapability {
  agent_name: string;
  skill_name: string;
  has_sensor?: number;
  has_cli?: number;
  has_agent_md?: number;
  tags?: string | null;
}

export interface HubTaskRoute {
  id: number;
  task_id: number;
  from_agent: string;
  to_agent: string;
  skill_match: string | null;
  reason: string | null;
  routed_at: string;
}

// ---- Schema init ----

let _initialized = false;

export function initHubSchema(): void {
  if (_initialized) return;
  initDatabase();
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS hub_agents (
      id INTEGER PRIMARY KEY,
      agent_name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      ip_address TEXT NOT NULL,
      stx_address TEXT,
      btc_address TEXT,
      bns_name TEXT,
      status TEXT DEFAULT 'offline',
      version TEXT,
      skill_count INTEGER DEFAULT 0,
      sensor_count INTEGER DEFAULT 0,
      pending_tasks INTEGER DEFAULT 0,
      active_tasks INTEGER DEFAULT 0,
      cost_today_usd REAL DEFAULT 0,
      last_heartbeat TEXT,
      registered_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_agents_name ON hub_agents(agent_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_agents_status ON hub_agents(status)");

  db.run(`
    CREATE TABLE IF NOT EXISTS hub_capabilities (
      id INTEGER PRIMARY KEY,
      agent_name TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      has_sensor INTEGER DEFAULT 0,
      has_cli INTEGER DEFAULT 0,
      has_agent_md INTEGER DEFAULT 0,
      tags TEXT,
      registered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(agent_name, skill_name)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_caps_agent ON hub_capabilities(agent_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_caps_skill ON hub_capabilities(skill_name)");

  db.run(`
    CREATE TABLE IF NOT EXISTS hub_task_routes (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      skill_match TEXT,
      reason TEXT,
      routed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_routes_task ON hub_task_routes(task_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_hub_routes_to ON hub_task_routes(to_agent)");

  _initialized = true;
}

// ---- Agent queries ----

export function getAllHubAgents(): HubAgent[] {
  initHubSchema();
  const db = getDatabase();
  return db.query("SELECT * FROM hub_agents ORDER BY agent_name ASC").all() as HubAgent[];
}

export function getHubAgent(agentName: string): HubAgent | null {
  initHubSchema();
  const db = getDatabase();
  return db.query("SELECT * FROM hub_agents WHERE agent_name = ?").get(agentName) as HubAgent | null;
}

export function upsertHubAgent(fields: InsertHubAgent): void {
  initHubSchema();
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());

  const existing = getHubAgent(fields.agent_name);
  if (existing) {
    db.query(`
      UPDATE hub_agents SET
        display_name = COALESCE(?, display_name),
        ip_address = ?,
        stx_address = COALESCE(?, stx_address),
        btc_address = COALESCE(?, btc_address),
        bns_name = COALESCE(?, bns_name),
        status = COALESCE(?, status),
        version = COALESCE(?, version),
        skill_count = COALESCE(?, skill_count),
        sensor_count = COALESCE(?, sensor_count),
        pending_tasks = COALESCE(?, pending_tasks),
        active_tasks = COALESCE(?, active_tasks),
        cost_today_usd = COALESCE(?, cost_today_usd),
        last_heartbeat = ?,
        updated_at = ?
      WHERE agent_name = ?
    `).run(
      fields.display_name ?? null,
      fields.ip_address,
      fields.stx_address ?? null,
      fields.btc_address ?? null,
      fields.bns_name ?? null,
      fields.status ?? null,
      fields.version ?? null,
      fields.skill_count ?? null,
      fields.sensor_count ?? null,
      fields.pending_tasks ?? null,
      fields.active_tasks ?? null,
      fields.cost_today_usd ?? null,
      now,
      now,
      fields.agent_name,
    );
  } else {
    db.query(`
      INSERT INTO hub_agents (agent_name, display_name, ip_address, stx_address, btc_address, bns_name, status, version, skill_count, sensor_count, pending_tasks, active_tasks, cost_today_usd, last_heartbeat, registered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fields.agent_name,
      fields.display_name ?? null,
      fields.ip_address,
      fields.stx_address ?? null,
      fields.btc_address ?? null,
      fields.bns_name ?? null,
      fields.status ?? "online",
      fields.version ?? null,
      fields.skill_count ?? 0,
      fields.sensor_count ?? 0,
      fields.pending_tasks ?? 0,
      fields.active_tasks ?? 0,
      fields.cost_today_usd ?? 0,
      now,
      now,
      now,
    );
  }
}

export function updateAgentStatus(agentName: string, status: string): void {
  initHubSchema();
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.query("UPDATE hub_agents SET status = ?, updated_at = ? WHERE agent_name = ?").run(status, now, agentName);
}

// ---- Capability queries ----

export function getHubCapabilities(agentName: string): HubCapability[] {
  initHubSchema();
  const db = getDatabase();
  return db.query("SELECT * FROM hub_capabilities WHERE agent_name = ? ORDER BY skill_name ASC").all(agentName) as HubCapability[];
}

export function upsertHubCapability(fields: InsertHubCapability): void {
  initHubSchema();
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.query(`
    INSERT INTO hub_capabilities (agent_name, skill_name, has_sensor, has_cli, has_agent_md, tags, registered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_name, skill_name) DO UPDATE SET
      has_sensor = excluded.has_sensor,
      has_cli = excluded.has_cli,
      has_agent_md = excluded.has_agent_md,
      tags = excluded.tags,
      registered_at = excluded.registered_at
  `).run(
    fields.agent_name,
    fields.skill_name,
    fields.has_sensor ?? 0,
    fields.has_cli ?? 0,
    fields.has_agent_md ?? 0,
    fields.tags ?? null,
    now,
  );
}

export function replaceAgentCapabilities(agentName: string, capabilities: InsertHubCapability[]): void {
  initHubSchema();
  const db = getDatabase();
  db.query("DELETE FROM hub_capabilities WHERE agent_name = ?").run(agentName);
  for (const cap of capabilities) {
    upsertHubCapability({ ...cap, agent_name: agentName });
  }
}

export function findAgentForSkill(skillName: string): HubCapability[] {
  initHubSchema();
  const db = getDatabase();
  return db.query(`
    SELECT c.* FROM hub_capabilities c
    JOIN hub_agents a ON a.agent_name = c.agent_name
    WHERE c.skill_name = ? AND a.status = 'online'
    ORDER BY a.pending_tasks ASC
  `).all(skillName) as HubCapability[];
}

export function getAllCapabilities(): HubCapability[] {
  initHubSchema();
  const db = getDatabase();
  return db.query("SELECT * FROM hub_capabilities ORDER BY agent_name, skill_name").all() as HubCapability[];
}

// ---- Routing queries ----

export function insertTaskRoute(taskId: number, fromAgent: string, toAgent: string, skillMatch: string | null, reason: string | null): number {
  initHubSchema();
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  const result = db.query(
    "INSERT INTO hub_task_routes (task_id, from_agent, to_agent, skill_match, reason, routed_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(taskId, fromAgent, toAgent, skillMatch, reason, now);
  return Number(result.lastInsertRowid);
}

export function getRoutingStats(): { to_agent: string; route_count: number }[] {
  initHubSchema();
  const db = getDatabase();
  return db.query(`
    SELECT to_agent, COUNT(*) as route_count
    FROM hub_task_routes
    WHERE date(routed_at) >= date('now', '-7 days')
    GROUP BY to_agent
    ORDER BY route_count DESC
  `).all() as { to_agent: string; route_count: number }[];
}

export function getRecentRoutes(limit: number = 20): HubTaskRoute[] {
  initHubSchema();
  const db = getDatabase();
  return db.query("SELECT * FROM hub_task_routes ORDER BY routed_at DESC LIMIT ?").all(limit) as HubTaskRoute[];
}

// ---- Health ----

export function getFleetHealth(): { total: number; online: number; offline: number; degraded: number } {
  initHubSchema();
  const db = getDatabase();
  const rows = db.query(`
    SELECT status, COUNT(*) as count FROM hub_agents GROUP BY status
  `).all() as { status: string; count: number }[];

  const result = { total: 0, online: 0, offline: 0, degraded: 0 };
  for (const row of rows) {
    result.total += row.count;
    if (row.status === "online") result.online = row.count;
    else if (row.status === "offline") result.offline = row.count;
    else if (row.status === "degraded") result.degraded = row.count;
  }
  return result;
}
