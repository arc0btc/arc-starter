import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { AGENT_NAME } from "./identity.ts";

// ---- Types ----

export interface Task {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;         // JSON array: ["arc-skill-manager", "stacks-js"]
  priority: number;
  status: string;                // pending|active|completed|failed|blocked
  source: string | null;         // "human", "sensor:aibtc-heartbeat", "task:42"
  parent_id: number | null;
  template: string | null;
  scheduled_for: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  result_detail: string | null;
  cost_usd: number;
  api_cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  attempt_count: number;
  max_retries: number;
  model: string | null;
  assigned_to: string | null;
}

export interface InsertTask {
  subject: string;
  description?: string | null;
  skills?: string | null;
  priority?: number;
  status?: string;
  source?: string | null;
  parent_id?: number | null;
  template?: string | null;
  scheduled_for?: string | null;
  model?: string | null;
  assigned_to?: string | null;
}

export interface CycleLog {
  id: number;
  task_id: number | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number;
  api_cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  skills_loaded: string | null;
  skill_hashes: string | null;
  security_grade: string | null;
  model: string | null;
}

export interface InsertCycleLog {
  started_at: string;
  task_id?: number | null;
  skills_loaded?: string | null;
  skill_hashes?: string | null;
  model?: string | null;
}

export interface SkillVersion {
  hash: string;
  skill_name: string;
  content: string;
  first_seen: string;
  last_seen: string;
}

// ---- Workflow types ----

