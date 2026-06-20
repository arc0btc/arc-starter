#!/usr/bin/env bun
/**
 * 006-p4-planned-posts.ts
 * P4 schema migration: planned_posts table.
 *
 * Additive only. Guards against re-run via PRAGMA user_version.
 * user_version: 2 → 3
 *
 * Run against fixture COPY first; then live DB.
 *
 * Usage:
 *   bun ops/migrations/social-engine/006-p4-planned-posts.ts [--fixture /path/to/copy.db]
 *
 * Without --fixture flag, runs against live DB (arc-starter VM path).
 */

import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
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

function backupPath(dbPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `/tmp/arc-sqlite-p4-pre-${ts}.bak`;
}

async function run() {
  log(`006-p4-planned-posts migration`);
  log(`DB path: ${DB_PATH}`);
  log(`Mode: ${IS_FIXTURE ? "FIXTURE" : "LIVE"}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`FATAL: DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  // Backup before any migration
  const bak = backupPath(DB_PATH);
  execSync(`cp ${DB_PATH} ${bak}`);
  const preSHA = sha256File(bak);
  log(`Backup created: ${bak}`);
  log(`Backup SHA-256: ${preSHA}`);

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  // Guard: check current user_version
  const uv = db.query("PRAGMA user_version").get() as { user_version: number };
  log(`user_version before: ${uv.user_version}`);

  if (uv.user_version >= 3) {
    log("Migration 006 already applied (user_version >= 3). Nothing to do.");
    db.close();
    process.exit(0);
  }

  if (uv.user_version !== 2) {
    console.error(`FATAL: Expected user_version=2, got ${uv.user_version}. Run migrations in order.`);
    db.close();
    process.exit(1);
  }

  log("Applying migration 006: planned_posts table...");

  db.exec(`
    CREATE TABLE IF NOT EXISTS planned_posts (
      id          INTEGER PRIMARY KEY,
      source_key  TEXT NOT NULL,
      lane        TEXT NOT NULL DEFAULT 'post',
      is_root     INTEGER NOT NULL DEFAULT 1,
      thread_ref  TEXT,
      scheduled_utc_day TEXT NOT NULL,
      defer_count INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'planned',
      payload_ref TEXT,
      payload_hash TEXT,
      outbound_action_id INTEGER,
      account_id  INTEGER,
      notes       TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(source_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_planned_posts_scheduled
      ON planned_posts(scheduled_utc_day, status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_planned_posts_status
      ON planned_posts(status)
  `);

  // Bump user_version
  db.exec("PRAGMA user_version = 3");

  const uvAfter = db.query("PRAGMA user_version").get() as { user_version: number };
  log(`user_version after: ${uvAfter.user_version}`);

  // Verify table exists
  const tbl = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='planned_posts'")
    .get() as { name: string } | null;
  if (!tbl) {
    console.error("FATAL: planned_posts table not found after migration.");
    db.close();
    process.exit(1);
  }

  // Verify UNIQUE constraint by attempting duplicate insert
  db.run(
    `INSERT INTO planned_posts(source_key, scheduled_utc_day, status)
     VALUES ('test-migration-verify', '2026-06-20', 'planned')`
  );
  let dupFailed = false;
  try {
    db.run(
      `INSERT INTO planned_posts(source_key, scheduled_utc_day, status)
       VALUES ('test-migration-verify', '2026-06-20', 'planned')`
    );
  } catch (e: any) {
    dupFailed = e.message?.includes("UNIQUE") || e.code === "SQLITE_CONSTRAINT_UNIQUE";
  }
  // Clean up test row
  db.run(`DELETE FROM planned_posts WHERE source_key='test-migration-verify'`);

  if (!dupFailed) {
    console.error("FATAL: UNIQUE constraint on planned_posts.source_key NOT enforced.");
    db.close();
    process.exit(1);
  }
  log("UNIQUE(source_key) constraint verified.");

  // Verify indexes
  const idx = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_planned_posts_scheduled'"
    )
    .get() as { name: string } | null;
  if (!idx) {
    console.error("FATAL: idx_planned_posts_scheduled index not found.");
    db.close();
    process.exit(1);
  }
  log("Index idx_planned_posts_scheduled verified.");

  db.close();

  log(`Migration 006 complete. user_version: ${uv.user_version} → ${uvAfter.user_version}`);
  log(`Pre-migration backup SHA-256: ${preSHA}`);
  console.log("\n=== MIGRATION 006 SUMMARY ===");
  console.log(`PASS: planned_posts table created`);
  console.log(`PASS: UNIQUE(source_key) constraint enforced`);
  console.log(`PASS: idx_planned_posts_scheduled index created`);
  console.log(`user_version: ${uv.user_version} → ${uvAfter.user_version}`);
  console.log(`Backup: ${bak}`);
  console.log(`Backup SHA-256: ${preSHA}`);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
