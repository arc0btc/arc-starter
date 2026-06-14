// src/source-ledger.ts
// Shared source-dedup ledger factory (P15 — forge's P14 carry-forward: stop hand-mirroring the
// <source PK, id, ...extra, ts> table per skill). The --source key is the exactly-once primitive for
// non-idempotent external writes (whop / x / nostr / news / paid inbox). createSourceLedger() returns
// { has, dedupSkip, record, sum } over a per-table schema in the shared db/arc.sqlite.
//
// Table/column names are developer-supplied constants (never user input) — safe to interpolate.
// New ledgers should be built on this; the existing nostr_post_log / x_post_log / news_signal_log
// can migrate onto it incrementally (they pre-date it and differ only in the timestamp column name).

import { initDatabase, getDatabase } from "./db.ts";

export interface SourceLedger {
  /** True if `source` already exists (no logging). Always false for undefined. */
  has(source: string | undefined): boolean;
  /** True if `source` was already recorded — logs a structured skip line. False for undefined. */
  dedupSkip(source: string | undefined, verb?: string): boolean;
  /** Idempotent insert keyed by the `source` PK. `id` = external id; `extra` fills extraColumns. */
  record(source: string, id: string | null, extra?: Record<string, string | number | null>): void;
  /** Sum a numeric column across all rows (e.g. total sats spent). Returns 0 when empty. */
  sum(column: string): number;
}

export function createSourceLedger(opts: {
  table: string;
  idColumn: string;
  extraColumns?: Array<{ name: string; type: "TEXT" | "INTEGER" }>;
}): SourceLedger {
  initDatabase();
  const db = getDatabase();
  const extra = opts.extraColumns ?? [];
  const schema = [
    "source TEXT PRIMARY KEY",
    `${opts.idColumn} TEXT`,
    ...extra.map((c) => `${c.name} ${c.type}`),
    "recorded_at TEXT NOT NULL",
  ].join(", ");
  db.run(`CREATE TABLE IF NOT EXISTS ${opts.table} (${schema})`);

  return {
    has(source) {
      if (!source) return false;
      return !!db.query(`SELECT 1 FROM ${opts.table} WHERE source = ?`).get(source);
    },
    dedupSkip(source, verb = "recorded") {
      if (!source) return false;
      const row = db
        .query(`SELECT ${opts.idColumn} AS id FROM ${opts.table} WHERE source = ?`)
        .get(source) as { id: string | null } | null;
      if (!row) return false;
      console.log(
        JSON.stringify({ deduped: true, source, id: row.id ?? null, message: `already ${verb} — skipping` }, null, 2),
      );
      return true;
    },
    record(source, id, extraValues = {}) {
      const names = ["source", opts.idColumn, ...extra.map((c) => c.name), "recorded_at"];
      const values = [source, id, ...extra.map((c) => extraValues[c.name] ?? null), new Date().toISOString()];
      const placeholders = names.map(() => "?").join(", ");
      db.query(`INSERT OR IGNORE INTO ${opts.table} (${names.join(", ")}) VALUES (${placeholders})`).run(...values);
    },
    sum(column) {
      const r = db.query(`SELECT COALESCE(SUM(${column}), 0) AS s FROM ${opts.table}`).get() as { s: number };
      return r.s;
    },
  };
}
