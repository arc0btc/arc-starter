#!/usr/bin/env bun
/**
 * 017-p3-lane-check-constraint-rebuild.ts
 * arc-posting-scheduler P3 — widens the `lane` CHECK constraint on `outbound_action` and
 * `budget_ledger` so the two new lane VALUES this phase introduces (`'daily-read'`,
 * `'content-calendar'`) — and `budget_ledger`'s cross-lane global-backstop sentinel
 * (`'__global__'`) — are actually insertable.
 *
 * DISCOVERED LIVE (not anticipated by the P0 design spec or migration 014/016): both
 * tables carry `lane TEXT NOT NULL CHECK(lane IN ('post','reply'))`. Migration 014/016's
 * additive `ALTER TABLE ... ADD COLUMN` calls never touch existing CHECK constraints —
 * SQLite has no `ALTER TABLE ... DROP/MODIFY CONSTRAINT`. The 016b dry-run test
 * (ops-migrations/016b-p3-lane-window-dryrun-test.ts) hit this immediately: every
 * `admitGroup()` call with `lane:'daily-read'`/`'content-calendar'` silently failed to
 * insert its `budget_ledger` row (`INSERT OR IGNORE` swallows the CHECK violation) and
 * then failed its CAS UPDATE (0 rows matched) — surfacing as a misleading
 * `budget_exhausted` rather than a constraint error.
 *
 * SQLite's only way to change a CHECK constraint is the standard 12-step "rebuild the
 * table" recipe: create a new table with the same schema (widened CHECK, plus this
 * phase's already-added columns folded into one CREATE for cleanliness), copy every row,
 * drop the old table, rename the new one into place, recreate every index. No data is
 * lost or reordered (INSERT INTO ... SELECT * preserves every existing column value,
 * including the rows created earlier this phase by migration 014/016).
 *
 * Foreign keys: `PRAGMA foreign_keys` is OFF on this DB (confirmed live, 2026-07-05) and
 * this codebase's own db.ts never turns it on — `engagement_log.action_id` and
 * `moltbook_post.outbound_action_id` reference `outbound_action(id)` but are NOT enforced,
 * so the drop/recreate is safe without disabling/re-enabling FK checks. `id` values are
 * preserved exactly (INTEGER PRIMARY KEY AUTOINCREMENT — `INSERT INTO new SELECT * FROM
 * old` carries the old `id` values verbatim), so referencing rows in engagement_log and
 * moltbook_post stay valid.
 *
 * Idempotent: checks `sqlite_master.sql` for the CURRENT CHECK constraint before doing
 * anything — if it already contains 'daily-read', the rebuild for that table is skipped
 * (reports `already_migrated`).
 *
 * Usage (on the Arc VM):
 *   export PATH="$HOME/.bun/bin:$PATH"
 *   cd ~/arc-starter
 *   cp db/arc.sqlite db/arc.sqlite.bak-p3-checkfix-$(date -u +%Y%m%dT%H%M%SZ)
 *   bun ops-migrations/017-p3-lane-check-constraint-rebuild.ts
 *   bun ops-migrations/017-p3-lane-check-constraint-rebuild.ts   # run again — proves convergence
 */

import { Database } from "bun:sqlite";

const DB_PATH = process.env.ARC_DB_PATH ?? "db/arc.sqlite";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function currentSql(db: Database, name: string): string {
  const row = db.query("SELECT sql FROM sqlite_master WHERE name=?").get(name) as { sql: string } | null;
  return row?.sql ?? "";
}

function rowCount(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
}

const NEW_LANES_OUTBOUND = "'post','reply','daily-read','content-calendar'";
const NEW_LANES_BUDGET = "'post','reply','daily-read','content-calendar','__global__'";

