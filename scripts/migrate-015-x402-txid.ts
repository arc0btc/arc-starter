/**
 * migrate-015-x402-txid.ts — Migration 015: txid-canonical x402_sale + x402_fund_ledger
 *
 * Council review applied:
 *   - Kleppmann: ON CONFLICT DO UPDATE with CAS state guard (not INSERT OR IGNORE)
 *   - Lamport: cap counts pending rows (intent-based, documented)
 *   - Newman: pull-loop reads via Worker /honored endpoint, not direct KV API
 *
 * Safety: REFUSES to run against the live DB path.
 * Usage: bun migrate-015-x402-txid.ts <path-to-db>
 *
 * Run on fixture copy first, then on live DB with .bak backup already made.
 */

import { Database } from "bun:sqlite";

const LIVE_DB_PATHS = [
  "/home/dev/arc-starter/db/arc.sqlite",
  "/home/dev/arc-starter/arc.sqlite",
];

function isLiveDb(path: string): boolean {
  return LIVE_DB_PATHS.some((p) => path === p || path.endsWith("/arc.sqlite") && !path.includes("/tmp/"));
}

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun migrate-015-x402-txid.ts <path-to-db>");
  process.exit(1);
}
if (isLiveDb(dbPath) && !process.argv.includes("--live")) {
  console.error(`SAFETY: refusing to run against live DB without --live flag: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA foreign_keys=ON");

const currentVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
console.log(`Current user_version: ${currentVersion}`);

if (currentVersion >= 8) {
  console.log("Already at user_version >= 8. Checking tables exist...");
  const tables = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('x402_sale','x402_fund_ledger')"
  ).all() as { name: string }[];
  console.log("Tables found:", tables.map(t => t.name).join(", "));
  db.close();
  process.exit(0);
}

console.log("Applying migration 015...");

db.run(`
  CREATE TABLE IF NOT EXISTS x402_sale (
    id                     INTEGER PRIMARY KEY,
    chain                  TEXT NOT NULL CHECK (chain IN ('stacks','base','solana')),
    txid                   TEXT NOT NULL,
    payment_id             TEXT NOT NULL,
    buyer_address          TEXT,
    product_slug           TEXT NOT NULL,
    asset                  TEXT NOT NULL CHECK (asset IN ('STX','sBTC','USDCx','USDC','SOL')),
    amount_base_units      INTEGER NOT NULL,
    payment_status         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (payment_status IN ('pending','confirmed','refunded')),
    provenance             TEXT NOT NULL DEFAULT 'organic'
                           CHECK (provenance IN ('organic','self_funded_test')),
    attribution_confidence TEXT NOT NULL DEFAULT 'trusted'
                           CHECK (attribution_confidence IN ('trusted','observed','inferred')),
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    confirmed_at           TEXT,
    UNIQUE(chain, txid)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS x402_fund_ledger (
    id               INTEGER PRIMARY KEY,
    idempotency_key  TEXT NOT NULL UNIQUE,
    payer_agent      TEXT NOT NULL,
    product_slug     TEXT NOT NULL,
    day_utc          TEXT NOT NULL,
    fund_txid        TEXT,
    fund_amount_ustx INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','broadcasting','confirmed','skipped')),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )
`);

db.run("PRAGMA user_version = 8");

console.log("Tables created. Running replay idempotency test...");

// ── Replay test: insert same txid twice → exactly 1 row ──────────────────────
const TEST_TXID = "0x" + "a".repeat(64);
const TEST_CHAIN = "stacks";

// Simulate pull-loop upsert (Kleppmann fix: CAS on payment_status)
function upsertX402Sale(chain: string, txid: string, paymentId: string, productSlug: string, asset: string, amountBaseUnits: number, provenance: string, confirmedAt: string) {
  db.run(`
    INSERT INTO x402_sale (chain, txid, payment_id, product_slug, asset, amount_base_units,
                           payment_status, provenance, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    ON CONFLICT(chain, txid) DO UPDATE SET
      payment_status = CASE WHEN x402_sale.payment_status = 'pending' THEN 'confirmed'
                            ELSE x402_sale.payment_status END,
      confirmed_at   = CASE WHEN x402_sale.payment_status = 'pending' THEN excluded.confirmed_at
                            ELSE x402_sale.confirmed_at END
  `, [chain, txid, paymentId, productSlug, asset, amountBaseUnits, provenance, confirmedAt]);
}

const now = new Date().toISOString();
upsertX402Sale(TEST_CHAIN, TEST_TXID, "pay_test001", "research-daily", "STX", 49627665, "self_funded_test", now);
upsertX402Sale(TEST_CHAIN, TEST_TXID, "pay_test001", "research-daily", "STX", 49627665, "self_funded_test", now);

const count = (db.query("SELECT COUNT(*) as n FROM x402_sale WHERE chain=? AND txid=?").get(TEST_CHAIN, TEST_TXID) as { n: number }).n;
const row = db.query("SELECT payment_status, provenance FROM x402_sale WHERE chain=? AND txid=?").get(TEST_CHAIN, TEST_TXID) as { payment_status: string; provenance: string };

console.log(`  Replay test: txid inserted twice → ${count} row(s) in x402_sale (expected: 1)`);
console.log(`  Row: payment_status=${row.payment_status}, provenance=${row.provenance}`);

if (count !== 1) {
  console.error("FAIL: replay test — expected exactly 1 row, got", count);
  db.close();
  process.exit(1);
}
if (row.payment_status !== "confirmed") {
  console.error("FAIL: payment_status should be 'confirmed', got", row.payment_status);
  db.close();
  process.exit(1);
}
console.log("  PASS: replay → exactly 1 row, status=confirmed");

// Clean up test row
db.run("DELETE FROM x402_sale WHERE chain=? AND txid=?", [TEST_CHAIN, TEST_TXID]);

// ── CAS state guard test: confirmed → pending must be blocked ─────────────────
upsertX402Sale(TEST_CHAIN, TEST_TXID, "pay_test002", "research-daily", "STX", 49627665, "self_funded_test", now);
// Try to revert to pending (simulate stale observer)
db.run(`
  INSERT INTO x402_sale (chain, txid, payment_id, product_slug, asset, amount_base_units,
                         payment_status, provenance, confirmed_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  ON CONFLICT(chain, txid) DO UPDATE SET
    payment_status = CASE WHEN x402_sale.payment_status = 'pending' THEN 'confirmed'
                          ELSE x402_sale.payment_status END,
    confirmed_at   = CASE WHEN x402_sale.payment_status = 'pending' THEN excluded.confirmed_at
                          ELSE x402_sale.confirmed_at END
`, [TEST_CHAIN, TEST_TXID, "pay_test002", "research-daily", "STX", 49627665, "self_funded_test", now]);

const casRow = db.query("SELECT payment_status FROM x402_sale WHERE chain=? AND txid=?").get(TEST_CHAIN, TEST_TXID) as { payment_status: string };
console.log(`  CAS test: tried to revert confirmed→pending → status is ${casRow.payment_status} (expected: confirmed)`);
if (casRow.payment_status !== "confirmed") {
  console.error("FAIL: CAS guard failed — confirmed was reverted to", casRow.payment_status);
  db.close();
  process.exit(1);
}
console.log("  PASS: CAS guard holds — confirmed cannot be reverted to pending");

// Clean up
db.run("DELETE FROM x402_sale WHERE chain=? AND txid=?", [TEST_CHAIN, TEST_TXID]);

const finalVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
console.log(`\nMigration 015 complete. user_version=${finalVersion}`);
db.close();
console.log("ALL PASS");
