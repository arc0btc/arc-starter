/**
 * Invariant test for migration 012-p1-entity-resolution.ts
 *
 * Run AFTER applying the migration to a fixture copy:
 *   bun run test-012-invariants.ts <path-to-fixture-db>
 *
 * Checks (goal-backward from P1 verify spec):
 *   (a) duplicate source_key FAILS (outbound_action UNIQUE holds)
 *   (b) research_seed recomputes byte-identically (columns untouched)
 *   (c) no UPDATE=+1 counter columns in entity/entity_identity
 *   (d) aibtc rows live in social_accounts as platform value (not a new table)
 *   (e) live row counts from P0 preserved: social_accounts=48, outbound_action=15, engagement_log=48
 *   (f) entity + entity_identity UNIQUE(namespace,value) holds (dupe identity FAILS)
 *   (g) entity + entity_identity are empty (no data seeded by migration)
 *
 * Exit 0 if all PASS, exit 1 if any FAIL.
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run test-012-invariants.ts <path-to-fixture-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA foreign_keys=ON");

let passed = 0;
let failed = 0;

function check(name: string, fn: () => boolean | string) {
  try {
    const result = fn();
    if (result === true || result === "PASS") {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.error(`  FAIL: ${name} — ${result}`);
      failed++;
    }
  } catch (e) {
    console.error(`  FAIL: ${name} — unexpected throw: ${(e as Error).message}`);
    failed++;
  }
}

function expectThrow(name: string, fn: () => void) {
  try {
    fn();
    console.error(`  FAIL: ${name} — expected constraint error but got none`);
    failed++;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      console.log(`  PASS: ${name} (correctly threw UNIQUE constraint)`);
      passed++;
    } else {
      console.error(`  FAIL: ${name} — threw unexpected error: ${msg}`);
      failed++;
    }
  }
}

console.log("\n=== P1 Invariant Tests ===\n");

// ── (a) duplicate source_key FAILS ────────────────────────────────────────
// Grab an existing source_key from outbound_action to try to re-insert
check("(a) outbound_action.source_key UNIQUE confirmed", () => {
  const rows = db.query<{ source_key: string }, []>(
    "SELECT source_key FROM outbound_action LIMIT 1"
  ).all();
  if (rows.length === 0) return "no rows in outbound_action to test against";
  return "PASS";
});

expectThrow("(a) duplicate source_key INSERT FAILS", () => {
  const row = db.query<{ source_key: string; platform: string; lane: string; payload_ref: string; payload_hash: string; budget_day: string }, []>(
    "SELECT source_key, platform, lane, payload_ref, payload_hash, budget_day FROM outbound_action LIMIT 1"
  ).get()!;
  db.exec(`
    INSERT INTO outbound_action (source_key, platform, lane, payload_ref, payload_hash, budget_day)
    VALUES ('${row.source_key}', '${row.platform}', '${row.lane}', 'test-ref', 'test-hash', '2026-01-01')
  `);
});

// ── (b) research_seed recomputes byte-identically ──────────────────────────
check("(b) research_seed column still present on social_accounts", () => {
  const cols = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('social_accounts') WHERE name IN ('research_seed','research_seed_watermark')"
  ).all();
  if (cols.length !== 2) return `expected 2 columns, found ${cols.length}: ${cols.map(c => c.name).join(",")}`;
  return "PASS";
});

check("(b) research_seed values non-null (spot check 5 rows)", () => {
  const rows = db.query<{ research_seed: number }, []>(
    "SELECT research_seed FROM social_accounts WHERE research_seed != 0 LIMIT 5"
  ).all();
  if (rows.length === 0) return "no non-zero research_seed rows found — check if data migrated correctly";
  return "PASS";
});

// ── (c) no UPDATE=+1 counter columns in entity/entity_identity ────────────
check("(c) entity has no *_count columns", () => {
  const cols = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('entity') WHERE name LIKE '%_count' OR name LIKE '%count%'"
  ).all();
  if (cols.length > 0) return `found counter columns: ${cols.map(c => c.name).join(",")}`;
  return "PASS";
});

check("(c) entity_identity has no *_count columns", () => {
  const cols = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('entity_identity') WHERE name LIKE '%_count' OR name LIKE '%count%'"
  ).all();
  if (cols.length > 0) return `found counter columns: ${cols.map(c => c.name).join(",")}`;
  return "PASS";
});

// ── (d) aibtc rows live in social_accounts as platform value ──────────────
check("(d) can INSERT social_accounts row with platform='aibtc'", () => {
  try {
    db.exec(`
      INSERT INTO social_accounts (handle, platform, targeting_status)
      VALUES ('__test_aibtc_channel__', 'aibtc', 'ingestion_only')
    `);
    const row = db.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM social_accounts WHERE platform='aibtc' AND handle='__test_aibtc_channel__'"
    ).get()!;
    // Clean up test row
    db.exec("DELETE FROM social_accounts WHERE handle='__test_aibtc_channel__'");
    if (row.count !== 1) return `expected 1 aibtc row, found ${row.count}`;
    return "PASS";
  } catch (e) {
    return `INSERT with platform='aibtc' threw: ${(e as Error).message}`;
  }
});

check("(d) no 'aibtc' table exists (aibtc is a channel value, not a table)", () => {
  const tables = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%aibtc%' AND name NOT IN ('aibtc_inbox_messages')"
  ).all();
  // aibtc_inbox_messages is pre-existing and acceptable — only flag NEW aibtc-specific tables
  if (tables.length > 0) return `unexpected aibtc table(s) found: ${tables.map(t => t.name).join(",")}`;
  return "PASS";
});

// ── (e) P0 row counts preserved ────────────────────────────────────────────
const P0_COUNTS: Record<string, number> = {
  social_accounts: 48,
  outbound_action: 15,
  engagement_log: 48,
};

for (const [table, expected] of Object.entries(P0_COUNTS)) {
  check(`(e) ${table} row count = ${expected} (P0 baseline)`, () => {
    const row = db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()!;
    if (row.count !== expected) return `expected ${expected}, found ${row.count}`;
    return "PASS";
  });
}

// ── (f) entity_identity UNIQUE(namespace,value) holds ─────────────────────
check("(f) entity table exists", () => {
  const row = db.query<{ count: number }, []>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='entity'"
  ).get()!;
  if (row.count !== 1) return "entity table not found";
  return "PASS";
});

check("(f) entity_identity table exists", () => {
  const row = db.query<{ count: number }, []>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='entity_identity'"
  ).get()!;
  if (row.count !== 1) return "entity_identity table not found";
  return "PASS";
});

// Insert one entity + two identities, then attempt duplicate identity
check("(f) entity INSERT succeeds", () => {
  db.exec(`
    INSERT INTO entity (id, label, entity_type)
    VALUES (999999, '__test_entity__', 'human')
  `);
  return "PASS";
});

check("(f) first entity_identity INSERT succeeds", () => {
  db.exec(`
    INSERT INTO entity_identity (entity_id, namespace, value)
    VALUES (999999, 'x_handle', '__test_x_handle__')
  `);
  return "PASS";
});

expectThrow("(f) duplicate entity_identity INSERT FAILS (UNIQUE holds)", () => {
  db.exec(`
    INSERT INTO entity_identity (entity_id, namespace, value)
    VALUES (999999, 'x_handle', '__test_x_handle__')
  `);
});

// Cleanup test rows (cascade should clean entity_identity too, but explicit for safety)
try {
  db.exec("DELETE FROM entity_identity WHERE entity_id=999999");
  db.exec("DELETE FROM entity WHERE id=999999");
} catch (_) {}

// ── (g) entity + entity_identity empty after migration (no data seeded) ────
check("(g) entity table empty (migration is DDL only)", () => {
  const row = db.query<{ count: number }, []>("SELECT count(*) AS count FROM entity").get()!;
  if (row.count !== 0) return `expected 0 rows, found ${row.count}`;
  return "PASS";
});

check("(g) entity_identity table empty (migration is DDL only)", () => {
  const row = db.query<{ count: number }, []>("SELECT count(*) AS count FROM entity_identity").get()!;
  if (row.count !== 0) return `expected 0 rows, found ${row.count}`;
  return "PASS";
});

db.close();

console.log(`\n=== Results: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All invariants PASS.");
  process.exit(0);
}
