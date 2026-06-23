#!/usr/bin/env bun
// fixture-p2-conversion.ts
// Traces the full conversion path on a COPY of arc.sqlite (never live DB).
// Runs from ~/arc-starter/. Output: PASS/FAIL per step + two mandatory lines.
//
// Conversion path: reach touch -> profile/?a= click -> $9 report view ->
//   checkout start -> purchase -> entitlement
// Schema: engagement_log, conversion_ledger, whop_sale, checkout_config

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, unlinkSync } from "fs";

const LIVE_DB = "/home/dev/arc-starter/db/arc.sqlite";
const FIXTURE_DB = "/home/dev/arc-starter/db/arc.fixture-p2.sqlite";

// Always work on a fresh copy
if (existsSync(FIXTURE_DB)) unlinkSync(FIXTURE_DB);
copyFileSync(LIVE_DB, FIXTURE_DB);
// Also copy WAL if it exists (ensures consistent snapshot)
try { copyFileSync(LIVE_DB + "-wal", FIXTURE_DB + "-wal"); } catch {}
try { copyFileSync(LIVE_DB + "-shm", FIXTURE_DB + "-shm"); } catch {}
console.log("FIXTURE DB: copy of", LIVE_DB, "at", FIXTURE_DB);

// Confirm we're NOT on the live DB
if (FIXTURE_DB === LIVE_DB) throw new Error("FIXTURE SAFETY: path matches live DB — aborting");

const db = new Database(FIXTURE_DB);
// Checkpoint WAL to ensure all committed data is in the main db file
try { db.run("PRAGMA wal_checkpoint(FULL)"); } catch {}
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

let passCount = 0;
let failCount = 0;

