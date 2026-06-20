/**
 * fixture-p5-idempotency.ts — P5 idempotency verification
 * Runs against a FIXTURE COPY of arc.sqlite (never the live DB).
 *
 * Verifies:
 * - Redelivery of same source+source_ref creates exactly ONE research_nugget row
 * - Redelivery from same source creates exactly ONE nugget_source_delivery row
 * - Fan-in: same content_hash from a second source creates a second delivery row
 *   (but NOT a second research_nugget row)
 * - Redelivery of same (account_id, conversion_ref, kind) to conversion_ledger
 *   creates exactly ONE row (UNIQUE constraint)
 *
 * Usage: bun run fixture-p5-idempotency.ts <path-to-fixture-db>
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run fixture-p5-idempotency.ts <path-to-fixture-db>");
  process.exit(1);
}
if (dbPath.includes("arc-starter/db/arc.sqlite")) {
  console.error("SAFETY: Refusing to run against live DB. Use a fixture COPY.");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

let passed = 0; let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  PASS: ${name}`); passed++; }
  else { console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("\n=== P5 Idempotency Verification (fixture) ===\n");

// ── Setup: one base nugget ────────────────────────────────────────────────────

const TITLE = "idempotency fixture: LLM token overhead at 32k context";
const BODY = "Benchmark shows 15% overhead in KV-cache at 32k tokens vs 8k. Reproducible on H100.";
const HASH = createHash("sha256").update(`${TITLE}${BODY}`).digest("hex");
const REF = `hn:${HASH.slice(0, 12)}`;
const SOURCE_REF = "fixture-idem-hn-001";
const SOURCE_URL = "https://news.ycombinator.com/item?id=fixture-idem-001";

function insertNugget(source: string, source_ref: string, source_url: string): boolean {
  try {
    const contentHash = createHash("sha256").update(`${TITLE}${BODY}`).digest("hex");
    const nuggetRef = `${source}:${contentHash.slice(0, 12)}`;
    const fetchTs = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare(`
      INSERT OR IGNORE INTO research_nugget
        (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body,
         rubric_total, is_promotable, fan_in_count, fan_in_sources, rubric_version, rubric_scored_at)
      VALUES (?,?,?,?,?,?,?,?,22,0,1,?,'rubric-v1.0',?)
    `).run(nuggetRef, source, source_url, source_ref, fetchTs, contentHash, TITLE, BODY, JSON.stringify([source]), fetchTs);
    return true;
  } catch {
    return false;
  }
}

function insertDelivery(nuggetRef: string, source: string, source_url: string, source_ref: string): "inserted" | "conflict" {
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref)
      VALUES (?,?,?,?)
    `).run(nuggetRef, source, source_url, source_ref);
    return (result.changes ?? 0) > 0 ? "inserted" : "conflict";
  } catch {
    return "conflict";
  }
}

// Insert initial nugget from HN
insertNugget("hn", SOURCE_REF, SOURCE_URL);
insertDelivery(REF, "hn", SOURCE_URL, SOURCE_REF);

// ── Test 1: Same source+source_ref → exactly ONE research_nugget row ──────────

console.log("--- Test 1: Same source+source_ref redelivery ---");
insertNugget("hn", SOURCE_REF, SOURCE_URL); // second attempt
insertNugget("hn", SOURCE_REF, SOURCE_URL); // third attempt

const nuggetCount = db.prepare("SELECT COUNT(*) as n FROM research_nugget WHERE source='hn' AND source_ref=?").get(SOURCE_REF) as { n: number };
assert("Redelivery: exactly 1 research_nugget row for same source+source_ref", nuggetCount.n === 1, `got ${nuggetCount.n}`);

// ── Test 2: Same source redelivery → exactly ONE nugget_source_delivery row ──

console.log("\n--- Test 2: Same source delivery dedup ---");
insertDelivery(REF, "hn", SOURCE_URL, SOURCE_REF); // second delivery attempt
insertDelivery(REF, "hn", SOURCE_URL, SOURCE_REF); // third

const deliveryCountHn = db.prepare("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=? AND source='hn'").get(REF) as { n: number };
assert("Redelivery: exactly 1 nugget_source_delivery row for same (nugget_ref, source)", deliveryCountHn.n === 1, `got ${deliveryCountHn.n}`);

// ── Test 3: Fan-in — second source with SAME content ─────────────────────────

console.log("\n--- Test 3: Fan-in (second source, same content) ---");

// Reddit finds same article (same title + body = same content_hash)
const redditSourceRef = "fixture-idem-reddit-001";
const redditSourceUrl = "https://reddit.com/r/LocalLLaMA/comments/fixture-idem-001";

// Fan-in logic: find existing by content_hash
const fanInExisting = db.prepare("SELECT nugget_ref FROM research_nugget WHERE content_hash=?").get(HASH) as { nugget_ref: string } | null;
assert("Fan-in: existing nugget found by content_hash", fanInExisting !== null);

if (fanInExisting) {
  // Insert delivery row for reddit (different source = new delivery credit)
  const deliveryResult = insertDelivery(fanInExisting.nugget_ref, "reddit", redditSourceUrl, redditSourceRef);
  assert("Fan-in: second source delivery row inserted", deliveryResult === "inserted");

  // Update fan_in_count (recomputed from delivery rows, NOT UPDATE ... = ... + 1)
  const cnt = db.prepare("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=?").get(fanInExisting.nugget_ref) as { n: number };
  const srcs = db.prepare("SELECT source FROM nugget_source_delivery WHERE nugget_ref=?").all(fanInExisting.nugget_ref) as Array<{ source: string }>;
  db.prepare("UPDATE research_nugget SET fan_in_count=?, fan_in_sources=? WHERE nugget_ref=?")
    .run(cnt.n, JSON.stringify(srcs.map((s) => s.source)), fanInExisting.nugget_ref);

  // Verify: still only 1 research_nugget row (fan-in did not create a duplicate)
  const totalNuggets = db.prepare("SELECT COUNT(*) as n FROM research_nugget WHERE content_hash=?").get(HASH) as { n: number };
  assert("Fan-in: still only 1 research_nugget row (no duplicate)", totalNuggets.n === 1, `got ${totalNuggets.n}`);

  // Verify: 2 delivery rows (HN + Reddit)
  const totalDeliveries = db.prepare("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=?").get(fanInExisting.nugget_ref) as { n: number };
  assert("Fan-in: 2 delivery rows (one per source)", totalDeliveries.n === 2, `got ${totalDeliveries.n}`);

  // Verify fan_in_count is now 2
  const updatedNugget = db.prepare("SELECT fan_in_count, fan_in_sources FROM research_nugget WHERE nugget_ref=?").get(fanInExisting.nugget_ref) as { fan_in_count: number; fan_in_sources: string } | null;
  assert("Fan-in: fan_in_count=2 after second source", updatedNugget?.fan_in_count === 2, `got ${updatedNugget?.fan_in_count}`);
  const sources = JSON.parse(updatedNugget?.fan_in_sources ?? "[]") as string[];
  assert("Fan-in: fan_in_sources contains both hn and reddit", sources.includes("hn") && sources.includes("reddit"), `got ${JSON.stringify(sources)}`);

  // Verify: re-delivering reddit again gets CONFLICT (no double-credit)
  const dupReddit = insertDelivery(fanInExisting.nugget_ref, "reddit", redditSourceUrl, redditSourceRef);
  assert("Fan-in: re-delivering same source again gets no credit (OR IGNORE)", dupReddit === "conflict");
}

// ── Test 4: Conversion ledger idempotency ─────────────────────────────────────

console.log("\n--- Test 4: Conversion ledger idempotency ---");

// Get any real social_accounts row for testing (or create a synthetic one)
const acct = db.prepare("SELECT id FROM social_accounts WHERE targeting_status!='blocked' LIMIT 1").get() as { id: number } | null;

if (acct) {
  const nuggetRef = REF;
  const now = "2026-06-19T00:00:00Z";

  // First insert
  db.prepare(`
    INSERT OR IGNORE INTO conversion_ledger
      (account_id, conversion_ref, kind, confidence_class, window_days, decay_half_life_days,
       formula_version, as_of, occurred_at)
    VALUES (?, ?, 'reply_received', 'observed', 90, 30, 'v1.0', ?, ?)
  `).run(acct.id, nuggetRef, now, now);

  // Second insert (same account_id, conversion_ref, kind)
  db.prepare(`
    INSERT OR IGNORE INTO conversion_ledger
      (account_id, conversion_ref, kind, confidence_class, window_days, decay_half_life_days,
       formula_version, as_of, occurred_at)
    VALUES (?, ?, 'reply_received', 'observed', 90, 30, 'v1.0', ?, ?)
  `).run(acct.id, nuggetRef, now, now);

  // Third insert
  db.prepare(`
    INSERT OR IGNORE INTO conversion_ledger
      (account_id, conversion_ref, kind, confidence_class, window_days, decay_half_life_days,
       formula_version, as_of, occurred_at)
    VALUES (?, ?, 'reply_received', 'observed', 90, 30, 'v1.0', ?, ?)
  `).run(acct.id, nuggetRef, now, now);

  const ledgerCount = db.prepare(
    "SELECT COUNT(*) as n FROM conversion_ledger WHERE account_id=? AND conversion_ref=? AND kind='reply_received'"
  ).get(acct.id, nuggetRef) as { n: number };
  assert("Conversion ledger: exactly 1 row for same (account_id, conversion_ref, kind)", ledgerCount.n === 1, `got ${ledgerCount.n}`);
} else {
  console.log("  SKIP: No eligible social_accounts in fixture; skipping conversion ledger test");
}

db.close();

console.log(`\n=== Results: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) process.exit(1);
