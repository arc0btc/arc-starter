/**
 * P2 Migration: Candidate-Maturation Spine (arc-x-research-channel quest, Phase 2)
 * Adds x_research_candidate — the shared "store, don't judge at birth" store that
 * every discovery lane (keyword-rotation legacy producer this phase; news-search,
 * trends, list-roster in Phases 3-4) feeds. A candidate is scored ONCE at
 * discovery time is exactly the bug this migration fixes: instead, candidates
 * are stored at first_seen and re-scored later (2-24h aged) by the
 * candidate-maturation sensor via ONE batched GET /2/tweets?ids= read.
 * Additive-only (CREATE TABLE IF NOT EXISTS). Idempotent: guarded by user_version.
 * Bumps user_version 12 -> 13.
 *
 * Usage: bun run 015-p2-candidate-spine.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 015-p2-candidate-spine.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[015-p2] Current user_version: ${user_version}`);

if (user_version >= 13) {
  console.log("[015-p2] Already at user_version >= 13. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 12) {
  console.error(`[015-p2] Expected user_version >= 12, got ${user_version}. Run prior migrations first.`);
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

  step("CREATE TABLE x_research_candidate", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS x_research_candidate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweet_id TEXT NOT NULL UNIQUE,
        source_lane TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        author_id TEXT,
        text_snippet TEXT,
        urls TEXT,
        discovery_context TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','matured','rejected','expired')),
        matured_at TEXT,
        research_task_id INTEGER REFERENCES tasks(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  step("CREATE INDEX idx_candidate_maturation_window", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_candidate_maturation_window
        ON x_research_candidate(status, first_seen)
    `);
  });

  step("CREATE INDEX idx_candidate_source_lane", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_candidate_source_lane
        ON x_research_candidate(source_lane)
    `);
  });

  step("PRAGMA user_version=13", () => {
    db.exec("PRAGMA user_version=13");
  });

  db.exec("COMMIT");
  console.log(`\n[015-p2] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[015-p2] user_version bumped to 13.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[015-p2] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
