#!/usr/bin/env bun
/**
 * 014-p2-atomic-group-windows.ts
 * arc-posting-scheduler P2 — additive schema extension for the atomic-group unit of account
 * and per-lane time windows.
 *
 * Adds (all nullable, no defaults — NULL means "anytime" / "no group", matching today's
 * implicit behavior for every existing row):
 *   outbound_action.earliest_utc_time  TEXT  ("HH:MM", lane window open)
 *   outbound_action.latest_utc_time    TEXT  ("HH:MM", lane window close)
 *   outbound_action.atomic_group_id    TEXT  (shared by every row admitted in one admitGroup() call)
 *   planned_posts.earliest_utc_time    TEXT
 *   planned_posts.latest_utc_time      TEXT
 *
 * Per the P0 design spec (docs/specs/2026-07-05-posting-scheduler-design.md §3): this is an
 * ADDITIVE migration only — no existing column is touched, no existing row's data changes.
 * Windows are populated by P3 (lane migration); P2 only adds the columns admitGroup() and the
 * scheduler need to exist.
 *
 * Idempotent: each ALTER is individually wrapped in try/catch (matching cli.ts's own
 * `ALTER TABLE x_post_log ADD COLUMN is_root` pattern) so re-running this script after a
 * partial or full prior run is a clean no-op, not a crash.
 *
 * Usage (on the Arc VM):
 *   export PATH="$HOME/.bun/bin:$PATH"
 *   cd ~/arc-starter
 *   cp db/arc.sqlite db/arc.sqlite.bak-p2-$(date -u +%Y%m%dT%H%M%SZ)   # data rollback point
 *   bun ops-migrations/014-p2-atomic-group-windows.ts
 *   bun ops-migrations/014-p2-atomic-group-windows.ts   # run again — proves convergence
 */

import { Database } from "bun:sqlite";

const DB_PATH = process.env.ARC_DB_PATH ?? "db/arc.sqlite";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function tableInfo(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function rowCount(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
}

function addColumn(db: Database, table: string, columnDef: string, columnName: string): "added" | "already_exists" {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    return "added";
  } catch (err: any) {
    if (String(err?.message ?? err).includes("duplicate column name")) {
      return "already_exists";
    }
    throw err;
  }
}

function main() {
  const db = new Database(DB_PATH);

  log(`DB: ${DB_PATH}`);
  log(`BEFORE — outbound_action: ${rowCount(db, "outbound_action")} rows, cols=[${tableInfo(db, "outbound_action").join(", ")}]`);
  log(`BEFORE — planned_posts: ${rowCount(db, "planned_posts")} rows, cols=[${tableInfo(db, "planned_posts").join(", ")}]`);

  const results: Record<string, string> = {};

  results["outbound_action.earliest_utc_time"] = addColumn(db, "outbound_action", "earliest_utc_time TEXT", "earliest_utc_time");
  results["outbound_action.latest_utc_time"] = addColumn(db, "outbound_action", "latest_utc_time TEXT", "latest_utc_time");
  results["outbound_action.atomic_group_id"] = addColumn(db, "outbound_action", "atomic_group_id TEXT", "atomic_group_id");
  results["planned_posts.earliest_utc_time"] = addColumn(db, "planned_posts", "earliest_utc_time TEXT", "earliest_utc_time");
  results["planned_posts.latest_utc_time"] = addColumn(db, "planned_posts", "latest_utc_time TEXT", "latest_utc_time");

  for (const [col, outcome] of Object.entries(results)) {
    log(`${col}: ${outcome}`);
  }

  log(`AFTER — outbound_action: ${rowCount(db, "outbound_action")} rows, cols=[${tableInfo(db, "outbound_action").join(", ")}]`);
  log(`AFTER — planned_posts: ${rowCount(db, "planned_posts")} rows, cols=[${tableInfo(db, "planned_posts").join(", ")}]`);

  db.close();
  log("Migration complete.");
}

main();