function rebuildOutboundAction(db: Database): "rebuilt" | "already_migrated" {
  const sql = currentSql(db, "outbound_action");
  if (sql.includes("daily-read")) return "already_migrated";

  const before = rowCount(db, "outbound_action");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE outbound_action_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL DEFAULT 'x',
        lane TEXT NOT NULL CHECK(lane IN (${NEW_LANES_OUTBOUND})),
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK(status IN ('queued','sending','sent','unknown','skipped')),
        payload_ref TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        is_root INTEGER NOT NULL DEFAULT 0,
        thread_ref TEXT,
        defer_count INTEGER NOT NULL DEFAULT 0,
        budget_day TEXT NOT NULL,
        lease_expires_at TEXT,
        provider_post_id TEXT,
        account_id INTEGER REFERENCES social_accounts(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        conversation_ref TEXT,
        earliest_utc_time TEXT,
        latest_utc_time TEXT,
        atomic_group_id TEXT,
        global_reserved INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`
      INSERT INTO outbound_action_new
        (id, source_key, platform, lane, status, payload_ref, payload_hash, is_root,
         thread_ref, defer_count, budget_day, lease_expires_at, provider_post_id,
         account_id, created_at, updated_at, conversation_ref, earliest_utc_time,
         latest_utc_time, atomic_group_id, global_reserved)
      SELECT
        id, source_key, platform, lane, status, payload_ref, payload_hash, is_root,
        thread_ref, defer_count, budget_day, lease_expires_at, provider_post_id,
        account_id, created_at, updated_at, conversation_ref, earliest_utc_time,
        latest_utc_time, atomic_group_id, global_reserved
      FROM outbound_action
    `);
    db.exec("DROP TABLE outbound_action");
    db.exec("ALTER TABLE outbound_action_new RENAME TO outbound_action");
    // Recreate the 3 named indexes (the source_key UNIQUE autoindex is recreated
    // automatically by the CREATE TABLE's own UNIQUE constraint).
    db.exec(`CREATE INDEX idx_outbound_action_status ON outbound_action(status, budget_day)`);
    db.exec(`CREATE INDEX idx_outbound_action_source_key ON outbound_action(source_key)`);
    db.exec(`CREATE INDEX idx_outbound_action_conversation_ref ON outbound_action(conversation_ref, lane, status, created_at)`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const after = rowCount(db, "outbound_action");
  if (before !== after) throw new Error(`row count mismatch after rebuild: before=${before} after=${after}`);
  return "rebuilt";
}

function rebuildBudgetLedger(db: Database): "rebuilt" | "already_migrated" {
  const sql = currentSql(db, "budget_ledger");
  if (sql.includes("daily-read")) return "already_migrated";

  const before = rowCount(db, "budget_ledger");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE budget_ledger_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        lane TEXT NOT NULL CHECK(lane IN (${NEW_LANES_BUDGET})),
        reserved_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        cap INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(channel, utc_day, lane)
      )
    `);
    db.exec(`
      INSERT INTO budget_ledger_new
        (id, channel, utc_day, lane, reserved_count, sent_count, cap, created_at)
      SELECT id, channel, utc_day, lane, reserved_count, sent_count, cap, created_at
      FROM budget_ledger
    `);
    db.exec("DROP TABLE budget_ledger");
    db.exec("ALTER TABLE budget_ledger_new RENAME TO budget_ledger");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const after = rowCount(db, "budget_ledger");
  if (before !== after) throw new Error(`row count mismatch after rebuild: before=${before} after=${after}`);
  return "rebuilt";
}

function main() {
  const db = new Database(DB_PATH);
  log(`DB: ${DB_PATH}`);
  log(`BEFORE — outbound_action CHECK: ${currentSql(db, "outbound_action").match(/CHECK\(lane[^)]+\)/)?.[0]}`);
  log(`BEFORE — budget_ledger CHECK: ${currentSql(db, "budget_ledger").match(/CHECK\(lane[^)]+\)/)?.[0]}`);

  const r1 = rebuildOutboundAction(db);
  log(`outbound_action lane CHECK: ${r1}`);
  const r2 = rebuildBudgetLedger(db);
  log(`budget_ledger lane CHECK: ${r2}`);

  log(`AFTER — outbound_action CHECK: ${currentSql(db, "outbound_action").match(/CHECK\(lane[^)]+\)/)?.[0]}`);
  log(`AFTER — budget_ledger CHECK: ${currentSql(db, "budget_ledger").match(/CHECK\(lane[^)]+\)/)?.[0]}`);
  log(`outbound_action row count: ${rowCount(db, "outbound_action")}`);
  log(`budget_ledger row count: ${rowCount(db, "budget_ledger")}`);

  db.close();
  log("Migration complete.");
}

main();
