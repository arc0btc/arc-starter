/**
 * P5 Migration: research_nugget / nugget_source_delivery bridge (arc-x-research-channel quest,
 * Phase 5). Widens the `source` CHECK on both tables to add 'link_research' — the catch-all
 * value for anything arc-link-research produces (news-search / list-roster / keyword-rotation /
 * email — granular provenance lives in the new `origin_lane` column, not the CHECK enum, so the
 * enum never needs to grow again for a future lane). Adds three nullable columns to
 * research_nugget: `report_path` (research/*.md this nugget's report lives at, once one
 * exists), `origin_lane` (which intake produced it), `promoted_at` (ISO8601 — non-NULL means "a
 * research/*.md report exists for this nugget," set by either direction of the bridge).
 *
 * SQLite can't ALTER a CHECK constraint in place — this recreates both tables (the standard
 * widen-a-CHECK recipe): CREATE ..._new with the widened CHECK -> INSERT INTO ..._new SELECT
 * FROM old -> DROP old -> RENAME new -> old, then recreate every index. Wrapped in one
 * transaction; foreign_keys is OFF for this DB already (confirmed live query) and stays OFF.
 *
 * Additive/idempotent: guarded by user_version. Bumps user_version 14 -> 15.
 *
 * Usage: bun run 017-p5-nugget-bridge.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 017-p5-nugget-bridge.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[017-p5] Current user_version: ${user_version}`);

if (user_version >= 15) {
  console.log("[017-p5] Already at user_version >= 15. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 14) {
  console.error(`[017-p5] Expected user_version >= 14, got ${user_version}. Run prior migrations first.`);
  db.close();
  process.exit(1);
}

const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
console.log(`[017-p5] foreign_keys pragma currently: ${fk.foreign_keys} (expected 0 — this DB has never enabled FK enforcement)`);

let passed = 0;
let failed = 0;

function step(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${(e as Error).message}`);
    failed++;
    throw e;
  }
}

try {
  db.exec("BEGIN");

  step("CREATE TABLE research_nugget_new (widened CHECK + 3 new columns)", () => {
    db.exec(`
      CREATE TABLE research_nugget_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nugget_ref TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK(source IN ('hn','reddit','rss','github_release','arxiv','link_research')),
        source_url TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        fetch_ts TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        author TEXT,
        published_at TEXT,
        rubric_specificity INTEGER CHECK(rubric_specificity BETWEEN 0 AND 10 OR rubric_specificity IS NULL),
        rubric_operator_pain INTEGER CHECK(rubric_operator_pain BETWEEN 0 AND 10 OR rubric_operator_pain IS NULL),
        rubric_novelty INTEGER CHECK(rubric_novelty BETWEEN 0 AND 10 OR rubric_novelty IS NULL),
        rubric_actionability INTEGER CHECK(rubric_actionability BETWEEN 0 AND 10 OR rubric_actionability IS NULL),
        rubric_density INTEGER CHECK(rubric_density BETWEEN 0 AND 10 OR rubric_density IS NULL),
        rubric_total INTEGER NOT NULL DEFAULT 0,
        rubric_version TEXT DEFAULT 'rubric-v1.0',
        rubric_scored_at TEXT,
        is_promotable INTEGER NOT NULL DEFAULT 0,
        fan_in_count INTEGER NOT NULL DEFAULT 1,
        fan_in_sources TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        report_path TEXT,
        origin_lane TEXT,
        promoted_at TEXT
      )
    `);
  });

  step("Copy research_nugget rows into research_nugget_new (3 new columns NULL)", () => {
    db.exec(`
      INSERT INTO research_nugget_new
        (id, nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body,
         author, published_at, rubric_specificity, rubric_operator_pain, rubric_novelty,
         rubric_actionability, rubric_density, rubric_total, rubric_version, rubric_scored_at,
         is_promotable, fan_in_count, fan_in_sources, created_at, report_path, origin_lane, promoted_at)
      SELECT
        id, nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body,
        author, published_at, rubric_specificity, rubric_operator_pain, rubric_novelty,
        rubric_actionability, rubric_density, rubric_total, rubric_version, rubric_scored_at,
        is_promotable, fan_in_count, fan_in_sources, created_at, NULL, NULL, NULL
      FROM research_nugget
    `);
  });

  step("DROP old research_nugget, RENAME new -> research_nugget", () => {
    db.exec("DROP TABLE research_nugget");
    db.exec("ALTER TABLE research_nugget_new RENAME TO research_nugget");
  });

  step("Recreate research_nugget indexes (4 original + 1 new)", () => {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nugget_source_ref ON research_nugget(source, source_ref)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nugget_promotable ON research_nugget(is_promotable, source)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nugget_fetch_ts ON research_nugget(fetch_ts)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nugget_content_hash ON research_nugget(content_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nugget_promoted_pending ON research_nugget(is_promotable, promoted_at)`);
  });

  step("CREATE TABLE nugget_source_delivery_new (widened CHECK)", () => {
    db.exec(`
      CREATE TABLE nugget_source_delivery_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nugget_ref TEXT NOT NULL REFERENCES research_nugget(nugget_ref),
        source TEXT NOT NULL CHECK(source IN ('hn','reddit','rss','github_release','arxiv','link_research')),
        source_url TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        delivered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(nugget_ref, source)
      )
    `);
  });

  step("Copy nugget_source_delivery rows into nugget_source_delivery_new", () => {
    db.exec(`
      INSERT INTO nugget_source_delivery_new (id, nugget_ref, source, source_url, source_ref, delivered_at)
      SELECT id, nugget_ref, source, source_url, source_ref, delivered_at FROM nugget_source_delivery
    `);
  });

  step("DROP old nugget_source_delivery, RENAME new -> nugget_source_delivery", () => {
    db.exec("DROP TABLE nugget_source_delivery");
    db.exec("ALTER TABLE nugget_source_delivery_new RENAME TO nugget_source_delivery");
  });

  step("Recreate nugget_source_delivery index", () => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_nugget ON nugget_source_delivery(nugget_ref)`);
  });

  step("PRAGMA user_version=15", () => {
    db.exec("PRAGMA user_version=15");
  });

  db.exec("COMMIT");
  console.log(`\n[017-p5] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[017-p5] user_version bumped to 15.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[017-p5] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
