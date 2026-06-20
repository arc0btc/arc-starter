#!/usr/bin/env bun
/**
 * 006b-p4-engagement-log-deferred.ts
 * P4 additive migration: Add 'deferred' to engagement_log event_type CHECK constraint.
 *
 * SQLite does not support ALTER TABLE ... MODIFY COLUMN to change CHECK constraints.
 * We must rebuild the table (standard SQLite rename-create-insert-drop pattern).
 *
 * This is safe because:
 * 1. engagement_log is append-only telemetry (§3 — not a dedup source)
 * 2. No index uses event_type values uniquely
 * 3. The rebuild preserves all existing rows
 * 4. WAL mode + busy_timeout ensure no data loss during the rebuild
 *
 * Existing event types: queued, claimed, sending, sent, unknown, skipped, reconciled, error
 * Adding: deferred
 *
 * user_version stays at 3 (this is a sub-step of P4, not a new phase migration).
 * We use a separate agent_config flag 'engagement_log_v2' to guard re-runs.
 *
 * Usage:
 *   bun ops/migrations/social-engine/006b-p4-engagement-log-deferred.ts [--fixture /path/to/copy.db]
 */

import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import * as fs from "fs";
import { createHash } from "crypto";

const LIVE_DB = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const fixtureIdx = process.argv.indexOf("--fixture");
const DB_PATH = fixtureIdx !== -1 ? process.argv[fixtureIdx + 1] : LIVE_DB;
const IS_FIXTURE = fixtureIdx !== -1;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sha256File(fpath: string): string {
  const data = fs.readFileSync(fpath);
  return createHash("sha256").update(data).digest("hex");
}

async function run() {
  log(`006b-p4-engagement-log-deferred migration`);
  log(`DB path: ${DB_PATH}`);
  log(`Mode: ${IS_FIXTURE ? "FIXTURE" : "LIVE"}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`FATAL: DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  // Backup
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const bak = `/tmp/arc-sqlite-p4b-pre-${ts}.bak`;
  execSync(`cp ${DB_PATH} ${bak}`);
  const preSHA = sha256File(bak);
  log(`Backup: ${bak}`);
  log(`Backup SHA-256: ${preSHA}`);

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA foreign_keys=OFF"); // must be off during table rebuild

  // Guard: already applied?
  const guardRow = db
    .query("SELECT value FROM agent_config WHERE key='engagement_log_v2'")
    .get() as { value: string } | null;
  if (guardRow?.value === "1") {
    log("Migration 006b already applied (engagement_log_v2=1). Nothing to do.");
    db.close();
    process.exit(0);
  }

  // Check current schema
  const currentSchema = db
    .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='engagement_log'")
    .get() as { sql: string } | null;
  if (!currentSchema) {
    console.error("FATAL: engagement_log table not found.");
    db.close();
    process.exit(1);
  }

  log("Rebuilding engagement_log table with expanded CHECK constraint...");
  log("Adding 'deferred' to event_type CHECK...");

  // SQLite table rebuild pattern (no long lock — use WAL):
  // 1. Create new table with updated constraint
  // 2. Copy all rows
  // 3. Drop old table
  // 4. Rename new table
  db.exec("BEGIN");

  try {
    db.exec(`
      CREATE TABLE engagement_log_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_id INTEGER NOT NULL REFERENCES outbound_action(id),
        event_type TEXT NOT NULL
          CHECK(event_type IN ('queued','claimed','sending','sent','unknown','skipped','reconciled','error','deferred')),
        provider_post_id TEXT,
        notes TEXT,
        occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    // Copy all existing rows
    db.exec(`
      INSERT INTO engagement_log_v2(id, action_id, event_type, provider_post_id, notes, occurred_at)
      SELECT id, action_id, event_type, provider_post_id, notes, occurred_at
      FROM engagement_log
    `);

    const oldCount = db.query("SELECT COUNT(*) as cnt FROM engagement_log").get() as { cnt: number };
    const newCount = db.query("SELECT COUNT(*) as cnt FROM engagement_log_v2").get() as { cnt: number };

    if (oldCount.cnt !== newCount.cnt) {
      db.exec("ROLLBACK");
      console.error(`FATAL: Row count mismatch: old=${oldCount.cnt} new=${newCount.cnt}`);
      db.close();
      process.exit(1);
    }

    // Drop old, rename new
    db.exec("DROP TABLE engagement_log");
    db.exec("ALTER TABLE engagement_log_v2 RENAME TO engagement_log");

    // Mark as applied
    db.exec(
      `INSERT OR REPLACE INTO agent_config(key, value, updated_at)
       VALUES ('engagement_log_v2', '1', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    );

    db.exec("COMMIT");
    log(`Rebuild complete. Rows preserved: ${newCount.cnt}`);
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    console.error(`FATAL: Migration failed: ${err}`);
    db.close();
    process.exit(1);
  }

  db.exec("PRAGMA foreign_keys=ON");

  // Verify new constraint allows 'deferred'
  let deferOk = false;
  const testDb = new Database(DB_PATH);
  testDb.exec("PRAGMA journal_mode=WAL");
  try {
    // We can't test the constraint without an actual outbound_action row, so verify via schema
    const newSchema = testDb
      .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='engagement_log'")
      .get() as { sql: string };
    deferOk = newSchema.sql.includes("'deferred'");
    testDb.close();
  } catch { testDb.close(); }

  log(`'deferred' in CHECK constraint: ${deferOk}`);
  db.close();

  console.log("\n=== MIGRATION 006b SUMMARY ===");
  console.log(`PASS: engagement_log rebuilt with 'deferred' event_type`);
  console.log(`PASS: all rows preserved`);
  console.log(`Backup SHA-256: ${preSHA}`);
  if (!deferOk) {
    console.log("WARN: could not verify 'deferred' in schema text — check manually");
  }
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
