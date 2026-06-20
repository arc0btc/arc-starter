/**
 * producer-reddit.ts — Reddit ingestion producer (READ-ONLY)
 *
 * Fetches posts from Reddit public JSON API.
 * READ-ONLY. No auth required. Public .json endpoints.
 * Policy: Reddit robots.txt allows /r/*.json without auth.
 *
 * FAN-IN CREDIT RULE (same as producer-hn.ts):
 *   Same content_hash from another source → fan-in credit, not new nugget.
 *   UNIQUE(nugget_ref, source) in nugget_source_delivery prevents double-credit.
 *   conversion_score remains non-targeting and non-stored.
 *
 * Usage:
 *   bun run producer-reddit.ts [--preflight] [--db <path>] [--dry-run]
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const PREFLIGHT_ONLY = args.includes("--preflight");
const DRY_RUN = args.includes("--dry-run");
const dbPathIdx = args.indexOf("--db");
const DB_PATH = dbPathIdx >= 0 ? args[dbPathIdx + 1] : new URL("../../db/arc.sqlite", import.meta.url).pathname;

const SOURCE = "reddit";
const AGENT_HEADER = "Arc-Agent/1.0 (research-reader; arc@arc0btc.com)";

const DEFAULT_SUBREDDITS = ["MachineLearning", "LocalLLaMA", "bitcoin", "btc", "AIAgents"];

// Rubric heuristics (same approach as producer-hn.ts)
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
  const novelty = 5;
  const actionability = ACTION_KEYWORDS.test(text) ? 6 : 3;
  const density = 5;
  return { specificity, operator_pain, novelty, actionability, density, total: specificity + operator_pain + novelty + actionability + density };
}

interface RedditPost {
  id: string;
  title: string;
  selftext?: string;
  url?: string;
  author?: string;
  created_utc?: number;
  permalink?: string;
}

async function preflight(): Promise<boolean> {
  try {
    const url = "https://www.reddit.com/r/MachineLearning.json?limit=1";
    const res = await fetch(url, {
      headers: {
        "User-Agent": AGENT_HEADER,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.log(`PREFLIGHT FAIL: Reddit API returned ${res.status}`);
      return false;
    }
    const data = await res.json() as { data?: { children?: unknown[] } };
    if (!data?.data?.children) {
      console.log("PREFLIGHT FAIL: Reddit API response missing data.children");
      return false;
    }
    console.log(`PREFLIGHT PASS: Reddit public JSON API reachable (${data.data.children.length} post in test query)`);
    return true;
  } catch (e) {
    console.log(`PREFLIGHT FAIL: ${(e as Error).message}`);
    return false;
  }
}

async function fetchSubreddit(sub: string, limit: number = 20): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${sub}.json?limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": AGENT_HEADER,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (res.status === 429) {
    console.log(`  rate-limited on r/${sub}, skipping`);
    return [];
  }
  if (!res.ok) {
    console.log(`  r/${sub} returned ${res.status}, skipping`);
    return [];
  }
  const data = await res.json() as { data?: { children?: Array<{ data: RedditPost }> } };
  return (data?.data?.children ?? []).map((c) => c.data);
}

function ingestNugget(db: Database, post: RedditPost, sub: string, dryRun: boolean): { action: "inserted" | "skipped" | "fanin"; nuggetRef: string } {
  const title = post.title ?? "";
  const body = (post.selftext && post.selftext.length > 10 ? post.selftext.slice(0, 500) : post.url) ?? null;
  const contentHash = createHash("sha256").update(`${title}${body ?? ""}`).digest("hex");
  const nuggetRef = `${SOURCE}:${contentHash.slice(0, 12)}`;
  const sourceRef = String(post.id);
  const sourceUrl = `https://reddit.com${post.permalink ?? `/r/${sub}/comments/${post.id}`}`;
  const fetchTs = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const publishedAt = post.created_utc ? new Date(post.created_utc * 1000).toISOString().replace(/\.\d+Z$/, "Z") : null;
  const author = post.author ?? null;

  if (dryRun) {
    const scores = scoreRubric(title, body);
    console.log(`  [dry-run] r/${sub}: ${nuggetRef} "${title.slice(0, 60)}" rubric=${scores.total}/50`);
    return { action: "inserted", nuggetRef };
  }

  // Idempotency: same source+source_ref
  const existing = db.prepare("SELECT nugget_ref, content_hash FROM research_nugget WHERE source=? AND source_ref=?").get(SOURCE, sourceRef) as { nugget_ref: string; content_hash: string } | null;
  if (existing) return { action: "skipped", nuggetRef: existing.nugget_ref };

  // Fan-in: same content_hash from a different source
  const fanInExisting = db.prepare("SELECT nugget_ref, fan_in_count FROM research_nugget WHERE content_hash=?").get(contentHash) as { nugget_ref: string; fan_in_count: number } | null;
  if (fanInExisting) {
    db.prepare("INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref) VALUES (?,?,?,?)").run(fanInExisting.nugget_ref, SOURCE, sourceUrl, sourceRef);
    const cnt = db.prepare("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=?").get(fanInExisting.nugget_ref) as { n: number };
    const srcs = db.prepare("SELECT source FROM nugget_source_delivery WHERE nugget_ref=?").all(fanInExisting.nugget_ref) as Array<{ source: string }>;
    db.prepare("UPDATE research_nugget SET fan_in_count=?, fan_in_sources=? WHERE nugget_ref=?").run(cnt.n, JSON.stringify(srcs.map((s) => s.source)), fanInExisting.nugget_ref);
    return { action: "fanin", nuggetRef: fanInExisting.nugget_ref };
  }

  const scores = scoreRubric(title, body);
  const isPromotable = scores.total >= 35 ? 1 : 0;

  db.prepare(`
    INSERT OR IGNORE INTO research_nugget
      (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body, author, published_at,
       rubric_specificity, rubric_operator_pain, rubric_novelty, rubric_actionability, rubric_density,
       rubric_total, rubric_version, rubric_scored_at, is_promotable, fan_in_count, fan_in_sources)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rubric-v1.0',?,?,1,?)
  `).run(nuggetRef, SOURCE, sourceUrl, sourceRef, fetchTs, contentHash, title, body, author, publishedAt,
    scores.specificity, scores.operator_pain, scores.novelty, scores.actionability, scores.density,
    scores.total, fetchTs, isPromotable, JSON.stringify([SOURCE]));

  db.prepare("INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref) VALUES (?,?,?,?)").run(nuggetRef, SOURCE, sourceUrl, sourceRef);

  appendConversionIfAccountMatch(db, nuggetRef, title, fetchTs);
  return { action: "inserted", nuggetRef };
}

function appendConversionIfAccountMatch(db: Database, nuggetRef: string, title: string, fetchTs: string): void {
  const accounts = db.prepare("SELECT id, handle FROM social_accounts WHERE targeting_status != 'blocked'").all() as Array<{ id: number; handle: string }>;
  for (const acct of accounts) {
    const handlePattern = new RegExp(`@?${acct.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (handlePattern.test(title)) {
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
  const ok = await preflight();
  if (PREFLIGHT_ONLY) process.exit(ok ? 0 : 1);
  if (!ok) {
    console.error("Preflight failed. Skipping Reddit ingestion.");
    if (!DRY_RUN) {
      const db = new Database(DB_PATH);
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      db.prepare("UPDATE research_source_config SET preflight_status='fail', preflight_ts=?, updated_at=? WHERE source='reddit'").run(now, now);
      db.close();
    }
    process.exit(1);
  }

  const db = DRY_RUN ? null : (() => { const d = new Database(DB_PATH); d.exec("PRAGMA journal_mode=WAL"); d.exec("PRAGMA busy_timeout=5000"); return d; })();

  // Get subreddits from config if available
  let subreddits = DEFAULT_SUBREDDITS;
  if (db) {
    const cfg = db.prepare("SELECT config_json FROM research_source_config WHERE source='reddit'").get() as { config_json: string } | null;
    if (cfg?.config_json) {
      try {
        const parsed = JSON.parse(cfg.config_json) as { subreddits?: string[] };
        if (Array.isArray(parsed.subreddits)) subreddits = parsed.subreddits;
      } catch { /* use defaults */ }
    }
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET preflight_status='pass', preflight_ts=?, updated_at=? WHERE source='reddit'").run(now, now);
  }

  let totalInserted = 0; let totalSkipped = 0; let totalFanin = 0;

  for (const sub of subreddits) {
    console.log(`Fetching r/${sub}...`);
    const posts = await fetchSubreddit(sub);
    console.log(`  Got ${posts.length} posts`);

    for (const post of posts) {
      if (!post.title) continue;
      const result = ingestNugget(db!, post, sub, DRY_RUN);
      if (result.action === "inserted") totalInserted++;
      else if (result.action === "skipped") totalSkipped++;
      else if (result.action === "fanin") totalFanin++;
    }

    // Polite delay between subreddits
    if (!DRY_RUN) await new Promise((r) => setTimeout(r, 1000));
  }

  if (db && !DRY_RUN) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET last_fetched_at=?, last_nugget_count=?, updated_at=? WHERE source='reddit'").run(now, totalInserted, now);
    db.close();
  }

  console.log(`Reddit ingestion complete: ${totalInserted} inserted, ${totalFanin} fan-in, ${totalSkipped} skipped`);
}

run().catch((e) => {
  console.error("producer-reddit fatal:", (e as Error).message);
  process.exit(1);
});
