/**
 * producer-rss.ts — RSS/Atom feed ingestion producer
 *
 * Fetches items from public RSS/Atom feeds and ingests them as research_nugget rows.
 * READ-ONLY from feed perspective. No auth required for public feeds.
 *
 * FAN-IN CREDIT RULE: same content_hash from another source → fan-in credit.
 * conversion_score remains non-targeting and non-stored.
 *
 * Usage:
 *   bun run producer-rss.ts [--preflight] [--db <path>] [--dry-run]
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const PREFLIGHT_ONLY = args.includes("--preflight");
const DRY_RUN = args.includes("--dry-run");
const dbPathIdx = args.indexOf("--db");
const DB_PATH = dbPathIdx >= 0 ? args[dbPathIdx + 1] : new URL("../../db/arc.sqlite", import.meta.url).pathname;

const SOURCE = "rss";
const AGENT_HEADER = "Arc-Agent/1.0 (research-reader; arc@arc0btc.com)";
const MAX_BODY_CHARS = 500;

interface FeedConfig {
  url: string;
  name: string;
}

const DEFAULT_FEEDS: FeedConfig[] = [
  { url: "https://simonwillison.net/atom/everything/", name: "Simon Willison" },
  { url: "https://writings.stephenwolfram.com/feed/", name: "Stephen Wolfram" },
  { url: "https://jackclarkfromuk.substack.com/feed", name: "Jack Clark (ImportAI)" }
];

// Rubric heuristics (same as other producers)
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

interface FeedItem {
  guid: string;
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  author: string | null;
}

function extractText(xml: string, tag: string): string | null {
  // Try <tag>content</tag> and <tag><![CDATA[content]]></tag>
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const normalPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();
  const normalMatch = xml.match(normalPattern);
  if (normalMatch) return normalMatch[1].replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  return null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, "i");
  const match = xml.match(pattern);
  return match ? match[1] : null;
}

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Detect RSS vs Atom
  const isAtom = /<feed[^>]+xmlns/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";

  // Split on item/entry boundaries
  const itemPattern = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];

    const title = extractText(block, "title") ?? "";
    if (!title) continue;

    // RSS: <link>, Atom: <link href="..."/> or <link>
    const linkHref = extractAttr(block, "link", "href") ?? extractText(block, "link") ?? "";
    const guid = extractText(block, "guid") ?? extractText(block, "id") ?? linkHref;

    if (!guid || !linkHref) continue;

    const description = extractText(block, "description") ?? extractText(block, "summary") ?? extractText(block, "content") ?? null;
    const pubDate = extractText(block, "pubDate") ?? extractText(block, "published") ?? extractText(block, "updated") ?? null;
    const author = extractText(block, "author") ?? extractText(block, "dc:creator") ?? null;

    items.push({
      guid,
      title,
      link: linkHref,
      description: description ? description.slice(0, MAX_BODY_CHARS) : null,
      pubDate,
      author: author ? author.replace(/<[^>]+>/g, "").trim() : null
    });
  }

  return items;
}

async function fetchFeed(feed: FeedConfig): Promise<FeedItem[] | null> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": AGENT_HEADER, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.log(`  Feed ${feed.name} returned ${res.status}, skipping`);
      return null;
    }
    const xml = await res.text();
    const items = parseFeed(xml);
    return items;
  } catch (e) {
    console.log(`  Feed ${feed.name} error: ${(e as Error).message}, skipping`);
    return null;
  }
}

async function preflight(): Promise<boolean> {
  const feed = DEFAULT_FEEDS[0];
  const items = await fetchFeed(feed);
  if (items === null || items.length === 0) {
    console.log(`PREFLIGHT FAIL: RSS feed ${feed.name} unreachable or empty`);
    return false;
  }
  console.log(`PREFLIGHT PASS: RSS feed ${feed.name} reachable (${items.length} items)`);
  return true;
}

function ingestNugget(db: Database, item: FeedItem, feedName: string, dryRun: boolean): { action: "inserted" | "skipped" | "fanin"; nuggetRef: string } {
  const title = item.title;
  const body = item.description;
  const contentHash = createHash("sha256").update(`${title}${body ?? ""}`).digest("hex");
  const nuggetRef = `${SOURCE}:${contentHash.slice(0, 12)}`;
  const sourceRef = item.guid.slice(0, 512); // cap length
  const sourceUrl = item.link;
  const fetchTs = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const publishedAt = item.pubDate ? (() => {
    try { return new Date(item.pubDate!).toISOString().replace(/\.\d+Z$/, "Z"); } catch { return null; }
  })() : null;
  const author = item.author;

  if (dryRun) {
    const scores = scoreRubric(title, body);
    console.log(`  [dry-run] ${feedName}: ${nuggetRef} "${title.slice(0, 60)}" rubric=${scores.total}/50`);
    return { action: "inserted", nuggetRef };
  }

  const existing = db.prepare("SELECT nugget_ref FROM research_nugget WHERE source=? AND source_ref=?").get(SOURCE, sourceRef) as { nugget_ref: string } | null;
  if (existing) return { action: "skipped", nuggetRef: existing.nugget_ref };

  const fanInExisting = db.prepare("SELECT nugget_ref FROM research_nugget WHERE content_hash=?").get(contentHash) as { nugget_ref: string } | null;
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
    console.error("Preflight failed. Skipping RSS ingestion.");
    if (!DRY_RUN) {
      const db = new Database(DB_PATH);
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      db.prepare("UPDATE research_source_config SET preflight_status='fail', preflight_ts=?, updated_at=? WHERE source='rss'").run(now, now);
      db.close();
    }
    process.exit(1);
  }

  const db = DRY_RUN ? null : (() => { const d = new Database(DB_PATH); d.exec("PRAGMA journal_mode=WAL"); d.exec("PRAGMA busy_timeout=5000"); return d; })();

  // Get feeds from config if available
  let feeds = DEFAULT_FEEDS;
  if (db) {
    const cfg = db.prepare("SELECT config_json FROM research_source_config WHERE source='rss'").get() as { config_json: string } | null;
    if (cfg?.config_json) {
      try {
        const parsed = JSON.parse(cfg.config_json) as { feeds?: FeedConfig[] };
        if (Array.isArray(parsed.feeds)) feeds = parsed.feeds;
      } catch { /* use defaults */ }
    }
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET preflight_status='pass', preflight_ts=?, updated_at=? WHERE source='rss'").run(now, now);
  }

  let totalInserted = 0; let totalSkipped = 0; let totalFanin = 0;

  for (const feed of feeds) {
    console.log(`Fetching RSS: ${feed.name} (${feed.url})`);
    const items = await fetchFeed(feed);
    if (items === null) {
      console.log(`  Skipping ${feed.name} (fetch failed)`);
      continue;
    }
    console.log(`  Got ${items.length} items`);

    for (const item of items) {
      const result = ingestNugget(db!, item, feed.name, DRY_RUN);
      if (result.action === "inserted") totalInserted++;
      else if (result.action === "skipped") totalSkipped++;
      else if (result.action === "fanin") totalFanin++;
    }
  }

  if (db && !DRY_RUN) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET last_fetched_at=?, last_nugget_count=?, updated_at=? WHERE source='rss'").run(now, totalInserted, now);
    db.close();
  }

  console.log(`RSS ingestion complete: ${totalInserted} inserted, ${totalFanin} fan-in, ${totalSkipped} skipped`);
}

run().catch((e) => {
  console.error("producer-rss fatal:", (e as Error).message);
  process.exit(1);
});
