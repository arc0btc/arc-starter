/**
 * producer-github-release.ts — GitHub release ingestion producer
 *
 * Fetches releases from GitHub repos via gh CLI (authenticated on VM).
 * READ-ONLY. Ingests release data as research_nugget rows.
 *
 * NOTE: This is DISTINCT from skills/github-release-watcher/sensor.ts.
 * The watcher creates task queue entries for human review.
 * This producer creates research_nugget rows for the social-engine research pipeline.
 * They serve different purposes and different tables.
 *
 * FAN-IN CREDIT RULE: same content_hash from another source → fan-in credit.
 * conversion_score remains non-targeting and non-stored.
 *
 * Usage:
 *   bun run producer-github-release.ts [--preflight] [--db <path>] [--dry-run]
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const PREFLIGHT_ONLY = args.includes("--preflight");
const DRY_RUN = args.includes("--dry-run");
const dbPathIdx = args.indexOf("--db");
const DB_PATH = dbPathIdx >= 0 ? args[dbPathIdx + 1] : new URL("../../db/arc.sqlite", import.meta.url).pathname;

const SOURCE = "github_release";
const MAX_BODY_CHARS = 600;

const DEFAULT_REPOS = [
  "oven-sh/bun",
  "anthropics/claude-code",
  "stacks-network/stacks-core",
  "aibtcdev/aibtc-mcp-server",
  "x402Stacks/x402-stacks"
];

// Rubric heuristics
const PAIN_KEYWORDS = /latency|memory|cost|security|error|timeout|failure|crash|token|inference|context|rate.limit|bug|fix|regression/i;
const ACTION_KEYWORDS = /add|improve|reduce|implement|build|ship|launch|deploy|migrate|replace|optimize|introduce|enable|support/i;
const SPECIFICITY_PATTERN = /\d+[kmb%]?|\bv\d+\.\d+|specific|exact|precision|benchmark|metric|measurement|ms|mb|kb/i;
const SYSTEM_NAMES = /claude|bun|stacks|clarity|bitcoin|mcp|x402|aibtc/i;

function scoreRubric(title: string, body: string | null): {
  specificity: number; operator_pain: number; novelty: number; actionability: number; density: number; total: number;
} {
  const text = `${title} ${body ?? ""}`;
  const specificity = (SPECIFICITY_PATTERN.test(text) || SYSTEM_NAMES.test(title)) ? 7 : 4; // releases tend to be specific
  const operator_pain = PAIN_KEYWORDS.test(text) ? 7 : 4;
  const novelty = 6; // releases are by definition new
  const actionability = ACTION_KEYWORDS.test(text) ? 7 : 4;
  const density = 6; // release notes are usually dense
  return { specificity, operator_pain, novelty, actionability, density, total: specificity + operator_pain + novelty + actionability + density };
}

interface GhRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
}

function fetchLatestRelease(repo: string): GhRelease | null {
  const result = spawnSync("gh", ["api", `/repos/${repo}/releases/latest`], {
    timeout: 30000,
    encoding: "utf8"
  });
  if (result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout.trim() || "{}") as { tag_name?: string; name?: string; html_url?: string; body?: string; published_at?: string };
    if (!data.tag_name) return null;
    return {
      tag_name: data.tag_name,
      name: data.name ?? data.tag_name,
      html_url: data.html_url ?? `https://github.com/${repo}/releases/tag/${data.tag_name}`,
      body: data.body ?? "",
      published_at: data.published_at ?? ""
    };
  } catch {
    return null;
  }
}

async function preflight(): Promise<boolean> {
  const release = fetchLatestRelease("oven-sh/bun");
  if (!release) {
    console.log("PREFLIGHT FAIL: gh CLI cannot fetch oven-sh/bun latest release (auth or network issue)");
    return false;
  }
  console.log(`PREFLIGHT PASS: gh CLI authenticated; oven-sh/bun latest: ${release.tag_name}`);
  return true;
}

function ingestNugget(db: Database, repo: string, release: GhRelease, dryRun: boolean): { action: "inserted" | "skipped" | "fanin"; nuggetRef: string } {
  const title = `${repo} ${release.tag_name}: ${release.name}`;
  const body = release.body ? release.body.slice(0, MAX_BODY_CHARS) : null;
  const contentHash = createHash("sha256").update(`${title}${body ?? ""}`).digest("hex");
  const nuggetRef = `${SOURCE}:${contentHash.slice(0, 12)}`;
  const sourceRef = `${repo}@${release.tag_name}`; // matches github-release-watcher dedup key format
  const sourceUrl = release.html_url;
  const fetchTs = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const publishedAt = release.published_at ? (() => {
    try { return new Date(release.published_at).toISOString().replace(/\.\d+Z$/, "Z"); } catch { return null; }
  })() : null;

  if (dryRun) {
    const scores = scoreRubric(title, body);
    console.log(`  [dry-run] ${repo}: ${nuggetRef} "${title.slice(0, 70)}" rubric=${scores.total}/50 promotable=${scores.total >= 35}`);
    return { action: "inserted", nuggetRef };
  }

  // Idempotency: same source+source_ref
  const existing = db.prepare("SELECT nugget_ref FROM research_nugget WHERE source=? AND source_ref=?").get(SOURCE, sourceRef) as { nugget_ref: string } | null;
  if (existing) return { action: "skipped", nuggetRef: existing.nugget_ref };

  // Fan-in
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
    VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,'rubric-v1.0',?,?,1,?)
  `).run(nuggetRef, SOURCE, sourceUrl, sourceRef, fetchTs, contentHash, title, body, publishedAt,
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
    console.error("Preflight failed. Skipping GitHub release ingestion.");
    if (!DRY_RUN) {
      const db = new Database(DB_PATH);
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      db.prepare("UPDATE research_source_config SET preflight_status='fail', preflight_ts=?, updated_at=? WHERE source='github_release'").run(now, now);
      db.close();
    }
    process.exit(1);
  }

  const db = DRY_RUN ? null : (() => { const d = new Database(DB_PATH); d.exec("PRAGMA journal_mode=WAL"); d.exec("PRAGMA busy_timeout=5000"); return d; })();

  let repos = DEFAULT_REPOS;
  if (db) {
    const cfg = db.prepare("SELECT config_json FROM research_source_config WHERE source='github_release'").get() as { config_json: string } | null;
    if (cfg?.config_json) {
      try {
        const parsed = JSON.parse(cfg.config_json) as { repos?: string[] };
        if (Array.isArray(parsed.repos)) repos = parsed.repos;
      } catch { /* use defaults */ }
    }
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET preflight_status='pass', preflight_ts=?, updated_at=? WHERE source='github_release'").run(now, now);
  }

  let totalInserted = 0; let totalSkipped = 0; let totalFanin = 0;

  for (const repo of repos) {
    console.log(`Fetching latest release: ${repo}`);
    const release = fetchLatestRelease(repo);
    if (!release) {
      console.log(`  ${repo}: no release found or API error, skipping`);
      continue;
    }
    console.log(`  ${repo}: ${release.tag_name}`);
    const result = ingestNugget(db!, repo, release, DRY_RUN);
    if (result.action === "inserted") totalInserted++;
    else if (result.action === "skipped") totalSkipped++;
    else if (result.action === "fanin") totalFanin++;
  }

  if (db && !DRY_RUN) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    db.prepare("UPDATE research_source_config SET last_fetched_at=?, last_nugget_count=?, updated_at=? WHERE source='github_release'").run(now, totalInserted, now);
    db.close();
  }

  console.log(`GitHub release ingestion complete: ${totalInserted} inserted, ${totalFanin} fan-in, ${totalSkipped} skipped`);
}

run().catch((e) => {
  console.error("producer-github-release fatal:", (e as Error).message);
  process.exit(1);
});
