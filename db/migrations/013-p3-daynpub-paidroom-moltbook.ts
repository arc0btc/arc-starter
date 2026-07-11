/**
 * P3 Migration (arc-day-n-publishing): paid-room-seeding pause + Moltbook mirror idempotency.
 *
 * 1. Adds `moltbook_post.blog_slug` (nullable) + a partial UNIQUE index, so the new per-post
 *    mirror (moltbook-mirror-post.ts) can check idempotency BEFORE any network call, keyed on
 *    the blog slug rather than the Moltbook-assigned provider_post_id (which doesn't exist yet
 *    at check time).
 * 2. Seeds `agent_config.PAID_ROOM_SEEDING_PAUSED = 'true'` — the single-value-rollback flag
 *    ContentCalendarMachine's paid-room hops (whop-chat seed, whop-forum thread, public-forum
 *    $49 CTA teaser, the X-thread's embedded CTA-reply) and blog-publishing's CTA footer check,
 *    per QUEST.md's "pause paid-room seeding until an organic member exists" mandate. Same
 *    convention as DAYN_MERGED / DAYN_EMAIL_ENABLED (agent_config row, not an env var — instant
 *    rollback via UPDATE, no .bak restore needed).
 *
 * Additive-only (ALTER TABLE ADD COLUMN, CREATE INDEX IF NOT EXISTS, INSERT OR IGNORE).
 * Idempotent: if user_version >= 11, exits 0 silently.
 *
 * Usage: bun run 013-p3-daynpub-paidroom-moltbook.ts <path-to-db>
 * Bumps user_version 10 -> 11.
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 013-p3-daynpub-paidroom-moltbook.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[013-p3] Current user_version: ${user_version}`);

if (user_version >= 11) {
  console.log("[013-p3] Already at user_version >= 11. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 10) {
  console.error(`[013-p3] Expected user_version >= 10, got ${user_version}. Run prior migrations first.`);
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

  step("ALTER TABLE moltbook_post ADD COLUMN blog_slug", () => {
    if (!columnExists("moltbook_post", "blog_slug")) {
      db.exec("ALTER TABLE moltbook_post ADD COLUMN blog_slug TEXT");
    } else {
      console.log("    (blog_slug already present, skipping ALTER)");
    }
  });

  step("CREATE UNIQUE INDEX idx_moltbook_post_blog_slug (partial, blog_slug IS NOT NULL)", () => {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_moltbook_post_blog_slug
         ON moltbook_post(blog_slug) WHERE blog_slug IS NOT NULL`
    );
  });

  step("SEED agent_config: PAID_ROOM_SEEDING_PAUSED='true'", () => {
    db.exec(
      `INSERT OR IGNORE INTO agent_config (key, value, updated_at)
       VALUES ('PAID_ROOM_SEEDING_PAUSED', 'true', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    );
  });

  step("PRAGMA user_version=11", () => {
    db.exec("PRAGMA user_version=11");
  });

  db.exec("COMMIT");
  console.log(`\n[013-p3] Migration complete. ${passed} steps passed.`);
  console.log("[013-p3] moltbook_post.blog_slug added; agent_config.PAID_ROOM_SEEDING_PAUSED seeded (true).");
  console.log("[013-p3] user_version bumped to 11.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[013-p3] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
