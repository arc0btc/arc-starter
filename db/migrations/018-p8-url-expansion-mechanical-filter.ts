/**
 * P8 Migration: URL expansion + mechanical filter + story clustering (arc-x-research-channel
 * quest, Phase 8 containment pass). Adds 5 columns to x_research_candidate:
 *
 *   expanded_urls           TEXT  -- JSON string[] of real followable URLs (entities.urls[].
 *                                    expanded_url from the X API — t.co never appears here by
 *                                    construction; quote-tweet targets ARE included even
 *                                    though they're x.com/twitter.com status links, since
 *                                    those are followable content, unlike a self-referential
 *                                    link to the tweet's own id).
 *   is_retweet               INTEGER DEFAULT 0  -- from referenced_tweets type="retweeted"
 *   is_quote                 INTEGER DEFAULT 0  -- from referenced_tweets type="quoted"
 *   mechanical_reject_reason TEXT  -- set when isMechanicallyRejectable() rejects a candidate
 *                                    without ever dispatching an LLM to judge it (src/
 *                                    candidate-spine.ts). NULL for every other rejection path
 *                                    (e.g. "X no longer returns this id").
 *   cluster_key               TEXT  -- computed once at maturation time (computeClusterKey),
 *                                    priority: canonicalized primary expanded_url, else a
 *                                    normalized-text shingle key, else NULL (singleton, no
 *                                    clustering signal). Lets same-story candidates collapse
 *                                    into ONE triage task instead of one per tweet_id.
 *
 * ROOT CAUSE this unblocks: neither list-roster nor candidate-maturation ever requested
 * "entities"/"referenced_tweets" in tweet.fields (X bills per RESOURCE returned, not per
 * field — these are free additions), so every t.co-shortlinked candidate carried an
 * unexpandable link and agents rightly declined it as "bare t.co, empty Links field" — 125 of
 * 195 sensor-filed tasks in 24h were exactly this class of decline, at full per-candidate
 * Opus/Sonnet dispatch cost.
 *
 * Additive-only (ALTER TABLE ADD COLUMN, guarded by user_version, mirrors migration 016's
 * shape). Bumps user_version 15 -> 16.
 *
 * Usage: bun run 018-p8-url-expansion-mechanical-filter.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 018-p8-url-expansion-mechanical-filter.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[018-p8] Current user_version: ${user_version}`);

if (user_version >= 16) {
  console.log("[018-p8] Already at user_version >= 16. Migration already applied. Skipping.");
  db.close();
  process.exit(0);
}

if (user_version < 15) {
  console.error(`[018-p8] Expected user_version >= 15, got ${user_version}. Run prior migrations first.`);
  db.close();
  process.exit(1);
}

const cols = db.query("PRAGMA table_info(x_research_candidate)").all() as Array<{ name: string }>;
const existing = new Set(cols.map((c) => c.name));

const toAdd: Array<[string, string]> = [
  ["expanded_urls", "TEXT"],
  ["is_retweet", "INTEGER DEFAULT 0"],
  ["is_quote", "INTEGER DEFAULT 0"],
  ["mechanical_reject_reason", "TEXT"],
  ["cluster_key", "TEXT"],
];

for (const [name, ddl] of toAdd) {
  if (existing.has(name)) {
    console.log(`[018-p8] Column ${name} already present — skipping ALTER`);
    continue;
  }
  db.exec(`ALTER TABLE x_research_candidate ADD COLUMN ${name} ${ddl}`);
  console.log(`[018-p8] Added x_research_candidate.${name} ${ddl}`);
}

// Index for the cross-run cluster-collapse lookup (getRecentMaturedCandidates already scans
// matured_at with a window bound; this speeds the cluster_key equality lookup within that scan).
db.exec(`CREATE INDEX IF NOT EXISTS idx_candidate_cluster_key ON x_research_candidate(cluster_key)`);
console.log("[018-p8] Ensured idx_candidate_cluster_key index");

db.exec("PRAGMA user_version = 16");
console.log("[018-p8] user_version bumped to 16");

db.close();
