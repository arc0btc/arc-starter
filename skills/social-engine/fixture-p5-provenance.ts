/**
 * fixture-p5-provenance.ts — P5 provenance verification
 * Runs against a FIXTURE COPY of arc.sqlite (never the live DB).
 *
 * Verifies:
 * - Known fixture nuggets produce fully-populated provenance columns
 * - nugget_ref format: {source}:{content_hash.slice(0,12)}
 * - nugget_source_delivery row exists for each inserted nugget
 * - rubric_total computed correctly; is_promotable accurate
 *
 * Usage: bun run fixture-p5-provenance.ts <path-to-fixture-db>
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run fixture-p5-provenance.ts <path-to-fixture-db>");
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

console.log("\n=== P5 Provenance Verification (fixture) ===\n");

// ── Setup: insert known fixture nuggets ──────────────────────────────────────

const NUGGETS = [
  {
    source: "hn" as const,
    source_ref: "fixture-hn-001",
    source_url: "https://news.ycombinator.com/item?id=99999001",
    title: "2x Faster LLM Inference on AMD GPUs with new memory layout",
    body: "Researchers achieved a 2.1x throughput increase by restructuring the key-value cache layout for attention operations.",
    author: "testuser",
    published_at: "2026-06-01T00:00:00Z",
    // Rubric: specificity=8 (2x, AMD), operator_pain=8 (LLM inference), novelty=7, actionability=6, density=6 → 35/50
    rubric_specificity: 8, rubric_operator_pain: 8, rubric_novelty: 7, rubric_actionability: 6, rubric_density: 6
  },
  {
    source: "rss" as const,
    source_ref: "https://rss.test/article-fixture-002",
    source_url: "https://rss.test/article-fixture-002",
    title: "Why AI tools crash on large context windows: memory fragmentation analysis",
    body: "The culprit is fragmented GPU memory when processing 128k+ token contexts. Three concrete mitigations available.",
    author: "testauthor",
    published_at: "2026-06-10T00:00:00Z",
    // Rubric: specificity=7 (128k), operator_pain=9 (crash), novelty=6, actionability=7 (mitigations), density=7 → 36/50
    rubric_specificity: 7, rubric_operator_pain: 9, rubric_novelty: 6, rubric_actionability: 7, rubric_density: 7
  },
  {
    source: "github_release" as const,
    source_ref: "anthropics/claude-code@v1.0.0-fixture",
    source_url: "https://github.com/anthropics/claude-code/releases/tag/v1.0.0-fixture",
    title: "anthropics/claude-code v1.0.0-fixture: Major release",
    body: "Major release. Adds support for multi-session contexts and reduces memory overhead by 40%.",
    author: null,
    published_at: "2026-06-15T00:00:00Z",
    // Rubric: specificity=8 (40%), operator_pain=7, novelty=8, actionability=7, density=6 → 36/50
    rubric_specificity: 8, rubric_operator_pain: 7, rubric_novelty: 8, rubric_actionability: 7, rubric_density: 6
  },
  {
    source: "hn" as const,
    source_ref: "fixture-hn-below-threshold",
    source_url: "https://news.ycombinator.com/item?id=99999004",
    title: "A blog post about chatbots",
    body: "Some thoughts on chatbots.",
    author: "writer",
    published_at: "2026-06-18T00:00:00Z",
    // Rubric: all low → total=20/50, not promotable
    rubric_specificity: 4, rubric_operator_pain: 4, rubric_novelty: 4, rubric_actionability: 4, rubric_density: 4
  }
];

db.exec("BEGIN");
try {
  for (const n of NUGGETS) {
    const contentHash = createHash("sha256").update(`${n.title}${n.body ?? ""}`).digest("hex");
    const nuggetRef = `${n.source}:${contentHash.slice(0, 12)}`;
    const rubric_total = n.rubric_specificity + n.rubric_operator_pain + n.rubric_novelty + n.rubric_actionability + n.rubric_density;
    const is_promotable = rubric_total >= 35 ? 1 : 0;
    const fetchTs = "2026-06-19T00:00:00Z";

    db.prepare(`
      INSERT OR IGNORE INTO research_nugget
        (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body, author, published_at,
         rubric_specificity, rubric_operator_pain, rubric_novelty, rubric_actionability, rubric_density,
         rubric_total, rubric_version, rubric_scored_at, is_promotable, fan_in_count, fan_in_sources)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rubric-v1.0',?,?,1,?)
    `).run(nuggetRef, n.source, n.source_url, n.source_ref, fetchTs, contentHash, n.title, n.body,
      n.author, n.published_at, n.rubric_specificity, n.rubric_operator_pain, n.rubric_novelty,
      n.rubric_actionability, n.rubric_density, rubric_total, fetchTs, is_promotable, JSON.stringify([n.source]));

    db.prepare(`
      INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref)
      VALUES (?,?,?,?)
    `).run(nuggetRef, n.source, n.source_url, n.source_ref);
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`Setup failed: ${(e as Error).message}`);
  process.exit(1);
}

// ── Assertions ───────────────────────────────────────────────────────────────

for (const n of NUGGETS) {
  const contentHash = createHash("sha256").update(`${n.title}${n.body ?? ""}`).digest("hex");
  const expectedRef = `${n.source}:${contentHash.slice(0, 12)}`;
  const rubric_total = n.rubric_specificity + n.rubric_operator_pain + n.rubric_novelty + n.rubric_actionability + n.rubric_density;
  const expected_promotable = rubric_total >= 35 ? 1 : 0;

  const row = db.prepare(`
    SELECT nugget_ref, source, source_url, source_ref, fetch_ts, content_hash,
           title, body, author, published_at,
           rubric_specificity, rubric_operator_pain, rubric_novelty, rubric_actionability, rubric_density,
           rubric_total, rubric_version, rubric_scored_at, is_promotable,
           fan_in_count, fan_in_sources, created_at
    FROM research_nugget WHERE source=? AND source_ref=?
  `).get(n.source, n.source_ref) as Record<string, string | number | null> | null;

  const label = `${n.source}:${n.source_ref.slice(0, 30)}`;

  assert(`${label}: row exists`, row !== null);
  if (!row) continue;

  assert(`${label}: nugget_ref format correct`, row.nugget_ref === expectedRef, `got ${row.nugget_ref}`);
  assert(`${label}: source retained`, row.source === n.source, `got ${row.source}`);
  assert(`${label}: source_url retained`, row.source_url === n.source_url);
  assert(`${label}: source_ref retained`, row.source_ref === n.source_ref);
  assert(`${label}: fetch_ts non-null`, row.fetch_ts !== null);
  assert(`${label}: content_hash = sha256(title+body)`, row.content_hash === contentHash, `got ${row.content_hash?.toString().slice(0, 12)}`);
  assert(`${label}: title retained`, row.title === n.title);
  assert(`${label}: rubric_version = rubric-v1.0`, row.rubric_version === "rubric-v1.0");
  assert(`${label}: rubric_scored_at non-null`, row.rubric_scored_at !== null);
  assert(`${label}: rubric_total = ${rubric_total}`, Number(row.rubric_total) === rubric_total, `got ${row.rubric_total}`);
  assert(`${label}: is_promotable = ${expected_promotable}`, Number(row.is_promotable) === expected_promotable, `got ${row.is_promotable}`);
  assert(`${label}: fan_in_count = 1 (single source)`, Number(row.fan_in_count) === 1, `got ${row.fan_in_count}`);
  assert(`${label}: fan_in_sources contains source`, JSON.parse(row.fan_in_sources as string ?? "[]").includes(n.source));

  // Delivery row exists
  const delivery = db.prepare("SELECT * FROM nugget_source_delivery WHERE nugget_ref=? AND source=?").get(expectedRef, n.source) as Record<string, string | number> | null;
  assert(`${label}: nugget_source_delivery row exists`, delivery !== null);
  if (delivery) {
    assert(`${label}: delivery.source_url retained`, delivery.source_url === n.source_url);
    assert(`${label}: delivery.source_ref retained`, delivery.source_ref === n.source_ref);
  }
}

// Verify: specifically above/below threshold
const [aboveThresh, belowThresh] = [NUGGETS[0], NUGGETS[3]];
const aboveHash = createHash("sha256").update(`${aboveThresh.title}${aboveThresh.body ?? ""}`).digest("hex");
const belowHash = createHash("sha256").update(`${belowThresh.title}${belowThresh.body ?? ""}`).digest("hex");
const aboveRow = db.prepare("SELECT is_promotable, rubric_total FROM research_nugget WHERE content_hash=?").get(aboveHash) as { is_promotable: number; rubric_total: number } | null;
const belowRow = db.prepare("SELECT is_promotable, rubric_total FROM research_nugget WHERE content_hash=?").get(belowHash) as { is_promotable: number; rubric_total: number } | null;
assert("promotability threshold >=35: is_promotable=1", aboveRow?.is_promotable === 1, `rubric_total=${aboveRow?.rubric_total}`);
assert("below threshold <35: is_promotable=0", belowRow?.is_promotable === 0, `rubric_total=${belowRow?.rubric_total}`);

db.close();

console.log(`\n=== Results: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) process.exit(1);
