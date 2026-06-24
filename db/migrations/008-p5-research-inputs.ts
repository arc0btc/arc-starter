/**
 * P5 Migration: Research Inputs
 * Adds research_nugget, nugget_source_delivery, research_source_config tables.
 * Additive-only (CREATE TABLE IF NOT EXISTS). Idempotent: guarded by user_version.
 * Bumps user_version 3 → 4.
 *
 * Usage: bun run 008-p5-research-inputs.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 008-p5-research-inputs.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[008-p5] Current user_version: ${user_version}`);

if (user_version >= 4) {
  console.log("[008-p5] Already at user_version >= 4. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 3) {
  console.error(`[008-p5] Expected user_version >= 3, got ${user_version}. Run P1-P4 migrations first.`);
  db.close();
  process.exit(1);
}

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

  step("CREATE TABLE research_nugget", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_nugget (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nugget_ref TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK(source IN ('hn','reddit','rss','github_release','arxiv')),
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
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  step("CREATE UNIQUE INDEX idx_nugget_source_ref", () => {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nugget_source_ref
        ON research_nugget(source, source_ref)
    `);
  });

  step("CREATE INDEX idx_nugget_promotable", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nugget_promotable
        ON research_nugget(is_promotable, source)
    `);
  });

  step("CREATE INDEX idx_nugget_fetch_ts", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nugget_fetch_ts
        ON research_nugget(fetch_ts)
    `);
  });

  step("CREATE INDEX idx_nugget_content_hash", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nugget_content_hash
        ON research_nugget(content_hash)
    `);
  });

  step("CREATE TABLE nugget_source_delivery", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nugget_source_delivery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nugget_ref TEXT NOT NULL REFERENCES research_nugget(nugget_ref),
        source TEXT NOT NULL CHECK(source IN ('hn','reddit','rss','github_release','arxiv')),
        source_url TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        delivered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(nugget_ref, source)
      )
    `);
  });

  step("CREATE INDEX idx_delivery_nugget", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_delivery_nugget
        ON nugget_source_delivery(nugget_ref)
    `);
  });

  step("CREATE TABLE research_source_config", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_source_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL UNIQUE CHECK(source IN ('hn','reddit','rss','github_release','arxiv')),
        enabled INTEGER NOT NULL DEFAULT 1,
        preflight_ts TEXT,
        preflight_status TEXT CHECK(preflight_status IN ('pass','fail','pending') OR preflight_status IS NULL),
        preflight_notes TEXT,
        fetch_interval_minutes INTEGER NOT NULL DEFAULT 360,
        last_fetched_at TEXT,
        last_nugget_count INTEGER,
        config_json TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  step("PRAGMA user_version=4", () => {
    db.exec("PRAGMA user_version=4");
  });

  db.exec("COMMIT");
  console.log(`\n[008-p5] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[008-p5] user_version bumped to 4.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[008-p5] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
