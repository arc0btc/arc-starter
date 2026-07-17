/**
 * P7 Migration (control-plane-remediation, track c): click-attribution instrumentation.
 *
 * Adds click_log (additive-only, new table) and seeds a single stable checkout_config row
 * for the $9 tripwire's rotating-SKU pointer (product_id='latest-report'). Both close named
 * gaps: report.ts:711's known_gaps note ("?src= and ?a= are DISJOINT attribution namespaces ...
 * there is no way today to answer 'did this src=day-n-x click become that Whop purchase'") and
 * P6 defect row 39 ("no stable $9 checkout URL exists anywhere in the codebase").
 *
 * click_log.ref_code is the SAME namespace as whop_sale.a_param / x402_sale.a_param /
 * checkout_config.a_param -- report.ts's reconciliation pass joins across them by that shared
 * value, not a second tag vocabulary.
 *
 * Additive-only (CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE). Idempotent.
 * Bumps user_version 16 -> 17.
 *
 * Usage: bun run 019-p7-click-attribution.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 019-p7-click-attribution.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[019-p7] Current user_version: ${user_version}`);

if (user_version >= 17) {
  console.log("[019-p7] Already at user_version >= 17. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 16) {
  console.error(`[019-p7] Expected user_version >= 16, got ${user_version}. Run prior migrations first.`);
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

  // ── click_log: records each observed click on an outbound CTA / checkout link ─────────────
  // ref_code shares the SAME namespace as whop_sale.a_param / x402_sale.a_param /
  // checkout_config.a_param (SRC_TAGS tag values, e.g. day-n-x/email/moltbook, or a
  // checkout_config.a_param channel) — this is what makes the report.ts join possible.
  // Real click volume is not wired to this table live this phase (that needs a deployed
  // /go/:ref redirect + a KV-to-click_log sync step, both named as follow-ups) — this phase's
  // ingestion point is the `record-click` CLI subcommand (manual/scripted only).
  step("CREATE TABLE click_log", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS click_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_code      TEXT NOT NULL,
        surface       TEXT NOT NULL,
        target_url    TEXT NOT NULL,
        clicked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        source_note   TEXT,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  step("CREATE INDEX idx_click_log_ref_code", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_click_log_ref_code
        ON click_log(ref_code, clicked_at)
    `);
  });

  // ── Seed checkout_config: stable $9 tripwire pointer ───────────────────────────────────────
  // full_checkout_url starts NULL — arc-packaging's `stage` command (skills/arc-packaging/
  // cli.ts) keeps it current on every successful $9 SKU publish (task 3 of this phase). A
  // consumer reading this row before the first stage-success sees NULL and must fall back
  // (e.g. to /subscribe), same as today's behavior — this migration does not fabricate a URL.
  step("SEED checkout_config: latest-report stable pointer", () => {
    db.exec(`
      INSERT OR IGNORE INTO checkout_config
        (product_id, plan_id, product_name, base_url, affiliate_code, a_param,
         full_checkout_url, url_verified_at)
      VALUES
        ('latest-report', NULL, 'Arc $9 tripwire — current rotating report (stable pointer)',
         'https://arc0btc.com', NULL, 'latest-report',
         NULL, NULL)
    `);
  });

  step("PRAGMA user_version=17", () => {
    db.exec("PRAGMA user_version=17");
  });

  db.exec("COMMIT");
  console.log(`\n[019-p7] Migration complete. ${passed} steps passed, ${failed} failed.`);
  console.log("[019-p7] user_version bumped to 17.");
  console.log("[019-p7] Tables added: click_log.");
  console.log("[019-p7] checkout_config seeded: latest-report stable pointer (full_checkout_url NULL until arc-packaging stage sets it).");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[019-p7] Migration FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