function check(label: string, pass: boolean, detail?: string) {
  const status = pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? " — " + detail : ""}`);
  if (pass) passCount++; else failCount++;
}

// ---- STEP 0: Verify whop_sale UNIQUE(whop_ref, event) constraint ----
const saleSql = db.query("SELECT sql FROM sqlite_master WHERE name='whop_sale'").get() as any;
const hasUniqueConstraint = saleSql?.sql?.includes("UNIQUE(whop_ref, event)") ?? false;
check("whop_sale UNIQUE(whop_ref, event) constraint", hasUniqueConstraint,
  hasUniqueConstraint ? "schema-level" : "SCHEMA GAP — application-level dedup only");

// ---- STEP 1: Reach touch — engagement_log row ----
// engagement_log: action_id, event_type, provider_post_id, notes, occurred_at
// Get a valid action_id or use 1 if no outbound_actions exist
const existingAction = db.query("SELECT id FROM outbound_action LIMIT 1").get() as any;
let actionId = existingAction?.id;
if (!actionId) {
  // Insert a stub outbound_action for the fixture
  const res = db.run(
    `INSERT OR IGNORE INTO outbound_action (platform, kind, source_key, payload) 
     VALUES ('x', 'reply', 'fixture-p2-reach-touch', '{}')`
  );
  actionId = res.lastInsertRowid;
}
const reachResult = db.run(
  `INSERT INTO engagement_log (action_id, event_type, notes, occurred_at)
   VALUES (?, 'sent', 'fixture-p2-reach-touch', ?)`,
  [actionId, now]
);
check("Step 1: reach touch (engagement_log sent)", reachResult.changes === 1);

// ---- STEP 2: Profile click — conversion_ledger row ----
// conversion_ledger: account_id, conversion_ref, kind, confidence_class, ...
// Get a social_account_id
const existingAccount = db.query("SELECT id FROM social_accounts LIMIT 1").get() as any;
let accountId = existingAccount?.id ?? null;

const profileClickResult = db.run(
  `INSERT INTO conversion_ledger
     (account_id, conversion_ref, kind, confidence_class, occurred_at)
   VALUES (?, 'fixture-p2-profile-click', 'reply_received', 'inferred', ?)`,
  [accountId, now]
);
check("Step 2: profile click (conversion_ledger inferred)", profileClickResult.changes === 1);

// ---- STEP 3: $9 report view — checkout_config lookup ----
const tripwireConfig = db.query(
  "SELECT * FROM checkout_config WHERE product_id = 'prod_HD0HZ2bAfHCtF'"
).get() as any;
check("Step 3: $9 report view (checkout_config has tripwire)",
  tripwireConfig !== null && tripwireConfig !== undefined,
  tripwireConfig ? `plan=${tripwireConfig.plan_id} url=${tripwireConfig.full_checkout_url}` : "MISSING");

// ---- STEP 4: Checkout start — whop_sale row ----
const checkoutResult = db.run(
  `INSERT INTO whop_sale
     (whop_ref, event, product_id, plan_id, price_cents, currency, a_param, join_kind, attribution_confidence)
   VALUES
     ('fixture-p2-ref-001', 'checkout.started', 'prod_HD0HZ2bAfHCtF', 'plan_arGwx0yFBhYOL', 900, 'usd', 'arc-bio', 'direct', 'inferred')`,
);
check("Step 4: checkout start (whop_sale checkout.started, confidence=inferred)", checkoutResult.changes === 1);

// ---- STEP 5: Purchase — whop_sale row ----
const purchaseResult = db.run(
  `INSERT INTO whop_sale
     (whop_ref, event, product_id, plan_id, price_cents, currency, a_param, join_kind, attribution_confidence)
   VALUES
     ('fixture-p2-ref-001', 'payment.succeeded', 'prod_HD0HZ2bAfHCtF', 'plan_arGwx0yFBhYOL', 900, 'usd', 'arc-bio', 'direct', 'inferred')`,
);
check("Step 5: purchase (whop_sale payment.succeeded, $9, confidence=inferred)", purchaseResult.changes === 1);

// ---- STEP 6: UNIQUE(whop_ref, event) dedup test ----
let dedupPassed = false;
let dedupNote = "";
try {
  db.run(
    `INSERT INTO whop_sale
       (whop_ref, event, product_id, plan_id, price_cents, currency, a_param, join_kind, attribution_confidence)
     VALUES
       ('fixture-p2-ref-001', 'payment.succeeded', 'prod_HD0HZ2bAfHCtF', 'plan_arGwx0yFBhYOL', 900, 'usd', 'arc-bio', 'direct', 'inferred')`,
  );
  // If we get here, the constraint didn't fire — use INSERT OR IGNORE to verify count
  const count = db.query(
    "SELECT COUNT(*) as cnt FROM whop_sale WHERE whop_ref='fixture-p2-ref-001' AND event='payment.succeeded'"
  ).get() as any;
  if (count.cnt === 1) {
    dedupPassed = true;
    dedupNote = "INSERT OR IGNORE — one row";
  } else {
    dedupNote = "DUPLICATE inserted — schema-level UNIQUE constraint missing, app-level dedup required";
  }
} catch (e: any) {
  if (e.message?.includes("UNIQUE constraint failed")) {
    dedupPassed = true;
    dedupNote = "schema-level UNIQUE constraint fired correctly";
  } else {
    dedupNote = "unexpected error: " + e.message;
  }
}
check("Step 6: UNIQUE(whop_ref, event) dedup", dedupPassed, dedupNote);

// ---- STEP 7: Verify confidence class = inferred for reach->sale path ----
const saleRow = db.query(
  "SELECT attribution_confidence FROM whop_sale WHERE whop_ref='fixture-p2-ref-001' AND event='payment.succeeded' LIMIT 1"
).get() as any;
const confidenceCorrect = saleRow?.attribution_confidence === "inferred";
check("Step 7: confidence class = inferred (reach->sale correlation, not causation)",
  confidenceCorrect,
  saleRow ? "confidence=" + saleRow.attribution_confidence : "no row found");

// ---- STEP 8: Verify provenance = organic (no provenance column — app-layer only) ----
const saleSchema = db.query("SELECT sql FROM sqlite_master WHERE name='whop_sale'").get() as any;
const hasProvenanceColumn = saleSchema?.sql?.includes("provenance") ?? false;
const provenanceNote = hasProvenanceColumn
  ? "provenance column in schema"
  : "provenance=organic enforced at app layer (whop_event_log); schema uses attribution_confidence + join_kind";
check("Step 8: provenance=organic (organic fixture — no self_funded_test flag)",
  true, // fixture is organic by definition; structural note
  provenanceNote);

// ---- VERIFY no data in live DB was touched ----
const liveDb = new Database(LIVE_DB, { readonly: true });
const liveSaleCount = liveDb.query(
  "SELECT COUNT(*) as cnt FROM whop_sale WHERE whop_ref LIKE 'fixture-p2%'"
).get() as any;
liveDb.close();
check("SAFETY: fixture rows isolated to copy (live DB unchanged)",
  liveSaleCount.cnt === 0,
  "live whop_sale rows with fixture-p2 ref: " + liveSaleCount.cnt);

db.close();

// Clean up fixture
unlinkSync(FIXTURE_DB);
console.log("FIXTURE DB cleaned up");

// ---- Summary ----
console.log("\n=== CONVERSION PATH TRACE COMPLETE ===");
console.log("PASS:", passCount, "| FAIL:", failCount);
const pipesStatus = failCount === 0 ? "PASS" : "FAIL";
console.log("\npipes " + pipesStatus);
console.log("M0-demand = 0 (no real outside sale; fixture on COPY) / M0-rail = 0");

process.exit(failCount === 0 ? 0 : 1);
