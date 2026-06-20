/**
 * producer-hn.ts — Hacker News ingestion producer
 *
 * Fetches stories from HN Algolia API and ingests them as research_nugget rows.
 * READ-ONLY from HN perspective. No auth required. Public API.
 *
 * FAN-IN CREDIT RULE:
 *   When the same finding arrives via N sources:
 *   - ONE research_nugget row (dedup key: source + source_ref for same-source;
 *     content_hash for cross-source fan-in)
 *   - N rows in nugget_source_delivery (one per source, UNIQUE prevents double-credit)
 *   - fan_in_count on research_nugget = count of distinct sources
 *   - This count is observable; it does NOT change reach_fit or targeting
 *
 * CONVERSION LEDGER:
 *   Appends to conversion_ledger ONLY when an ingested item is from/about a
 *   handle in social_accounts (kind='reply_received', confidence_class='observed').
 *   Uses INSERT OR IGNORE — redelivery creates exactly ONE ledger row.
 *   conversion_score is a windowed aggregate (non-targeting, non-stored).
 *
 * Usage:
 *   bun run producer-hn.ts [--preflight] [--db <path>] [--dry-run]
 *   --preflight: run read-only API check and exit
 *   --dry-run: fetch + score but do not write to DB
 *   --db <path>: override DB path (default: ../../db/arc.sqlite relative to this file)
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const PREFLIGHT_ONLY = args.includes("--preflight");
const DRY_RUN = args.includes("--dry-run");
const dbPathIdx = args.indexOf("--db");
const DB_PATH = dbPathIdx >= 0 ? args[dbPathIdx + 1] : new URL("../../db/arc.sqlite", import.meta.url).pathname;

const SOURCE = "hn";
const HN_API = "https://hn.algolia.com/api/v1/search";
// HN Algolia treats spaces as AND; run separate queries for each term
const QUERIES = ["AI agents", "LLM inference", "bitcoin protocol", "stacks blockchain", "MCP server", "Claude API"];
const HITS_PER_PAGE = 10;
const AGENT_HEADER = "Arc-Agent/1.0 (research-reader; arc@arc0btc.com)";

// Rubric scoring heuristics (placeholder — full LLM scoring is a dispatcher task)
// P2 rubric-v1.0: specificity/operator_pain/novelty/actionability/density 0-10 each; threshold >=35
const PAIN_KEYWORDS = /latency|memory|cost|security|error|timeout|failure|crash|token|inference|context|rate.limit/i;
const ACTION_KEYWORDS = /fix|improve|reduce|add|implement|build|ship|launch|deploy|migrate|replace|optimize/i;
const SPECIFICITY_PATTERN = /\d+[kmb%]?|\bO\(|\bv\d+\.\d+|specific|exact|precision|benchmark|metric|measurement/i;
const SYSTEM_NAMES = /claude|gpt|llama|gemini|bitcoin|stacks|clarity|bun|deno|rust|python|typescript/i;

function scoreRubric(title: string, body: string | null): {
  specificity: number; operator_pain: number; novelty: number; actionability: number; density: number; total: number;
} {
  const text = `${title} ${body ?? ""}`;
  const specificity = (SPECIFICITY_PATTERN.test(text) || SYSTEM_NAMES.test(title)) ? 6 : 3;
  const operator_pain = PAIN_KEYWORDS.test(text) ? 6 : 3;
  const novelty = 5; // sensor cannot know feed context; dispatcher refines
  const actionability = ACTION_KEYWORDS.test(text) ? 6 : 3;
  const density = 5; // stop-slop check is dispatcher task; placeholder
  return { specificity, operator_pain, novelty, actionability, density, total: specificity + operator_pain + novelty + actionability + density };
}

interface HnHit {
  objectID: string;
  title: string;
  story_text?: string | null;
  url?: string | null;
  author?: string;
  created_at?: string;
}

async function preflight(): Promise<boolean> {
  try {
    const url = `${HN_API}?query=test&tags=story&hitsPerPage=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": AGENT_HEADER },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.log(`PREFLIGHT FAIL: HN API returned ${res.status}`);
      return false;
    }
    const data = await res.json() as { hits?: unknown[] };
    if (!Array.isArray(data.hits)) {
      console.log("PREFLIGHT FAIL: HN API response missing hits array");
      return false;
    }
    console.log(`PREFLIGHT PASS: HN Algolia API reachable (${data.hits.length} hit in test query)`);
    return true;
  } catch (e) {
    console.log(`PREFLIGHT FAIL: ${(e as Error).message}`);
    return false;
  }
}

async function fetchStories(): Promise<HnHit[]> {
  // HN Algolia treats spaces as AND, so run one query per search term
  const seen = new Set<string>();
  const results: HnHit[] = [];
  for (const q of QUERIES) {
    const url = `${HN_API}?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${HITS_PER_PAGE}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": AGENT_HEADER },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) { console.log(`  HN query "${q}" returned ${res.status}, skipping`); continue; }
      const data = await res.json() as { hits?: HnHit[] };
      for (const hit of data.hits ?? []) {
        if (!seen.has(hit.objectID)) { seen.add(hit.objectID); results.push(hit); }
      }
      // Polite delay between queries (HN Algolia: 3s rate limit)
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      console.log(`  HN query "${q}" error: ${(e as Error).message}, skipping`);
    }
  }
  return results;
}

function ingestNugget(db: Database, hit: HnHit, dryRun: boolean): { action: "inserted" | "skipped" | "fanin"; nuggetRef: string } {
  const title = hit.title ?? "";
  const body = hit.story_text ?? hit.url ?? null;
  const contentHash = createHash("sha256").update(`${title}${body ?? ""}`).digest("hex");
  const nuggetRef = `${SOURCE}:${contentHash.slice(0, 12)}`;
  const sourceRef = String(hit.objectID);
  const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const fetchTs = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const publishedAt = hit.created_at ?? null;
  const author = hit.author ?? null;

  if (dryRun) {
    const scores = scoreRubric(title, body);
    console.log(`  [dry-run] Would ingest: ${nuggetRef} "${title.slice(0, 60)}" rubric=${scores.total}/50 promotable=${scores.total >= 35}`);
    return { action: "inserted", nuggetRef };
  }

  // Check for existing row by source+source_ref
  const existing = db.prepare("SELECT nugget_ref, content_hash FROM research_nugget WHERE source=? AND source_ref=?").get(SOURCE, sourceRef) as { nugget_ref: string; content_hash: string } | null;

  if (existing) {
    // Idempotent: same source+source_ref already ingested
    return { action: "skipped", nuggetRef: existing.nugget_ref };
  }

  // Check for fan-in: same content_hash from a different source
  const fanInExisting = db.prepare("SELECT nugget_ref, fan_in_count, fan_in_sources FROM research_nugget WHERE content_hash=?").get(contentHash) as { nugget_ref: string; fan_in_count: number; fan_in_sources: string | null } | null;

  if (fanInExisting) {
    // Fan-in: existing nugget with same content; add delivery row (UNIQUE prevents double-credit from same source)
    db.prepare(`
      INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref)
      VALUES (?, ?, ?, ?)
    `).run(fanInExisting.nugget_ref, SOURCE, sourceUrl, sourceRef);

    // Update fan_in_count and fan_in_sources (not a counter bump; compute from delivery rows)
    const deliveryCount = db.prepare("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=?").get(fanInExisting.nugget_ref) as { n: number };
    const deliverySources = db.prepare("SELECT source FROM nugget_source_delivery WHERE nugget_ref=?").all(fanInExisting.nugget_ref) as Array<{ source: string }>;
    db.prepare(`
      UPDATE research_nugget SET fan_in_count=?, fan_in_sources=? WHERE nugget_ref=?
    `).run(deliveryCount.n, JSON.stringify(deliverySources.map(d => d.source)), fanInExisting.nugget_ref);
    return { action: "fanin", nuggetRef: fanInExisting.nugget_ref };
  }

  // New nugget — insert
  const scores = scoreRubric(title, body);
  const isPromotable = scores.total >= 35 ? 1 : 0;

  db.prepare(`
    INSERT OR IGNORE INTO research_nugget
      (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body, author, published_at,
       rubric_specificity, rubric_operator_pain, rubric_novelty, rubric_actionability, rubric_density,
       rubric_total, rubric_version, rubric_scored_at, is_promotable, fan_in_count, fan_in_sources)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rubric-v1.0',?,?,1,?)
  `).run(
    nuggetRef, SOURCE, sourceUrl, sourceRef, fetchTs, contentHash, title, body, author, publishedAt,
    scores.specificity, scores.operator_pain, scores.novelty, scores.actionability, scores.density,
    scores.total, fetchTs, isPromotable,
    JSON.stringify([SOURCE])
  );

  // First delivery row
  db.prepare(`
    INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref)
    VALUES (?, ?, ?, ?)
  `).run(nuggetRef, SOURCE, sourceUrl, sourceRef);

  // Conversion ledger: if title mentions a tracked social_accounts handle, append event
  // kind='reply_received' means "account's work appeared in our research feed"
  appendConversionIfAccountMatch(db, nuggetRef, title, fetchTs);

  return { action: "inserted", nuggetRef };
}

function appendConversionIfAccountMatch(db: Database, nuggetRef: string, title: string, fetchTs: string): void {
  // Look for @handle or "handle" patterns matching tracked accounts
  const accounts = db.prepare(`
    SELECT id, handle FROM social_accounts WHERE targeting_status != 'blocked'
  `).all() as Array<{ id: number; handle: string }>;

  for (const acct of accounts) {
    const handlePattern = new RegExp(`@?${acct.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (handlePattern.test(title)) {
      // INSERT OR IGNORE — idempotent: UNIQUE(account_id, conversion_ref, kind)
      db.prepare(`
        INSERT OR IGNORE INTO conversion_ledger
          (account_id, conversion_ref, kind, confidence_class, window_days, decay_half_life_days,
           formula_version, as_of, occurred_at)
        VALUES (?, ?, 'reply_received', 'observed', 90, 30, 'v1.0', ?, ?)
      `).run(acct.id, nuggetRef, fetchTs, fetchTs);
    }
  }
}

async function run() {
  // Preflight
  const ok = await preflight();
  if (PREFLIGHT_ONLY) {
    process.exit(ok ? 0 : 1);
  }
  if (!ok) {
    console.error("Preflight failed. Skipping HN ingestion.");
    if (!DRY_RUN) {
      // Record preflight failure
      const db = new Database(DB_PATH);
      db.prepare(`
        UPDATE research_source_config SET preflight_status='fail', preflight_ts=?, updated_at=?
        WHERE source='hn'
      `).run(new Date().toISOString().replace(/\.\d+Z$/, "Z"), new Date().toISOString().replace(/\.\d+Z$/, "Z"));
      db.close();
    }
    process.exit(1);
  }

  const stories = await fetchStories();
  console.log(`Fetched ${stories.length} HN stories`);

  const db = DRY_RUN ? null : new Database(DB_PATH);
  if (db) {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA busy_timeout=5000");
    // Record preflight pass
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare(`
      UPDATE research_source_config SET preflight_status='pass', preflight_ts=?, updated_at=?
      WHERE source='hn'
    `).run(now, now);
  }

  let inserted = 0; let skipped = 0; let fanin = 0;

  for (const hit of stories) {
    if (!hit.title) continue;
    const result = ingestNugget(db!, hit, DRY_RUN);
    if (result.action === "inserted") inserted++;
    else if (result.action === "skipped") skipped++;
    else if (result.action === "fanin") fanin++;
  }

  if (db && !DRY_RUN) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare(`
      UPDATE research_source_config SET last_fetched_at=?, last_nugget_count=?, updated_at=? WHERE source='hn'
    `).run(now, inserted, now);
    db.close();
  }

  console.log(`HN ingestion complete: ${inserted} inserted, ${fanin} fan-in, ${skipped} skipped`);
}

run().catch((e) => {
  console.error("producer-hn fatal:", (e as Error).message);
  process.exit(1);
});
