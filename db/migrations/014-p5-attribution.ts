/**
 * P5 Migration (arc-day-n-publishing): amplification observed-fact columns.
 *
 * Adds 4 columns to `daily_read_log`: `amplified_status` (TEXT NOT NULL DEFAULT 'unknown' —
 * values are ONLY 'unknown'/'amplified'; "declined" is NEVER persisted, it is derived at
 * report/monitor read-time from age + absence-of-observation — dev-council/Newman+Hohpe, P5,
 * CONFIRMED: persisting an inferred timeout as a fact would freeze a wrong terminal value if a
 * late amplification lands after the derivation threshold, and would conflate "operator
 * declined" with "the check pipeline broke" for an empty search corpus), `amplified_source`
 * (TEXT — 'manual'/'auto', null while unknown; the field a manual override's permanence rests
 * on — see edition-metrics.ts's compare-and-swap writes), `amplified_checked_at` (TEXT),
 * `amplified_note` (TEXT).
 *
 * No new column/table for post-engagement metrics — reuses/extends the EXISTING
 * `organic_reach_snapshot` JSON blob via `json_set()` partial updates (see
 * skills/arc-daily-read/lib/edition-metrics.ts and cli.ts's finalizeEditionStatus, both fixed in
 * this phase to use json_set instead of a whole-column overwrite).
 *
 * Additive-only (ALTER TABLE ADD COLUMN). Idempotent: if user_version >= 12, exits 0 silently.
 *
 * Usage: bun run 014-p5-attribution.ts <path-to-db>
 * Bumps user_version 11 -> 12.
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 014-p5-attribution.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[014-p5] Current user_version: ${user_version}`);

if (user_version >= 12) {
  console.log("[014-p5] Already at user_version >= 12. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 11) {
  console.error(`[014-p5] Expected user_version >= 11, got ${user_version}. Run prior migrations first.`);
  db.close();
  process.exit(1);
}

let passed = 0;
function step(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${(e as Error).message}`);
    throw e;
  }
}

function columnExists(table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

try {
  db.exec("BEGIN");

  step("ALTER TABLE daily_read_log ADD COLUMN amplified_status TEXT NOT NULL DEFAULT 'unknown'", () => {
    if (!columnExists("daily_read_log", "amplified_status")) {
      db.exec("ALTER TABLE daily_read_log ADD COLUMN amplified_status TEXT NOT NULL DEFAULT 'unknown'");
    } else {
      console.log("    (amplified_status already present, skipping ALTER)");
    }
  });

  step("ALTER TABLE daily_read_log ADD COLUMN amplified_source TEXT", () => {
    if (!columnExists("daily_read_log", "amplified_source")) {
      db.exec("ALTER TABLE daily_read_log ADD COLUMN amplified_source TEXT");
    } else {
      console.log("    (amplified_source already present, skipping ALTER)");
    }
  });

  step("ALTER TABLE daily_read_log ADD COLUMN amplified_checked_at TEXT", () => {
    if (!columnExists("daily_read_log", "amplified_checked_at")) {
      db.exec("ALTER TABLE daily_read_log ADD COLUMN amplified_checked_at TEXT");
    } else {
      console.log("    (amplified_checked_at already present, skipping ALTER)");
    }
  });

  step("ALTER TABLE daily_read_log ADD COLUMN amplified_note TEXT", () => {
    if (!columnExists("daily_read_log", "amplified_note")) {
      db.exec("ALTER TABLE daily_read_log ADD COLUMN amplified_note TEXT");
    } else {
      console.log("    (amplified_note already present, skipping ALTER)");
    }
  });

  step("PRAGMA user_version=12", () => {
    db.exec("PRAGMA user_version=12");
  });

  db.exec("COMMIT");
  console.log(`\n[014-p5] Migration complete. ${passed} steps passed.`);
  console.log("[014-p5] daily_read_log.amplified_status/amplified_source/amplified_checked_at/amplified_note added.");
  console.log("[014-p5] user_version bumped to 12.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[014-p5] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
