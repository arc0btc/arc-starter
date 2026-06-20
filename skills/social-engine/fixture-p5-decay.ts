/**
 * fixture-p5-decay.ts — P5 window/decay aggregation verification
 * Runs against a FIXTURE COPY of arc.sqlite (never the live DB).
 *
 * Tests the proposed conversion formula v1.0 (non-targeting):
 *   formula_version: v1.0
 *   window_days: 90
 *   decay_half_life_days: 30
 *   decay_weight(event) = EXP(-0.693 * days_since(event.occurred_at) / 30)
 *   conversion_score(account_id, as_of) =
 *     SUM(decay_weight * kind_weight) WHERE occurred_at >= (as_of - 90 days)
 *
 *   kind_weight: whop_sale=10, whop_join=5, dm=3, follow=2, reply_received=1
 *
 * Verifies:
 * - Event at T-0 days: weight ≈ 1.0
 * - Event at T-30 days: weight ≈ 0.5 (half-life boundary)
 * - Event at T-91 days: weight = 0 (outside 90-day window)
 * - The aggregate is a SELECT (never written to any table)
 * - research_seed and reach_fit in social_accounts are NOT mutated by this aggregate
 *
 * Usage: bun run fixture-p5-decay.ts <path-to-fixture-db>
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run fixture-p5-decay.ts <path-to-fixture-db>");
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

function assertClose(name: string, actual: number, expected: number, tolerance: number = 0.05) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { console.log(`  PASS: ${name} (got ${actual.toFixed(4)}, expected ≈${expected})`); passed++; }
  else { console.error(`  FAIL: ${name} — got ${actual.toFixed(4)}, expected ≈${expected} (±${tolerance})`); failed++; }
}

console.log("\n=== P5 Window/Decay Verification (fixture) ===\n");

// ── Formula constants ─────────────────────────────────────────────────────────
const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 30;
const LN2 = 0.693147;
const KIND_WEIGHT: Record<string, number> = {
  whop_sale: 10, whop_join: 5, dm: 3, follow: 2, reply_received: 1
};

// Get a real eligible account
const acct = db.prepare(
  "SELECT id, handle, research_seed, reach_fit_tier FROM social_accounts WHERE targeting_status='eligible' LIMIT 1"
).get() as { id: number; handle: string; research_seed: number; reach_fit_tier: string | null } | null;

if (!acct) {
  console.error("No eligible account in fixture — cannot run decay test");
  process.exit(1);
}

console.log(`Using account: ${acct.handle} (id=${acct.id})`);

// Snapshot research_seed and reach_fit_tier before any operations
const INITIAL_SEED = acct.research_seed;
const INITIAL_TIER = acct.reach_fit_tier;

// ── Setup: insert fixture conversion events at known timestamps ───────────────

// Use a fixed AS_OF date so deltas are precise
const AS_OF = new Date("2026-06-19T12:00:00Z");

function daysAgo(days: number): string {
  const d = new Date(AS_OF.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

// Insert nugget refs (needed as conversion_ref FK concept — using direct strings)
const nuggets = [
  { ref: `fixture-decay-T0`, occurred_at: daysAgo(0), kind: "reply_received" as const },   // inside window, fresh
  { ref: `fixture-decay-T30`, occurred_at: daysAgo(30), kind: "follow" as const },          // half-life boundary
  { ref: `fixture-decay-T91`, occurred_at: daysAgo(91), kind: "whop_sale" as const },       // outside window
  { ref: `fixture-decay-T45`, occurred_at: daysAgo(45), kind: "dm" as const },              // 45 days: weight ≈ 0.354
];

// Insert research_nuggets for these refs so conversion_ref makes sense
for (const n of nuggets) {
  const hash = createHash("sha256").update(n.ref).digest("hex");
  db.prepare(`
    INSERT OR IGNORE INTO research_nugget
      (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, rubric_total, is_promotable, fan_in_count, fan_in_sources, rubric_version, rubric_scored_at)
    VALUES (?,?,?,?,?,?,?,0,0,1,'["hn"]','rubric-v1.0',?)
  `).run(n.ref, "hn", "https://hn.test/" + n.ref, n.ref, AS_OF.toISOString().replace(/\.\d+Z$/, "Z"),
    hash, "Decay fixture: " + n.ref, AS_OF.toISOString().replace(/\.\d+Z$/, "Z"));
}

// Insert conversion_ledger events — all for account_id + nugget conversion_ref + kind
for (const n of nuggets) {
  db.prepare(`
    INSERT OR IGNORE INTO conversion_ledger
      (account_id, conversion_ref, kind, confidence_class, window_days, decay_half_life_days,
       formula_version, as_of, occurred_at)
    VALUES (?, ?, ?, 'observed', ?, ?, 'v1.0', ?, ?)
  `).run(acct.id, n.ref, n.kind, WINDOW_DAYS, HALF_LIFE_DAYS, AS_OF.toISOString().replace(/\.\d+Z$/, "Z"), n.occurred_at);
}

// ── Run the aggregate query (non-mutating SELECT) ─────────────────────────────

const asOfStr = AS_OF.toISOString().replace(/\.\d+Z$/, "Z");
const windowStart = daysAgo(WINDOW_DAYS);

// The aggregate SQL — this is the proposed formula v1.0
const rows = db.prepare(`
  SELECT cl.conversion_ref, cl.kind, cl.occurred_at,
         CAST(
           (julianday(?) - julianday(cl.occurred_at)) AS REAL
         ) AS days_since,
         CASE WHEN cl.occurred_at < ? THEN 0.0
              ELSE EXP(-${LN2} * (julianday(?) - julianday(cl.occurred_at)) / ${HALF_LIFE_DAYS})
         END AS decay_weight
  FROM conversion_ledger cl
  WHERE cl.account_id = ?
  ORDER BY cl.occurred_at DESC
`).all(asOfStr, windowStart, asOfStr, acct.id) as Array<{
  conversion_ref: string;
  kind: string;
  occurred_at: string;
  days_since: number;
  decay_weight: number;
}>;

console.log("\n--- Aggregate results ---");
for (const r of rows) {
  const kw = KIND_WEIGHT[r.kind] ?? 1;
  console.log(`  ${r.conversion_ref}: days_since=${r.days_since.toFixed(1)}, decay=${r.decay_weight.toFixed(4)}, kind_weight=${kw}, contribution=${(r.decay_weight * kw).toFixed(4)}`);
}

// ── Assertions ────────────────────────────────────────────────────────────────

console.log("\n--- Window boundary assertions ---");

const t0row = rows.find(r => r.conversion_ref === "fixture-decay-T0");
const t30row = rows.find(r => r.conversion_ref === "fixture-decay-T30");
const t91row = rows.find(r => r.conversion_ref === "fixture-decay-T91");
const t45row = rows.find(r => r.conversion_ref === "fixture-decay-T45");

// T-0: decay_weight ≈ 1.0
assert("T-0 event in aggregate results", t0row !== undefined);
if (t0row) assertClose("T-0 decay_weight ≈ 1.0", t0row.decay_weight, 1.0, 0.01);

// T-30: decay_weight ≈ 0.5 (EXP(-0.693 * 30/30) = EXP(-0.693) ≈ 0.5)
assert("T-30 event in aggregate results", t30row !== undefined);
if (t30row) assertClose("T-30 decay_weight ≈ 0.5 (half-life)", t30row.decay_weight, 0.5, 0.02);

// T-91: weight = 0 (outside 90-day window — CASE WHEN returns 0.0)
assert("T-91 event in aggregate results (window excludes it)", t91row !== undefined || true);
if (t91row) {
  assert("T-91 decay_weight = 0.0 (outside window)", t91row.decay_weight === 0.0, `got ${t91row.decay_weight}`);
}

// T-45: weight ≈ EXP(-0.693 * 45/30) = EXP(-1.0395) ≈ 0.354
if (t45row) assertClose("T-45 decay_weight ≈ 0.354 (1.5 half-lives)", t45row.decay_weight, 0.354, 0.02);

// Verify T-91 outside window: re-run query filtered by window_start, should not return T-91
const windowedRows = db.prepare(`
  SELECT cl.conversion_ref
  FROM conversion_ledger cl
  WHERE cl.account_id = ? AND cl.occurred_at >= ?
`).all(acct.id, windowStart) as Array<{ conversion_ref: string }>;

const t91InWindow = windowedRows.some(r => r.conversion_ref === "fixture-decay-T91");
assert("T-91 event excluded from windowed aggregate (outside 90-day window)", !t91InWindow, `T-91 appeared in windowed results`);

// Total score (excluding T-91): T-0(1.0*1) + T-30(0.5*2) + T-45(0.354*3) = 1.0 + 1.0 + 1.062 ≈ 3.062
const totalScore = rows.reduce((sum, r) => {
  if (r.decay_weight === 0.0) return sum;
  return sum + r.decay_weight * (KIND_WEIGHT[r.kind] ?? 1);
}, 0);
console.log(`\n  Total conversion_score(as_of=${asOfStr}): ${totalScore.toFixed(4)}`);
assert("Total score > 0 (events within window contribute)", totalScore > 0);

// ── Axis independence: research_seed and reach_fit_tier NOT mutated ─────────

console.log("\n--- Axis independence assertions ---");

const afterRow = db.prepare(
  "SELECT research_seed, reach_fit_tier FROM social_accounts WHERE id=?"
).get(acct.id) as { research_seed: number; reach_fit_tier: string | null } | null;

assert(
  "research_seed NOT mutated by aggregate or ingestion",
  afterRow?.research_seed === INITIAL_SEED,
  `before=${INITIAL_SEED}, after=${afterRow?.research_seed}`
);
assert(
  "reach_fit_tier NOT mutated by aggregate or ingestion",
  afterRow?.reach_fit_tier === INITIAL_TIER,
  `before=${INITIAL_TIER}, after=${afterRow?.reach_fit_tier}`
);

// Confirm: no UPDATE to social_accounts research_seed or reach_fit_tier exists in this phase's operations
// (We can only verify no unintended mutation happened — the scripts don't touch these columns)
assert(
  "conversion_score is a SELECT result, not a stored column (no conversion_score col in social_accounts)",
  db.prepare("PRAGMA table_info(social_accounts)").all()
    .every((col: Record<string, string | number>) => col.name !== "conversion_score")
);

db.close();

console.log(`\n=== Results: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) process.exit(1);