export interface Workflow {
  id: number;
  template: string;
  instance_key: string;
  current_state: string;
  context: string; // JSON string
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface InsertWorkflow {
  template: string;
  instance_key: string;
  current_state: string;
  context?: string | null;
}

// ---- AIBTC inbox types ----

export interface AibtcInboxMessage {
  id: number;
  message_id: string;
  from_address: string;
  to_btc_address: string;
  to_stx_address: string;
  content: string | null;
  payment_txid: string | null;
  payment_satoshis: number;
  sent_at: string;
  authenticated: number;
  replied_at: string | null;
  read_at: string | null;
  direction: string;
  peer_btc_address: string | null;
  peer_display_name: string | null;
  synced_at: string;
}

// ---- Email types ----

export interface EmailMessage {
  id: number;
  remote_id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  folder: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  body_preview: string | null;
  is_read: number;
  received_at: string;
  synced_at: string;
}

// ---- Task dependency types ----

export type TaskDepType = "blocks" | "related" | "discovered-from";

export interface TaskDep {
  id: number;
  from_id: number;
  to_id: number;
  dep_type: TaskDepType;
  created_at: string;
}

// ---- Monitored endpoint types ----

export interface MonitoredEndpoint {
  id: number;
  endpoint_url: string;
  label: string | null;
  tier: string;                          // basic|pro
  check_interval_minutes: number;
  alert_webhook: string | null;
  owner_address: string | null;          // STX address of the payer
  status: string;                        // active|paused|expired
  created_at: string;
  expires_at: string | null;
  last_checked_at: string | null;
  last_status: string | null;            // healthy|degraded|down
  last_response_ms: number | null;
  consecutive_failures: number;
}

export interface InsertMonitoredEndpoint {
  endpoint_url: string;
  label?: string | null;
  tier?: string;
  check_interval_minutes?: number;
  alert_webhook?: string | null;
  owner_address?: string | null;
  expires_at?: string | null;
}

// ---- Market position types ----

export interface MarketPosition {
  id: number;
  market_id: string;            // epoch millisecond timestamp (on-chain ID)
  mongo_id: string | null;      // MongoDB _id for API lookups
  market_title: string;
  side: string;                 // 'yes' or 'no'
  action: string;               // 'buy', 'sell', 'redeem'
  shares: number;
  cost_ustx: number;            // cost (for buys) or proceeds (for sells/redeems)
  txid: string | null;
  status: string;               // 'pending', 'confirmed', 'failed'
  created_at: string;
}

export interface InsertMarketPosition {
  market_id: string;
  mongo_id?: string | null;
  market_title: string;
  side: string;
  action: string;
  shares: number;
  cost_ustx: number;
  txid?: string | null;
  status?: string;
}

// ---- Singleton ----

let _db: Database | null = null;

// ---- Helpers ----

/**
 * Converts a Date object to SQLite datetime format: "YYYY-MM-DD HH:MM:SS".
 */
export function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

// ---- Database lifecycle ----

export function initDatabase(): Database {
  if (_db !== null) return _db;

  mkdirSync("db", { recursive: true });

  const db = new Database("db/arc.sqlite");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      subject TEXT NOT NULL,
      description TEXT,
      skills TEXT,
      priority INTEGER DEFAULT 5,
      status TEXT DEFAULT 'pending',
      source TEXT,
      parent_id INTEGER,
      template TEXT,
      scheduled_for TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      result_summary TEXT,
      result_detail TEXT,
      cost_usd REAL DEFAULT 0,
      api_cost_usd REAL DEFAULT 0,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      attempt_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      FOREIGN KEY (parent_id) REFERENCES tasks(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cycle_log (
      id INTEGER PRIMARY KEY,
      task_id INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      cost_usd REAL DEFAULT 0,
      api_cost_usd REAL DEFAULT 0,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      skills_loaded TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  // Safe migration helper: only swallows "duplicate column name" errors
  function addColumn(table: string, column: string, type: string): void {
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("duplicate column name")) return;
      throw err;
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS skill_versions (
      hash TEXT PRIMARY KEY,
      skill_name TEXT NOT NULL,
      content TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_skill_versions_name ON skill_versions(skill_name)");

  // Migrations
  addColumn("cycle_log", "security_grade", "TEXT");
  addColumn("tasks", "model", "TEXT");
  addColumn("cycle_log", "model", "TEXT");
  addColumn("cycle_log", "skill_hashes", "TEXT");
  addColumn("tasks", "assigned_to", "TEXT");

  // Indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cycle_log_started_at ON cycle_log(started_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_source_status ON tasks(source, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to, status)");

  db.run(`
    CREATE TABLE IF NOT EXISTS email_messages (
      id INTEGER PRIMARY KEY,
      remote_id TEXT UNIQUE NOT NULL,
      message_id TEXT,
      in_reply_to TEXT,
      references_header TEXT,
      folder TEXT NOT NULL,
      from_address TEXT NOT NULL,
      from_name TEXT,
      to_address TEXT NOT NULL,
      subject TEXT,
      body_preview TEXT,
      is_read INTEGER DEFAULT 0,
      received_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_email_unread ON email_messages(folder, is_read)");

  // Migrate existing email_messages tables to add threading columns
  addColumn("email_messages", "in_reply_to", "TEXT");
  addColumn("email_messages", "references_header", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS aibtc_inbox_messages (
      id INTEGER PRIMARY KEY,
      message_id TEXT UNIQUE NOT NULL,
      from_address TEXT NOT NULL,
      to_btc_address TEXT NOT NULL,
      to_stx_address TEXT NOT NULL,
      content TEXT,
      payment_txid TEXT,
      payment_satoshis INTEGER DEFAULT 0,
      sent_at TEXT NOT NULL,
      authenticated INTEGER DEFAULT 0,
      replied_at TEXT,
      read_at TEXT,
      direction TEXT NOT NULL,
      peer_btc_address TEXT,
      peer_display_name TEXT,
      synced_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_aibtc_inbox_unread ON aibtc_inbox_messages(direction, read_at)");

  db.run(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY,
      template TEXT NOT NULL,
      instance_key TEXT UNIQUE NOT NULL,
      current_state TEXT NOT NULL,
      context TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_workflows_template ON workflows(template)");
  db.run("CREATE INDEX IF NOT EXISTS idx_workflows_instance_key ON workflows(instance_key)");

  db.run(`
    CREATE TABLE IF NOT EXISTS market_positions (
      id INTEGER PRIMARY KEY,
      market_id TEXT NOT NULL,
      mongo_id TEXT,
      market_title TEXT NOT NULL,
      side TEXT NOT NULL,
      action TEXT NOT NULL,
      shares INTEGER NOT NULL,
      cost_ustx INTEGER NOT NULL,
      txid TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_market_positions_market ON market_positions(market_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_market_positions_status ON market_positions(status)");

  db.run(`
    CREATE TABLE IF NOT EXISTS monitored_endpoints (
      id INTEGER PRIMARY KEY,
      endpoint_url TEXT NOT NULL,
      label TEXT,
      tier TEXT NOT NULL DEFAULT 'basic',
      check_interval_minutes INTEGER NOT NULL DEFAULT 60,
      alert_webhook TEXT,
      owner_address TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      last_checked_at TEXT,
      last_status TEXT,
      last_response_ms INTEGER,
      consecutive_failures INTEGER DEFAULT 0
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_monitored_endpoints_status ON monitored_endpoints(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_monitored_endpoints_owner ON monitored_endpoints(owner_address)");

  db.run(`
    CREATE TABLE IF NOT EXISTS task_deps (
      id INTEGER PRIMARY KEY,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      dep_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (from_id) REFERENCES tasks(id),
      FOREIGN KEY (to_id) REFERENCES tasks(id),
      UNIQUE(from_id, to_id, dep_type)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_task_deps_from ON task_deps(from_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_task_deps_to ON task_deps(to_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS roundtable_discussions (
      id INTEGER PRIMARY KEY,
      topic TEXT NOT NULL,
      prompt TEXT NOT NULL,
      started_by TEXT DEFAULT 'arc',
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      compiled_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS roundtable_responses (
      id INTEGER PRIMARY KEY,
      discussion_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      response TEXT,
      status TEXT DEFAULT 'pending',
      responded_at TEXT,
      FOREIGN KEY (discussion_id) REFERENCES roundtable_discussions(id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_roundtable_responses_discussion ON roundtable_responses(discussion_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_messages (
      id INTEGER PRIMARY KEY,
      from_agent TEXT NOT NULL,
      from_bns TEXT,
      message_type TEXT DEFAULT 'status',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_fleet_messages_created ON fleet_messages(created_at DESC)");

  db.run(`
    CREATE TABLE IF NOT EXISTS consensus_proposals (
      id INTEGER PRIMARY KEY,
      topic TEXT NOT NULL,
      description TEXT NOT NULL,
      action_payload TEXT,
      threshold INTEGER DEFAULT 3,
      total_voters INTEGER DEFAULT 5,
      status TEXT DEFAULT 'open',
      proposed_by TEXT DEFAULT 'arc',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      expires_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS consensus_votes (
      id INTEGER PRIMARY KEY,
      proposal_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      vote TEXT NOT NULL,
      reasoning TEXT,
      voted_at TEXT NOT NULL,
      FOREIGN KEY (proposal_id) REFERENCES consensus_proposals(id),
      UNIQUE(proposal_id, agent_name)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_consensus_votes_proposal ON consensus_votes(proposal_id)");

  _db = db;
  return db;
}

export function getDatabase(): Database {
  if (_db === null) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _db;
}

// ---- Task queries ----

/**
 * Returns tasks eligible for dispatch: status='pending', respects scheduled_for, ordered by
 * priority ASC (1 = highest), then id ASC for stable ordering within same priority.
 *
 * Past-due scheduled tasks (scheduled_for < now - 1 min) receive a +2 effective priority
 * boost (lower number = higher priority, capped at 1) so they aren't starved by
 * continuously-created unscheduled tasks. The raw `priority` field is unchanged.
 */
export function getPendingTasks(): Task[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'pending'
         AND (scheduled_for IS NULL OR datetime(scheduled_for) <= datetime('now'))
       ORDER BY
         CASE
           WHEN scheduled_for IS NOT NULL AND datetime(scheduled_for) < datetime('now', '-1 minute')
           THEN MAX(1, priority - 2)
           ELSE priority
         END ASC,
         id ASC`
    )
    .all() as Task[];
}

export function getActiveTasks(): Task[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM tasks WHERE status = 'active' ORDER BY id ASC")
    .all() as Task[];
}

export function getTaskById(id: number): Task | null {
  const db = getDatabase();
  return db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null;
}

/** Returns child tasks in the order they were created. */
export function getTasksByParent(parentId: number): Task[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM tasks WHERE parent_id = ? ORDER BY id ASC")
    .all(parentId) as Task[];
}

/**
 * Dedup gate: returns true if ANY task exists with the given source, regardless of status.
 * Call this before insertTask to prevent duplicate sensor tasks.
 */
export function taskExistsForSource(source: string): boolean {
  const db = getDatabase();
  const row = db.query("SELECT 1 FROM tasks WHERE source = ? LIMIT 1").get(source);
  return row !== null;
}

export function pendingTaskExistsForSource(source: string): boolean {
  const db = getDatabase();
  const row = db
    .query("SELECT 1 FROM tasks WHERE source = ? AND status IN ('pending', 'active') LIMIT 1")
    .get(source);
  return row !== null;
}

export function completedTaskCountForSource(source: string): number {
  const db = getDatabase();
  const row = db
    .query("SELECT COUNT(*) as count FROM tasks WHERE source = ? AND status = 'completed'")
    .get(source) as { count: number } | null;
  return row?.count ?? 0;
}

/**
 * Check if any completed task exists whose source contains the given substring.
 * Useful for detecting prior interactions with an agent across all task types.
 */
export function completedTaskExistsForSourceSubstring(substring: string): boolean {
  const db = getDatabase();
  const row = db
    .query("SELECT 1 FROM tasks WHERE source LIKE ? AND status = 'completed' LIMIT 1")
    .get(`%${substring}%`);
  return row !== null;
}

export function recentTaskExistsForSourcePrefix(prefix: string, withinMinutes: number): boolean {
  const db = getDatabase();
  const row = db
    .query(
      "SELECT 1 FROM tasks WHERE source LIKE ? AND created_at > datetime('now', '-' || ? || ' minutes') LIMIT 1"
    )
    .get(`${prefix}%`, withinMinutes);
  return row !== null;
}

/**
 * Dedup gate: returns true if a pending/active task with the exact same subject exists.
 * Catches duplicates that source-based dedup misses (e.g., different sources, same work).
 */
export function pendingTaskExistsForSubject(subject: string): boolean {
  const db = getDatabase();
  const row = db
    .query("SELECT 1 FROM tasks WHERE subject = ? AND status IN ('pending', 'active') LIMIT 1")
    .get(subject);
  return row !== null;
}

/**
 * Insert a task only if no pending/active task with the same subject already exists.
 * Returns the new task ID, or null if a duplicate was found.
 */
export function insertTaskDeduped(fields: InsertTask): number | null {
  if (pendingTaskExistsForSubject(fields.subject)) return null;
  if (fields.source && pendingTaskExistsForSource(fields.source)) return null;
  return insertTask(fields);
}

// ---- Internal helpers ----

/** Builds and runs a dynamic UPDATE ... WHERE id = ?. Skips undefined values. */
function updateRow(table: string, id: number, fields: Record<string, unknown>): void {
  const db = getDatabase();
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = ?`);
  const values = [...entries.map(([, v]) => v), id];
  db.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

// ---- Task mutations ----

/** GitHub escalation patterns — blocked at task creation on workers */
const GITHUB_ESCALATION_RE = /github credential|request.*(?:PAT|token|github)|escalat.*github|need.*github.*(?:access|token)|obtain.*(?:PAT|token)|github.*access|git\s*push|create.*PR|open.*PR|merge.*PR/i;

export function insertTask(fields: InsertTask): number {
  // On workers, silently block creation of GitHub escalation tasks.
  // These waste resources and generate escalation emails to whoabuddy.
  if (AGENT_NAME !== "arc0") {
    const text = [fields.subject, fields.description ?? ""].join(" ");
    if (GITHUB_ESCALATION_RE.test(text)) {
      console.log(`[github-guard] Blocked GitHub escalation task on worker: "${fields.subject}"`);
      // Return -1 as a sentinel — callers don't check return value for follow-ups
      return -1;
    }
  }

  const db = getDatabase();

  const cols: string[] = ["subject"];
  const values: unknown[] = [fields.subject];

  const optionalColumns: Array<keyof InsertTask> = [
    "description", "skills", "priority", "status",
    "source", "parent_id", "template", "model", "assigned_to",
  ];

  for (const col of optionalColumns) {
    if (fields[col] !== undefined) {
      cols.push(col);
      values.push(fields[col]);
    }
  }

  // scheduled_for requires datetime conversion
  if (fields.scheduled_for !== undefined) {
    cols.push("scheduled_for");
    values.push(
      fields.scheduled_for !== null
        ? toSqliteDatetime(new Date(fields.scheduled_for))
        : null
    );
  }

  const placeholders = cols.map(() => "?").join(", ");
  const result = db
    .query(`INSERT INTO tasks (${cols.join(", ")}) VALUES (${placeholders})`)
    .run(...values);

  return Number(result.lastInsertRowid);
}

export function markTaskActive(id: number): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET status = 'active', started_at = datetime('now'), attempt_count = attempt_count + 1 WHERE id = ?"
  ).run(id);
}

export function markTaskCompleted(id: number, summary: string, detail?: string): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), result_summary = ?, result_detail = ? WHERE id = ?"
  ).run(summary, detail ?? null, id);
}

export function markTaskFailed(id: number, summary: string): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), result_summary = ? WHERE id = ?"
  ).run(summary, id);
}

export function markTaskBlocked(id: number, reason: string): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET status = 'blocked', result_summary = ? WHERE id = ?"
  ).run(reason, id);
}

export interface UpdateTaskFields {
  subject?: string;
  description?: string | null;
  priority?: number;
  model?: string | null;
}

export function updateTask(id: number, fields: UpdateTaskFields): void {
  updateRow("tasks", id, fields as Record<string, unknown>);
}

export function requeueTask(id: number, opts?: { rollbackAttempt?: boolean }): void {
  const db = getDatabase();
  // rollbackAttempt: undo the attempt_count bump from markTaskActive — task isn't at fault (e.g. rate limit)
  db.query(
    `UPDATE tasks SET status = 'pending', started_at = NULL,
     attempt_count = CASE WHEN ? THEN MAX(0, attempt_count - 1) ELSE attempt_count END
     WHERE id = ?`
  ).run(opts?.rollbackAttempt ? 1 : 0, id);
}

export function updateTaskCost(
  id: number,
  cost: number,
  apiCost: number,
  tokensIn: number,
  tokensOut: number
): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET cost_usd = ?, api_cost_usd = ?, tokens_in = ?, tokens_out = ? WHERE id = ?"
  ).run(cost, apiCost, tokensIn, tokensOut, id);
}

// ---- Cycle log ----

export function insertCycleLog(entry: InsertCycleLog): number {
  const db = getDatabase();
  const result = db
    .query(
      "INSERT INTO cycle_log (started_at, task_id, skills_loaded, skill_hashes, model) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      entry.started_at,
      entry.task_id ?? null,
      entry.skills_loaded ?? null,
      entry.skill_hashes ?? null,
      entry.model ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function updateCycleLog(id: number, fields: Partial<CycleLog>): void {
  const allowed: Array<keyof CycleLog> = [
    "completed_at", "duration_ms", "cost_usd", "api_cost_usd",
    "tokens_in", "tokens_out", "skills_loaded", "skill_hashes", "task_id", "security_grade", "model",
  ];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) filtered[key] = fields[key];
  }
  updateRow("cycle_log", id, filtered);
}

// ---- Skill versions ----

export function upsertSkillVersion(hash: string, skillName: string, content: string): void {
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.run(
    `INSERT INTO skill_versions (hash, skill_name, content, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET last_seen = excluded.last_seen`,
    [hash, skillName, content, now, now],
  );
}

export function getSkillVersions(skillName: string): SkillVersion[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM skill_versions WHERE skill_name = ? ORDER BY first_seen DESC")
    .all(skillName) as SkillVersion[];
}

export function getRecentCycles(limit: number = 10): CycleLog[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM cycle_log ORDER BY started_at DESC LIMIT ?")
    .all(limit) as CycleLog[];
}

/** Sum of cost_usd for all cycles started today (UTC). */
export function getTodayCostUsd(): number {
  const db = getDatabase();
  const row = db
    .query("SELECT COALESCE(SUM(cost_usd), 0) as total FROM cycle_log WHERE date(started_at) = date('now')")
    .get() as { total: number };
  return row.total;
}

// ---- Email queries ----

export function upsertEmailMessage(msg: Omit<EmailMessage, "id">): void {
  const db = getDatabase();
  db.query(`
    INSERT INTO email_messages (remote_id, message_id, in_reply_to, references_header, folder, from_address, from_name, to_address, subject, body_preview, is_read, received_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(remote_id) DO UPDATE SET
      is_read = MAX(is_read, excluded.is_read),
      synced_at = excluded.synced_at,
      in_reply_to = COALESCE(excluded.in_reply_to, in_reply_to),
      references_header = COALESCE(excluded.references_header, references_header)
  `).run(
    msg.remote_id, msg.message_id, msg.in_reply_to, msg.references_header,
    msg.folder, msg.from_address, msg.from_name,
    msg.to_address, msg.subject, msg.body_preview, msg.is_read, msg.received_at, msg.synced_at
  );
}

export function getUnreadEmailMessages(): EmailMessage[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM email_messages WHERE folder = 'inbox' AND is_read = 0 ORDER BY received_at ASC")
    .all() as EmailMessage[];
}

export function getAllEmailRemoteIds(): Set<string> {
  const db = getDatabase();
  const rows = db.query("SELECT remote_id FROM email_messages").all() as Array<{ remote_id: string }>;
  return new Set(rows.map((r) => r.remote_id));
}

export function markEmailRead(remoteId: string): void {
  const db = getDatabase();
  db.query("UPDATE email_messages SET is_read = 1 WHERE remote_id = ?").run(remoteId);
}

export function hasSentEmailTo(toAddress: string, sinceIso: string): boolean {
  const db = getDatabase();
  const row = db
    .query(
      "SELECT 1 FROM email_messages WHERE folder = 'sent' AND to_address = ? AND received_at >= ? LIMIT 1"
    )
    .get(toAddress, sinceIso);
  return row !== null;
}

export function getEmailMessageCountFromSender(fromAddress: string): number {
  const db = getDatabase();
  const row = db
    .query("SELECT COUNT(*) as count FROM email_messages WHERE from_address = ? AND folder = 'inbox'")
    .get(fromAddress) as { count: number } | null;
  return row?.count ?? 0;
}

export function getEmailThreadCountBySenderAndSubject(fromAddress: string, normalizedSubject: string): number {
  const db = getDatabase();
  const rows = db
    .query("SELECT subject FROM email_messages WHERE from_address = ? AND folder = 'inbox'")
    .all(fromAddress) as Array<{ subject: string | null }>;
  return rows.filter((r) => {
    const norm = (r.subject ?? "").replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "").trim().toLowerCase() || "(no subject)";
    return norm === normalizedSubject;
  }).length;
}

export function getEmailThreads(limit = 200): EmailMessage[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM email_messages WHERE folder = 'inbox' ORDER BY received_at DESC LIMIT ?")
    .all(limit) as EmailMessage[];
}

export function getEmailMessagesByFromAddress(fromAddress: string): EmailMessage[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM email_messages WHERE from_address = ? AND folder = 'inbox' ORDER BY received_at ASC")
    .all(fromAddress) as EmailMessage[];
}

// ---- AIBTC inbox queries ----

export function upsertAibtcInboxMessage(msg: Omit<AibtcInboxMessage, "id">): void {
  const db = getDatabase();
  db.query(`
    INSERT INTO aibtc_inbox_messages (message_id, from_address, to_btc_address, to_stx_address, content, payment_txid, payment_satoshis, sent_at, authenticated, replied_at, read_at, direction, peer_btc_address, peer_display_name, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      replied_at = excluded.replied_at,
      read_at = excluded.read_at,
      synced_at = excluded.synced_at
  `).run(
    msg.message_id, msg.from_address, msg.to_btc_address, msg.to_stx_address,
    msg.content, msg.payment_txid, msg.payment_satoshis, msg.sent_at,
    msg.authenticated, msg.replied_at, msg.read_at, msg.direction,
    msg.peer_btc_address, msg.peer_display_name, msg.synced_at
  );
}

export function getUnreadAibtcInboxMessages(): AibtcInboxMessage[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM aibtc_inbox_messages WHERE direction = 'received' AND read_at IS NULL ORDER BY sent_at ASC")
    .all() as AibtcInboxMessage[];
}

export function getRecentAibtcMessagesByPeer(peerBtcAddress: string, limit: number = 10): AibtcInboxMessage[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM aibtc_inbox_messages WHERE peer_btc_address = ? AND direction = 'sent' ORDER BY sent_at DESC LIMIT ?")
    .all(peerBtcAddress, limit) as AibtcInboxMessage[];
}

export function getAllAibtcInboxMessageIds(): Set<string> {
  const db = getDatabase();
  const rows = db.query("SELECT message_id FROM aibtc_inbox_messages").all() as Array<{ message_id: string }>;
  return new Set(rows.map((r) => r.message_id));
}

// ---- Workflow queries ----

export function insertWorkflow(fields: InsertWorkflow): number {
  const db = getDatabase();
  const result = db
    .query(
      "INSERT INTO workflows (template, instance_key, current_state, context) VALUES (?, ?, ?, ?)"
    )
    .run(fields.template, fields.instance_key, fields.current_state, fields.context ?? null);
  return Number(result.lastInsertRowid);
}

export function getWorkflowById(id: number): Workflow | null {
  const db = getDatabase();
  return db.query("SELECT * FROM workflows WHERE id = ?").get(id) as Workflow | null;
}

export function getWorkflowByInstanceKey(instanceKey: string): Workflow | null {
  const db = getDatabase();
  return db.query("SELECT * FROM workflows WHERE instance_key = ?").get(instanceKey) as Workflow | null;
}

export function getWorkflowsByTemplate(template: string): Workflow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM workflows WHERE template = ? ORDER BY updated_at DESC")
    .all(template) as Workflow[];
}

export function getAllActiveWorkflows(): Workflow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM workflows WHERE completed_at IS NULL ORDER BY updated_at DESC")
    .all() as Workflow[];
}

export function updateWorkflowState(id: number, newState: string, context?: string | null): void {
  const db = getDatabase();
  db.query(
    "UPDATE workflows SET current_state = ?, context = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newState, context ?? null, id);
}

export function completeWorkflow(id: number): void {
  const db = getDatabase();
  db.query(
    "UPDATE workflows SET completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

export function deleteWorkflow(id: number): void {
  const db = getDatabase();
  db.query("DELETE FROM workflows WHERE id = ?").run(id);
}

// ---- Market position queries ----

export function insertMarketPosition(fields: InsertMarketPosition): number {
  const db = getDatabase();
  const result = db
    .query(
      `INSERT INTO market_positions (market_id, mongo_id, market_title, side, action, shares, cost_ustx, txid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.market_id,
      fields.mongo_id ?? null,
      fields.market_title,
      fields.side,
      fields.action,
      fields.shares,
      fields.cost_ustx,
      fields.txid ?? null,
      fields.status ?? "pending"
    );
  return Number(result.lastInsertRowid);
}

export function getMarketPositions(marketId?: string): MarketPosition[] {
  const db = getDatabase();
  if (marketId) {
    return db
      .query("SELECT * FROM market_positions WHERE market_id = ? ORDER BY created_at DESC")
      .all(marketId) as MarketPosition[];
  }
  return db
    .query("SELECT * FROM market_positions ORDER BY created_at DESC")
    .all() as MarketPosition[];
}

export function getOpenPositions(): MarketPosition[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM market_positions WHERE action = 'buy' AND status != 'failed' ORDER BY created_at DESC")
    .all() as MarketPosition[];
}

export function updateMarketPositionStatus(id: number, status: string): void {
  const db = getDatabase();
  db.query("UPDATE market_positions SET status = ? WHERE id = ?").run(status, id);
}

export function updateMarketPositionTxid(id: number, txid: string): void {
  const db = getDatabase();
  db.query("UPDATE market_positions SET txid = ?, status = 'confirmed' WHERE id = ?").run(txid, id);
}

/** Total uSTX spent on buys (excluding failed). */
export function getTotalBuysCostUstx(): number {
  const db = getDatabase();
  const row = db
    .query("SELECT COALESCE(SUM(cost_ustx), 0) as total FROM market_positions WHERE action = 'buy' AND status != 'failed'")
    .get() as { total: number };
  return row.total;
}

// ---- Task dependency queries ----

const VALID_DEP_TYPES: Set<string> = new Set(["blocks", "related", "discovered-from"]);

export function insertTaskDep(fromId: number, toId: number, depType: TaskDepType): number {
  if (!VALID_DEP_TYPES.has(depType)) {
    throw new Error(`Invalid dep_type: ${depType}. Must be one of: blocks, related, discovered-from`);
  }
  const db = getDatabase();
  const result = db
    .query("INSERT OR IGNORE INTO task_deps (from_id, to_id, dep_type) VALUES (?, ?, ?)")
    .run(fromId, toId, depType);
  return Number(result.lastInsertRowid);
}

export function getTaskDeps(taskId: number): TaskDep[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM task_deps WHERE from_id = ? OR to_id = ? ORDER BY created_at ASC")
    .all(taskId, taskId) as TaskDep[];
}

export function deleteTaskDep(fromId: number, toId: number, depType: TaskDepType): void {
  const db = getDatabase();
  db.query("DELETE FROM task_deps WHERE from_id = ? AND to_id = ? AND dep_type = ?").run(fromId, toId, depType);
}

/** Total uSTX received from sells and redeems (excluding failed). */
export function getTotalProceedsUstx(): number {
  const db = getDatabase();
  const row = db
    .query("SELECT COALESCE(SUM(cost_ustx), 0) as total FROM market_positions WHERE action IN ('sell', 'redeem') AND status != 'failed'")
    .get() as { total: number };
  return row.total;
}

// ---- Monitored endpoint queries ----

export function insertMonitoredEndpoint(fields: InsertMonitoredEndpoint): number {
  const db = getDatabase();
  const result = db
    .query(
      `INSERT INTO monitored_endpoints (endpoint_url, label, tier, check_interval_minutes, alert_webhook, owner_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.endpoint_url,
      fields.label ?? null,
      fields.tier ?? "basic",
      fields.check_interval_minutes ?? 60,
      fields.alert_webhook ?? null,
      fields.owner_address ?? null,
      fields.expires_at ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function getMonitoredEndpoint(id: number): MonitoredEndpoint | null {
  const db = getDatabase();
  return db.query("SELECT * FROM monitored_endpoints WHERE id = ?").get(id) as MonitoredEndpoint | null;
}

export function getActiveMonitoredEndpoints(): MonitoredEndpoint[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM monitored_endpoints WHERE status = 'active' ORDER BY id ASC")
    .all() as MonitoredEndpoint[];
}

export function getMonitoredEndpointsByOwner(ownerAddress: string): MonitoredEndpoint[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM monitored_endpoints WHERE owner_address = ? ORDER BY id ASC")
    .all(ownerAddress) as MonitoredEndpoint[];
}

/** Returns active endpoints that are due for a check based on their interval. */
export function getDueMonitoredEndpoints(): MonitoredEndpoint[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM monitored_endpoints
       WHERE status = 'active'
         AND (last_checked_at IS NULL
              OR datetime(last_checked_at, '+' || check_interval_minutes || ' minutes') <= datetime('now'))
       ORDER BY last_checked_at ASC NULLS FIRST`
    )
    .all() as MonitoredEndpoint[];
}

export function updateMonitoredEndpointCheck(
  id: number,
  status: string,
  responseMs: number,
  consecutiveFailures: number,
): void {
  const db = getDatabase();
  db.query(
    `UPDATE monitored_endpoints
     SET last_checked_at = datetime('now'), last_status = ?, last_response_ms = ?, consecutive_failures = ?
     WHERE id = ?`
  ).run(status, responseMs, consecutiveFailures, id);
}

export function updateMonitoredEndpointStatus(id: number, status: string): void {
  const db = getDatabase();
  db.query("UPDATE monitored_endpoints SET status = ? WHERE id = ?").run(status, id);
}

export function deleteMonitoredEndpoint(id: number): void {
  const db = getDatabase();
  db.query("DELETE FROM monitored_endpoints WHERE id = ?").run(id);
}

