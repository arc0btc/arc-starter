#!/usr/bin/env bun
/**
 * 016-p3-global-reserved-column.ts
 * arc-posting-scheduler P3 — additive schema extension for the cross-lane global backstop.
 *
 * Adds:
 *   outbound_action.global_reserved  INTEGER NOT NULL DEFAULT 0
 *
 * admitGroup() (P3) reserves a SECOND, cross-lane "__global__" budget_ledger slot per row
 * whenever the caller supplies `globalCap` (DAILY_TWEET_CAP's absolute backstop) — a flag is
 * needed on each row so the release functions (releaseAbandonedReservations,
 * releaseSingleReservation, releaseGroupRemainder — all SHARED with admitAction()'s
 * single-row reply/post-lane rows, which never touch the global counter) know whether to
 * ALSO release a global slot when releasing a row. Without this flag, releasing a legacy
 * admitAction() row would incorrectly decrement a counter it never incremented.
 *
 * DEFAULT 0 means every existing row (all admitted before this phase, none of which used
 * globalCap) reads as "did not reserve a global slot" — correct, since globalCap didn't
 * exist yet when they were admitted.
 *
 * Idempotent: ALTER wrapped in try/catch (matches 014's own pattern) — safe to re-run.
 *
 * Usage (on the Arc VM):
 *   export PATH="$HOME/.bun/bin:$PATH"
 *   cd ~/arc-starter
 *   cp db/arc.sqlite db/arc.sqlite.bak-p3-$(date -u +%Y%m%dT%H%M%SZ)   # data rollback point
 *   bun ops-migrations/016-p3-global-reserved-column.ts
 *   bun ops-migrations/016-p3-global-reserved-column.ts   # run again — proves convergence
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

function addColumn(db: Database, table: string, columnDef: string): "added" | "already_exists" {
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

  const outcome = addColumn(db, "outbound_action", "global_reserved INTEGER NOT NULL DEFAULT 0");
  log(`outbound_action.global_reserved: ${outcome}`);

  log(`AFTER — outbound_action: ${rowCount(db, "outbound_action")} rows, cols=[${tableInfo(db, "outbound_action").join(", ")}]`);

  db.close();
  log("Migration complete.");
}

main();
