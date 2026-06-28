/**
 * P1 Migration: Entity-Resolution + aibtc as Channel
 *
 * Adds entity + entity_identity tables for canonical identity linking:
 *   X handle ↔ aibtc agent name ↔ STX wallet ↔ Whop member ↔ email
 *
 * aibtc is folded in as a platform VALUE in social_accounts (no new tables).
 * This migration is ADDITIVE ONLY — no existing tables/columns/indexes are altered.
 *
 * Invariants preserved:
 *   - outbound_action.source_key UNIQUE (untouched)
 *   - social_accounts.handle UNIQUE (untouched)
 *   - budget_ledger UNIQUE(channel,utc_day,lane) (untouched)
 *   - research_seed + research_seed_watermark columns (untouched)
 *   - No UPDATE=+1 counters added
 *
 * Usage: bun run 012-p1-entity-resolution.ts <path-to-db>
 * Bumps user_version 9 → 10.
 *
 * Idempotent: if user_version >= 10, exits 0 silently.
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 012-p1-entity-resolution.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[012-p1] Current user_version: ${user_version}`);

if (user_version >= 10) {
  console.log("[012-p1] Already at user_version >= 10. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 9) {
  console.error(`[012-p1] Expected user_version 9, got ${user_version}. Ensure all prior migrations have run.`);
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

  // ── entity: canonical person/agent/org spine ───────────────────────────────
  // One row per real-world entity. Identities link here via entity_identity.
  // Do NOT duplicate social_accounts rows — link via entity_identity(namespace='x_handle').
  step("CREATE TABLE entity", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        label       TEXT,               -- human-readable label (e.g. "@arc0btc", "Arc")
        entity_type TEXT NOT NULL DEFAULT 'unknown'
                    CHECK(entity_type IN ('human','agent','org','unknown')),
        notes       TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  // ── entity_identity: multi-namespace identity links ───────────────────────
  // Namespace values cover the five known identity channels.
  // UNIQUE(namespace, value) ensures one entity per namespace/value pair —
  // the same X handle cannot resolve to two entities.
  step("CREATE TABLE entity_identity", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_identity (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id   INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
        namespace   TEXT NOT NULL
                    CHECK(namespace IN ('x_handle','aibtc_agent','stx_wallet','whop_member','email')),
        value       TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(namespace, value)
      )
    `);
  });

  // ── Indexes for common lookup patterns ────────────────────────────────────

  // Lookup all identities for a given entity
  step("CREATE INDEX idx_entity_identity_entity_id", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entity_identity_entity_id
        ON entity_identity(entity_id)
    `);
  });

  // Resolve an identity to its entity (the primary lookup path)
  step("CREATE INDEX idx_entity_identity_lookup", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entity_identity_lookup
        ON entity_identity(namespace, value)
    `);
  });

  step("PRAGMA user_version=10", () => {
    db.exec("PRAGMA user_version=10");
  });

  db.exec("COMMIT");

  console.log(`\n[012-p1] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[012-p1] user_version bumped 9 → 10.");
  console.log("[012-p1] Tables added: entity, entity_identity.");
  console.log("[012-p1] Indexes added: idx_entity_identity_entity_id, idx_entity_identity_lookup.");
  console.log("[012-p1] No existing tables/columns altered. All prior invariants preserved.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[012-p1] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
