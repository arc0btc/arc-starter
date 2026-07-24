/**
 * P4 Migration: List-roster membership tracking (arc-x-research-channel quest, Phase 4)
 * Adds social_accounts.list_member_added_at — mirrors the existing followed_at column's
 * shape/semantics (NULL = not yet added to the private X List; ISO8601 timestamp once
 * skills/list-roster/sensor.ts (or the follow-policy hook) successfully adds the account
 * as a List member). Additive-only. Idempotent: guarded by user_version.
 * Bumps user_version 13 -> 14.
 *
 * Usage: bun run 016-p4-list-roster.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 016-p4-list-roster.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[016-p4] Current user_version: ${user_version}`);

if (user_version >= 14) {
  console.log("[016-p4] Already at user_version >= 14. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 13) {
  console.error(`[016-p4] Expected user_version >= 13, got ${user_version}. Run prior migrations first.`);
  db.close();
  process.exit(1);
}

const cols = db.query("PRAGMA table_info(social_accounts)").all() as Array<{ name: string }>;
const hasCol = cols.some((c) => c.name === "list_member_added_at");

if (!hasCol) {
  db.exec("ALTER TABLE social_accounts ADD COLUMN list_member_added_at TEXT");
  console.log("[016-p4] Added social_accounts.list_member_added_at");
} else {
  console.log("[016-p4] Column list_member_added_at already present — skipping ALTER");
}

db.exec("PRAGMA user_version = 14");
console.log("[016-p4] user_version bumped to 14");

db.close();
console.log("[016-p4] Migration complete.");
