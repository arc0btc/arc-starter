/**
 * Memory Database
 *
 * SQLite connection and schema initialization for the agent memory system.
 * Uses bun:sqlite (built-in, no additional dependencies).
 *
 * Tables:
 * - cycle_log      — one row per cycle, phase results and timing
 * - learnings      — accumulated knowledge, FTS5-indexed for search
 * - event_history  — append-only typed event stream
 * - agent_state    — key-value store for persistent agent state
 *
 * Architecture decision: ADR-001 (memory/two-layer)
 * SQLite is the authoritative source; memory/ markdown files are human digests.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Default database path relative to project root
 */
const DEFAULT_DB_PATH = join(process.cwd(), "state", "agent.db");

/**
 * Schema SQL for all tables, indexes, triggers, and seed data
 */
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- Table: cycle_log
-- One row per execution cycle. Records what happened, timing,
-- and final status. Enables trend analysis over time.
-- ============================================================

CREATE TABLE IF NOT EXISTS cycle_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_num         INTEGER NOT NULL,
  started_at        TEXT    NOT NULL,
  ended_at          TEXT,
  status            TEXT    NOT NULL CHECK (status IN ('ok', 'degraded', 'error', 'idle')),
  is_idle           INTEGER NOT NULL DEFAULT 0,
  phases            TEXT,
  phase_ms          TEXT,
  tasks_executed    INTEGER DEFAULT 0,
  events_observed   INTEGER DEFAULT 0,
  learnings_added   INTEGER DEFAULT 0,
  errors_count      INTEGER DEFAULT 0,
  summary           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cycle_log_started_at ON cycle_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_log_status ON cycle_log (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_log_cycle_num ON cycle_log (cycle_num);


-- ============================================================
-- Table: learnings
-- Structured knowledge accumulated across cycles.
-- Subject to consolidation before insert (FTS5 near-duplicate check).
-- ============================================================

CREATE TABLE IF NOT EXISTS learnings (
  id                   TEXT PRIMARY KEY,
  content              TEXT NOT NULL,
  area                 TEXT NOT NULL DEFAULT 'main' CHECK (area IN ('main', 'fragments', 'solutions')),
  source               TEXT NOT NULL DEFAULT 'cycle' CHECK (source IN ('cycle', 'interaction', 'operator', 'knowledge')),
  tags                 TEXT,
  importance           REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0.0 AND importance <= 1.0),
  is_knowledge_source  INTEGER NOT NULL DEFAULT 0,
  source_file          TEXT,
  source_checksum      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  cycle_num            INTEGER,
  consolidated_from    TEXT,
  consolidation_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_learnings_area ON learnings (area);
CREATE INDEX IF NOT EXISTS idx_learnings_importance ON learnings (importance DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_source_file ON learnings (source_file) WHERE source_file IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learnings_created_at ON learnings (created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
  content,
  tags,
  content=learnings,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS learnings_ai
  AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts (rowid, content, tags)
    VALUES (new.rowid, new.content, new.tags);
  END;

CREATE TRIGGER IF NOT EXISTS learnings_ad
  AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts (learnings_fts, rowid, content, tags)
    VALUES ('delete', old.rowid, old.content, old.tags);
  END;

CREATE TRIGGER IF NOT EXISTS learnings_au
  AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts (learnings_fts, rowid, content, tags)
    VALUES ('delete', old.rowid, old.content, old.tags);
    INSERT INTO learnings_fts (rowid, content, tags)
    VALUES (new.rowid, new.content, new.tags);
  END;


-- ============================================================
-- Table: event_history
-- Append-only typed event stream. Every meaningful eventBus.emit()
-- is recorded here. The observability bridge for query-tools.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  source      TEXT,
  cycle_num   INTEGER,
  payload     TEXT,
  dedup_key   TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_history_timestamp ON event_history (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_history_event_type ON event_history (event_type);
CREATE INDEX IF NOT EXISTS idx_event_history_source ON event_history (source);
CREATE INDEX IF NOT EXISTS idx_event_history_cycle_num ON event_history (cycle_num) WHERE cycle_num IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_history_dedup ON event_history (dedup_key) WHERE dedup_key IS NOT NULL;


-- ============================================================
-- Table: agent_state
-- Key-value store for agent-level persistent state.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO agent_state (key, value, updated_at)
VALUES
  ('cycle_count',   '0',    datetime('now')),
  ('last_cycle_at', 'null', datetime('now')),
  ('next_cycle_at', 'null', datetime('now'));
`;

let _db: Database | null = null;

/**
 * Get or initialize the SQLite database connection.
 * Creates the state/ directory and runs schema migrations on first call.
 */
export function getDb(dbPath: string = DEFAULT_DB_PATH): Database {
  if (_db) return _db;

  // Ensure state directory exists (skip for in-memory databases)
  if (dbPath !== ":memory:" && dbPath.includes("/")) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  _db = new Database(dbPath, { create: true });

  // Initialize schema (idempotent — uses CREATE IF NOT EXISTS throughout)
  _db.exec(SCHEMA_SQL);

  return _db;
}

/**
 * Close the database connection (for cleanup/testing).
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Reset the database singleton (for testing — allows fresh DB per test).
 */
export function resetDbForTesting(): void {
  closeDb();
}
