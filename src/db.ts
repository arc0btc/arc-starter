import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

// ---- Types ----

export interface Task {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;         // JSON array: ["manage-skills", "stacks-js"]
  priority: number;
  status: string;                // pending|active|completed|failed|blocked
  source: string | null;         // "human", "sensor:heartbeat", "task:42"
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
}

export interface InsertCycleLog {
  started_at: string;
  task_id?: number | null;
  skills_loaded?: string | null;
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
 */
export function getPendingTasks(): Task[] {
  const db = getDatabase();
  return db
    .query(
      "SELECT * FROM tasks WHERE status = 'pending' AND (scheduled_for IS NULL OR datetime(scheduled_for) <= datetime('now')) ORDER BY priority ASC, id ASC"
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

// ---- Task mutations ----

export function insertTask(fields: InsertTask): number {
  const db = getDatabase();

  const cols: string[] = ["subject"];
  const values: unknown[] = [fields.subject];

  const optionalColumns: Array<keyof InsertTask> = [
    "description", "skills", "priority", "status",
    "source", "parent_id", "template",
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

export function requeueTask(id: number): void {
  const db = getDatabase();
  db.query(
    "UPDATE tasks SET status = 'pending', started_at = NULL WHERE id = ?"
  ).run(id);
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
      "INSERT INTO cycle_log (started_at, task_id, skills_loaded) VALUES (?, ?, ?)"
    )
    .run(entry.started_at, entry.task_id ?? null, entry.skills_loaded ?? null);
  return Number(result.lastInsertRowid);
}

export function updateCycleLog(id: number, fields: Partial<CycleLog>): void {
  const db = getDatabase();
  const updatableFields: Array<keyof CycleLog> = [
    "completed_at", "duration_ms", "cost_usd", "api_cost_usd",
    "tokens_in", "tokens_out", "skills_loaded", "task_id",
  ];

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const key of updatableFields) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }

  if (sets.length === 0) return;
  values.push(id);
  db.query(`UPDATE cycle_log SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getRecentCycles(limit: number = 10): CycleLog[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM cycle_log ORDER BY started_at DESC LIMIT ?")
    .all(limit) as CycleLog[];
}

// ---- Main (smoke test when run directly) ----

if (import.meta.main) {
  console.log("Initializing database...");
  const db = initDatabase();
  console.log("Database initialized at db/arc.sqlite");

  const taskId = insertTask({
    subject: "smoke-test",
    description: "Verify db init works",
    source: "test",
  });
  console.log(`Inserted task id=${taskId}`);

  const task = getTaskById(taskId);
  if (!task) throw new Error("getTaskById returned null for newly inserted task");
  console.log(`Task subject: ${task.subject}`);

  const cycleId = insertCycleLog({
    started_at: toSqliteDatetime(new Date()),
    task_id: taskId,
  });
  console.log(`Inserted cycle_log id=${cycleId}`);

  const cycles = getRecentCycles(1);
  console.log(`Recent cycles: ${cycles.length}`);

  console.log("Smoke test passed.");
  db.close();
}
