/**
 * P7 Migration: Moltbook Labeled Experiment
 * Adds moltbook_post table and seeds checkout_config with ?a=moltbook row.
 * Additive-only (CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE). Idempotent.
 * Bumps user_version 5 → 6.
 *
 * Attribution guardrail (OPERATING-CONTRACT.md §2 + QUEST.md):
 *   - ?a=moltbook is OBSERVED class (channel-level only)
 *   - NEVER joins to a social post (no planned_post_id)
 *   - NEVER joins to a person-level conversion (no account_id)
 *   - NEVER counted in revenue totals (no whop_sale rows from Moltbook hits)
 *   - Agent traffic ≠ human demand (three independent buckets: human/agent/unknown)
 *
 * Usage: bun run 011-p7-moltbook.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 011-p7-moltbook.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[011-p7] Current user_version: ${user_version}`);

if (user_version >= 6) {
  console.log("[011-p7] Already at user_version >= 6. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 5) {
  console.error(`[011-p7] Expected user_version >= 5, got ${user_version}. Run P1-P6 migrations first.`);
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

  // ── moltbook_post: records each post sent to Moltbook ─────────────────────
  // provider_post_id is the Moltbook UUID (confirmed via GET /posts/{id} read-back).
  // labeled_link must always be set to the ?a=moltbook URL (observed class).
  // read_back_ok=1 only after GET /posts/{provider_post_id} confirms the post exists.
  // Agent traffic classification lives in CLASSIFICATION-POLICY.md (not this table).
  step("CREATE TABLE moltbook_post", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS moltbook_post (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_post_id     TEXT NOT NULL UNIQUE,   -- Moltbook UUID
        submolt_name         TEXT NOT NULL,
        title                TEXT NOT NULL,
        content              TEXT,
        url                  TEXT,                   -- the labeled link if type=link
        post_type            TEXT NOT NULL DEFAULT 'text'
                               CHECK(post_type IN ('text','link','image')),
        labeled_link         TEXT,                   -- must contain ?a=moltbook
        a_param              TEXT NOT NULL DEFAULT 'moltbook',
        upvotes              INTEGER NOT NULL DEFAULT 0,
        downvotes            INTEGER NOT NULL DEFAULT 0,
        comments_count       INTEGER NOT NULL DEFAULT 0,
        outbound_action_id   INTEGER REFERENCES outbound_action(id),
        experiment_id        TEXT NOT NULL DEFAULT 'p7-moltbook-2026',
        posted_at            TEXT NOT NULL,
        read_back_at         TEXT,                   -- timestamp of GET /posts/{id} confirmation
        read_back_ok         INTEGER NOT NULL DEFAULT 0  -- 1 when provider confirmed
                               CHECK(read_back_ok IN (0,1)),
        created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  step("CREATE INDEX idx_moltbook_post_experiment", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_moltbook_post_experiment
        ON moltbook_post(experiment_id, posted_at)
    `);
  });

  step("CREATE INDEX idx_moltbook_post_read_back", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_moltbook_post_read_back
        ON moltbook_post(read_back_ok, posted_at)
    `);
  });

  // ── Seed checkout_config: moltbook channel ────────────────────────────────
  // ?a=moltbook is observed-class only. This row exists to track the labeled link
  // in the same config table as Whop, but it NEVER creates a whop_sale row.
  // It is excluded from all revenue queries (product_id='moltbook' is not a Whop product).
  step("SEED checkout_config: moltbook channel", () => {
    db.exec(`
      INSERT OR IGNORE INTO checkout_config
        (product_id, plan_id, product_name, base_url, affiliate_code, a_param,
         full_checkout_url, url_verified_at)
      VALUES
        ('moltbook', NULL, 'Moltbook experiment channel — observed class only',
         'https://arc0.me', NULL, 'moltbook',
         'https://arc0.me?a=moltbook', NULL)
    `);
  });

  step("PRAGMA user_version=6", () => {
    db.exec("PRAGMA user_version=6");
  });

  db.exec("COMMIT");
  console.log(`\n[011-p7] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[011-p7] user_version bumped to 6.");
  console.log("[011-p7] Tables added: moltbook_post.");
  console.log("[011-p7] checkout_config seeded: moltbook channel (observed-class ?a=moltbook).");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[011-p7] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
