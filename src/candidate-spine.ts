// src/candidate-spine.ts
//
// The candidate-maturation spine (arc-x-research-channel quest, Phase 2, Option B).
//
// Every X discovery lane (keyword-rotation legacy producer, news-search + trends in
// Phase 3, list-roster in Phase 4) STORES what it finds here instead of judging it
// at birth. This is the fix for social-x-ecosystem/sensor.ts's structural bug: a
// tweet is typically seconds-to-minutes old when a search/recent page surfaces it,
// so an engagement-threshold check AT DISCOVERY TIME almost never passes — the
// sensor stored the id as "seen" and never looked again, producing 0 research
// tasks across 4+ months of runs. Here, candidates sit in x_research_candidate
// until they age into the 2-24h window, at which point
// skills/candidate-maturation/sensor.ts re-scores them in ONE batched
// GET /2/tweets?ids= read and files a Research: task for the ones that matured.
//
// Table: x_research_candidate (see db/migrations/015-p2-candidate-spine.ts).
// Lives at engine level (like src/db.ts, src/sensors.ts) because Phase 3/4's
// news/trends/list producers import it from their OWN skill directories, not from
// social-x-ecosystem.

import type { SQLQueryBindings } from "bun:sqlite";
import { getDatabase } from "./db.ts";

// ---- Types ----

/** Known `source_lane` values (2026-07-13, Phase 3, dev-council/Fowler lens:
 * "the registry threshold: half-crossed, so cross it halfway" — three
 * `source_lane` values now exist across two phases, which is what Phase 2
 * deferred a registry until). A lightweight union for compile-time hinting at
 * producer call sites — deliberately NOT a DB CHECK constraint
 * (`x_research_candidate.source_lane` stays a free TEXT column) and NOT the
 * same namespace as `by_lane` billing-lane keys (those are open-ended by
 * design, `endpointLane()` derives arbitrary ones — forcing a closed registry
 * there would fight the grain). Add each new lane's literal here as it ships;
 * `list-roster` joins in Phase 4. */
export type KnownSourceLane = "keyword-rotation" | "news-search" | "list-roster";

export interface XResearchCandidate {
  id: number;
  tweet_id: string;
  source_lane: string;
  first_seen: string;
  author_id: string | null;
  text_snippet: string | null;
  urls: string | null; // JSON-encoded string[] — use JSON.parse to read
  discovery_context: string | null;
  status: "pending" | "matured" | "rejected" | "expired";
  matured_at: string | null;
  research_task_id: number | null;
  created_at: string;
  // ---- Phase 8 containment-pass columns (migration 018) ----
  expanded_urls: string | null; // JSON-encoded string[] — real followable URLs (entities.urls[].expanded_url)
  is_retweet: number; // 0/1, from referenced_tweets type="retweeted"
  is_quote: number; // 0/1, from referenced_tweets type="quoted"
  mechanical_reject_reason: string | null; // set only when isMechanicallyRejectable() rejected this candidate
  cluster_key: string | null; // set at maturation time by computeClusterKey — collapses same-story candidates
}

export interface InsertCandidateFields {
  tweet_id: string;
  source_lane: string;
  first_seen: string; // ISO8601, discovery time (NOT the tweet's own created_at)
  author_id?: string;
  text_snippet?: string;
  urls?: string[];
  discovery_context?: string;
  expandedUrls?: string[];
  isRetweet?: boolean;
  isQuote?: boolean;
}

// ---- Shared scoring primitives ----
//
// Moved verbatim from skills/social-x-ecosystem/sensor.ts (2026-07-13, Phase 2)
// so every producer/consumer of the spine shares one bar instead of forking it.

const URL_RE = /https?:\/\/[^\s)]+/g;

/** Extract non-t.co, non-self-referential (x.com/twitter.com) URLs from tweet text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE);
  if (!matches) return [];
  return matches.filter((u) => {
    // Filter out t.co shortlinks (Twitter's own URL wrapping)
    if (u.startsWith("https://t.co/")) return false;
    // Filter out x.com/twitter.com self-references — the tweet is already captured via tweet ID
    try {
      const host = new URL(u).hostname;
      if (host === "x.com" || host === "twitter.com") return false;
    } catch {
      return false;
    }
    return true;
  });
}

export interface TweetPublicMetrics {
  like_count: number;
  retweet_count: number;
  reply_count: number;
}

/** High engagement: 5+ likes or 2+ retweets or 3+ replies. Same bar the old
 * at-birth judge used — the fix is WHEN this is checked (2-24h aged), not the bar
 * itself. */
export function isHighSignal(metrics: TweetPublicMetrics | undefined): boolean {
  if (!metrics) return false;
  return metrics.like_count >= 5 || metrics.retweet_count >= 2 || metrics.reply_count >= 3;
}

// ---- URL expansion + referenced-tweet classification (Phase 8, containment pass) ----
//
// ROOT CAUSE this section fixes: X's tweet.fields never included "entities" or
// "referenced_tweets" anywhere in the discovery/maturation path — only
// skills/arc-link-research/cli.ts's single-tweet fetch requested "entities" (for its OWN
// per-link processing, unrelated to this spine). Every t.co-shortlinked tweet therefore
// carried an unexpandable link, and skills/candidate-spine.ts's own extractUrls() explicitly
// filters t.co out — so a candidate whose ONLY link was a t.co shortlink was stored with
// urls=[] and correctly, but wastefully, declined by a paid dispatched agent as "bare t.co,
// empty Links field" (125 of 195 sensor-filed tasks in 24h were this exact class). X bills
// per RESOURCE returned, not per field (Phase 1's metering fix + the 2026-07-13 console
// reconciliation doc) — adding these fields to an existing batched read is free.

/** Minimal structural view of the X API v2 `entities.urls[]` shape (same shape
 * skills/arc-link-research/cli.ts already requests via "entities" in tweet.fields — this is
 * not a new field, just a new READER of an existing, proven, zero-marginal-cost field). */
export interface TweetUrlEntity {
  url?: string; // the t.co wrapper, e.g. "https://t.co/abc123"
  expanded_url?: string; // the real destination — NEVER a t.co domain
  display_url?: string;
}

export interface TweetEntities {
  urls?: TweetUrlEntity[];
}

/** X API v2 `referenced_tweets[]` shape — "retweeted"/"quoted"/"replied_to" + the id of the
 * referenced tweet. */
export interface ReferencedTweet {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
}

/**
 * Extract real, followable URLs from `entities.urls[].expanded_url`. Drops empty/falsy
 * entries. Drops a URL that's a SELF-reference (x.com/twitter.com pointing back at `ownTweetId`
 * itself — the tweet is already captured via its own tweet_id, following that link teaches
 * nothing new) but KEEPS an x.com/twitter.com URL pointing at a DIFFERENT status id — that's a
 * quote-tweet target, genuinely followable content per the operator's own framing ("Quote-tweet
 * expanded_url (x.com/status links) counts as followable content").
 */
export function extractExpandedUrls(entities: TweetEntities | undefined | null, ownTweetId: string): string[] {
  if (!entities?.urls?.length) return [];
  const out: string[] = [];
  for (const u of entities.urls) {
    const expanded = u.expanded_url;
    if (!expanded) continue;
    try {
      const parsed = new URL(expanded);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "x.com" || host === "twitter.com") {
        const statusMatch = parsed.pathname.match(/\/status(?:es)?\/(\d+)/);
        if (statusMatch && statusMatch[1] === ownTweetId) continue; // self-reference, drop
      }
      out.push(expanded);
    } catch {
      // Unparseable expanded_url — skip rather than store a broken link.
      continue;
    }
  }
  return out;
}

/** Classify a tweet's `referenced_tweets[]` into the two flags this spine cares about. Missing/
 * empty input is a normal original post, not an error — returns both false. */
export function classifyReferencedTweets(
  referencedTweets: ReferencedTweet[] | undefined | null
): { isRetweet: boolean; isQuote: boolean } {
  if (!referencedTweets?.length) return { isRetweet: false, isQuote: false };
  return {
    isRetweet: referencedTweets.some((r) => r.type === "retweeted"),
    isQuote: referencedTweets.some((r) => r.type === "quoted"),
  };
}

// ---- Store ----

/**
 * Insert a newly-discovered candidate if its tweet_id isn't already stored
 * (UNIQUE(tweet_id) — first lane to see a tweet wins; a later lane rediscovering
 * the same tweet is a no-op, not a duplicate/second candidate). Returns true if a
 * new row was actually inserted, false if it already existed.
 */
export function insertCandidateIfNew(fields: InsertCandidateFields): boolean {
  const db = getDatabase();
  const result = db
    .query(
      `INSERT OR IGNORE INTO x_research_candidate
        (tweet_id, source_lane, first_seen, author_id, text_snippet, urls, discovery_context,
         expanded_urls, is_retweet, is_quote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.tweet_id,
      fields.source_lane,
      fields.first_seen,
      fields.author_id ?? null,
      fields.text_snippet ?? null,
      fields.urls ? JSON.stringify(fields.urls) : null,
      fields.discovery_context ?? null,
      fields.expandedUrls?.length ? JSON.stringify(fields.expandedUrls) : null,
      fields.isRetweet ? 1 : 0,
      fields.isQuote ? 1 : 0
    );
  return result.changes > 0;
}

/**
 * Backfill expanded_urls/is_retweet/is_quote onto an EXISTING candidate row (Phase 8,
 * containment pass). Used by candidate-maturation/sensor.ts's batched re-score read — the
 * authoritative place every candidate, regardless of which lane discovered it, gets a fresh
 * `entities`/`referenced_tweets` look before scoring. This is enrichment, not a state
 * transition (unlike markCandidateMatured/markCandidateRejected), so it carries no
 * `AND status='pending'` guard — a matured/rejected row can still receive a late enrichment
 * update without changing its status. Only fields explicitly present in `fields` are written;
 * omitting a field leaves the existing column value untouched (partial update).
 */
export function updateCandidateEnrichment(
  tweetId: string,
  fields: { expandedUrls?: string[]; isRetweet?: boolean; isQuote?: boolean }
): { changes: number } {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.expandedUrls !== undefined) {
    sets.push("expanded_urls = ?");
    values.push(fields.expandedUrls.length ? JSON.stringify(fields.expandedUrls) : null);
  }
  if (fields.isRetweet !== undefined) {
    sets.push("is_retweet = ?");
    values.push(fields.isRetweet ? 1 : 0);
  }
  if (fields.isQuote !== undefined) {
    sets.push("is_quote = ?");
    values.push(fields.isQuote ? 1 : 0);
  }
  if (sets.length === 0) return { changes: 0 };

  const db = getDatabase();
  const result = db
    .query(`UPDATE x_research_candidate SET ${sets.join(", ")} WHERE tweet_id = ?`)
    .run(...([...values, tweetId] as SQLQueryBindings[]));
  return { changes: result.changes };
}

/**
 * Candidates due for re-scoring: status='pending', aged between minAgeHours and
 * maxAgeHours since first_seen, oldest first, capped at `limit` (100 by default —
 * matches X's /tweets?ids= per-call cap so ALL due candidates fit in ONE batched
 * read).
 *
 * `first_seen` is written by JS callers as `new Date().toISOString()`
 * (`...T10:49:03.079Z` — T-separated, millisecond precision). SQLite's
 * `datetime('now', ...)` produces SPACE-separated output (`...  11:50:04`, no T,
 * no ms) — comparing the two lexicographically is WRONG (the byte at the T/space
 * position sorts differently and silently breaks every boundary check; caught via
 * live-testing during Phase 2's end-to-end proof). `strftime('%Y-%m-%dT%H:%M:%SZ',
 * ...)` produces the SAME T/Z-separated shape `first_seen` uses (just without the
 * millisecond suffix, which doesn't affect ordering at hour/minute/second
 * granularity) — use it for both boundaries so the comparison is apples-to-apples.
 *
 * Params are (minAgeHours, maxAgeHours) — natural reading order (dev-council/
 * Fowler lens, 2026-07-13: the original (maxAgeHours, minAgeHours) order put the
 * larger bound first, inviting a transposition bug at the call site).
 */
export function getMaturationBatch(
  minAgeHours: number = 2,
  maxAgeHours: number = 24,
  limit: number = 100
): XResearchCandidate[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM x_research_candidate
       WHERE status = 'pending'
         AND first_seen <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' hours')
         AND first_seen >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' hours')
       ORDER BY first_seen ASC
       LIMIT ?`
    )
    .all(minAgeHours, maxAgeHours, limit) as XResearchCandidate[];
}

/**
 * Mark a candidate as matured — a Research: task was filed for it (or, when
 * `researchTaskId` is `null`, a task already existed under this tweet's dedup
 * source key and its real id wasn't re-looked-up — `research_task_id` is
 * nullable precisely for this case; NEVER write a sentinel like `0` into a
 * column declared `REFERENCES tasks(id)` — there is no task id 0
 * (AUTOINCREMENT starts at 1), and FK enforcement being off means a bad
 * reference like that fails silently instead of throwing (dev-council/Fowler +
 * Kleppmann lenses, 2026-07-13, both independently flagged this).
 *
 * `AND status = 'pending'` in the WHERE clause (dev-council/Lamport lens,
 * 2026-07-13) makes this UPDATE the linearization point for the candidate's
 * state machine: status is monotone pending -> {matured|rejected|expired},
 * terminal. Without the guard, two overlapping maturation-sensor runs (e.g. a
 * manual test run overlapping the systemd timer) could both read the same
 * 'pending' row, both bill the read, and both file a task for it — this makes
 * only the run that actually flips pending->matured "win"; callers MUST check
 * the returned `changes` count and treat 0 as "another run already handled
 * this candidate," not retry/re-file. (The claimSensorRun hook-state gate has
 * its own pre-existing, Phase-1-disclosed, not-yet-fixed TOCTOU race across
 * independently-scheduled processes — this guard bounds ITS blast radius at
 * the data layer without depending on that gate being airtight.)
 */
export function markCandidateMatured(
  tweetId: string,
  researchTaskId: number | null,
  clusterKey?: string | null
): { changes: number } {
  const db = getDatabase();
  const result = db
    .query(
      `UPDATE x_research_candidate
         SET status = 'matured', matured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), research_task_id = ?,
             cluster_key = COALESCE(?, cluster_key)
       WHERE tweet_id = ? AND status = 'pending'`
    )
    .run(researchTaskId, clusterKey ?? null, tweetId);
  return { changes: result.changes };
}

/** Mark a candidate as rejected (re-scored, did not clear the bar and won't be
 * reconsidered — used for ids the X API no longer returns, e.g. deleted/protected/
 * suspended since discovery). Candidates that simply haven't cleared the bar YET
 * but are still within the maturation window are left 'pending' by the caller
 * (not rejected) so they get another look as they age further.
 *
 * `AND status = 'pending'` guard — same monotonic-transition reasoning as
 * `markCandidateMatured` above (dev-council/Lamport lens, 2026-07-13). Returns
 * the changed-row count so a caller can detect "already handled by another run."
 *
 * `reason` (Phase 8, containment pass): when supplied, recorded in
 * `mechanical_reject_reason` — set ONLY by isMechanicallyRejectable()-driven rejections, so a
 * NULL value here always means "rejected for a non-mechanical reason" (id no longer returned
 * by X, etc.), never "mechanically rejected but no reason logged."
 */
export function markCandidateRejected(tweetId: string, reason?: string): { changes: number } {
  const db = getDatabase();
  const result = db
    .query(
      `UPDATE x_research_candidate SET status = 'rejected', mechanical_reject_reason = ?
       WHERE tweet_id = ? AND status = 'pending'`
    )
    .run(reason ?? null, tweetId);
  return { changes: result.changes };
}

export interface MaturedCandidateSummary {
  tweet_id: string;
  discovery_context: string | null;
  research_task_id: number | null;
  cluster_key: string | null;
}

/**
 * Matured candidates within the last `withinHours` (default 24) — feeds the
 * cross-run cluster-collapse index in skills/candidate-maturation/sensor.ts (see
 * candidate-maturation-incident-vs-tweet-dedup-churn memory entry, 2026-07-13:
 * one viral story matured through 5 distinct sibling tweet_ids and filed 5
 * separate research tasks because the original dedup keyed on tweet_id, not the
 * underlying story). Phase 8 supersedes the discovery_context-only version of this
 * index with `cluster_key` (computeClusterKey below — canonical URL first, text-shingle
 * fallback) so cross-author same-story candidates collapse too, not just same-News-story
 * ones sharing an identical discovery_context.
 */
export function getRecentMaturedCandidates(withinHours: number = 24): MaturedCandidateSummary[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT tweet_id, discovery_context, research_task_id, cluster_key
       FROM x_research_candidate
       WHERE status = 'matured'
         AND matured_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' hours')`
    )
    .all(withinHours) as MaturedCandidateSummary[];
}

/**
 * Normalize a `discovery_context` string (news title / search context) into an
 * incident key: lowercase, strip punctuation, collapse whitespace. Near-identical
 * titles for the same viral story ("BridgeMind: GPT-5.6 Sol cancels ALL Stripe
 * subscriptions!" vs "bridgemind gpt 5.6 sol cancels all stripe subscriptions")
 * collapse to the same key without any LLM call. Returns `null` for empty/missing
 * context — callers must treat `null` as "no incident key, can't dedup this way"
 * rather than matching it against other nulls (an empty context isn't an incident).
 */
export function normalizeIncidentKey(discoveryContext: string | null | undefined): string | null {
  if (!discoveryContext) return null;
  const normalized = discoveryContext
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

// ---- Mechanical pre-filter + story clustering (Phase 8, containment pass) ----
//
// Derived from 135 REAL decline reasons sampled from tasks.result_summary (source LIKE
// 'sensor:candidate-maturation:%', 2026-07-14). Two decline classes exist in that sample:
//   (a) MECHANICAL — bare t.co / empty Links field + RT-only or a one-line quip with zero
//       mission-relevant signal (e.g. #22582 "RT @joon_h_lee: https://t.co/eZCiriQzvm", Links
//       empty; #22581 bare t.co with no other text). Code-checkable without an LLM.
//   (b) TOPICAL — a real link/story IS present, declined for being off-mission (SK Hynix ADR
//       listing x9, MSTR treasury x6, generic BTC price-action x6, memecoin/hype content).
//       This requires editorial judgment a mechanical filter cannot safely replicate — DO NOT
//       try to catch this class here. It's what the two-stage triage dispatch (Task 2) exists
//       for: one CHEAP batched judgment call instead of N paid per-candidate dispatches.
//
// isMechanicallyRejectable() therefore ONLY ever rejects class (a). Any candidate with a real
// expanded URL always defers to triage, full stop — mechanically pre-judging topical relevance
// is exactly the mistake this comment warns against.

/** Mission-relevant keyword allowlist for the mechanical filter's thin-text branch (a
 * link-free, short candidate is spared mechanical rejection if it at least NAMES something
 * mission-relevant — the triage stage still gets final say, this only decides whether it's
 * worth even offering to triage). Deliberately broader than x-news-trends.ts's MISSION_TERMS
 * (that list biases which News queries run; this one decides whether a link-free scrap of text
 * is worth a human/LLM glance at all) but drawn from the same mission vocabulary. */
const MISSION_KEYWORDS = [
  "bitcoin", "btc", "aibtc", "stacks", "stx", "sbtc", "agent", "claude", "opus", "sonnet",
  "llm", "mcp", "x402", "lightning", "defi", "arc0", "arc-starter", "agent-runtime",
];

function stripRtPrefixMentionsAndUrls(text: string): string {
  return text
    .replace(/^RT\s+@\w+:\s*/i, "") // native/legacy retweet copy prefix
    .replace(/@\w+/g, "") // @mentions
    .replace(/https?:\/\/\S+/g, "") // any residual raw URL (t.co or otherwise)
    .replace(/\s+/g, " ")
    .trim();
}

export interface MechanicalFilterInput {
  expandedUrls: string[];
  isRetweet: boolean;
  textSnippet: string;
}

export interface MechanicalFilterResult {
  reject: boolean;
  reason?: string;
}

/**
 * Cheap, code-only rejection for candidates with structurally zero researchable substance —
 * see the module-comment above for exactly which decline class this targets and which it
 * deliberately does NOT (topical/off-mission judgment always goes to triage, never guessed
 * here). A candidate with ANY real expanded URL is NEVER mechanically rejected — link presence
 * always defers the relevance call to triage.
 */
export function isMechanicallyRejectable(input: MechanicalFilterInput): MechanicalFilterResult {
  if (input.expandedUrls.length > 0) return { reject: false };

  const stripped = stripRtPrefixMentionsAndUrls(input.textSnippet ?? "");
  const hasRtPrefix = input.isRetweet || /^RT\s+@\w+:/i.test((input.textSnippet ?? "").trim());

  if (stripped.length === 0) {
    return {
      reject: true,
      reason: hasRtPrefix
        ? "mechanical: retweet-only, no URL, no residual text after stripping RT-prefix/mentions/links"
        : "mechanical: no URL, no residual text after stripping mentions/links",
    };
  }

  const lower = stripped.toLowerCase();
  const hasMissionSignal = MISSION_KEYWORDS.some((kw) => lower.includes(kw));
  if (stripped.length < 20 && !hasMissionSignal) {
    return {
      reject: true,
      reason: "mechanical: one-line/thin text, no URL, no mission-relevant keyword signal",
    };
  }

  return { reject: false };
}

/** Lowercase host (stripping a leading "www."), strip query string + fragment + trailing
 * slash. Returns null on parse failure — callers must never merge candidates on a failed
 * canonicalization. */
export function canonicalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    let path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

export interface ClusterKeyInput {
  expandedUrls: string[];
  textSnippet: string;
}

/**
 * Priority 1: canonicalized primary expanded URL (the strongest, cheapest same-story signal —
 * two candidates linking the same canonical URL are the same story almost by definition).
 * Priority 2 (only reached for candidates that survived the mechanical filter WITHOUT a URL,
 * i.e. had enough thin-text substance/keyword signal to defer to triage): a light text-shingle
 * key — RT-prefix/mention/URL-stripped text, first 12 whitespace-separated tokens, normalized
 * via the same punctuation/case folding as normalizeIncidentKey. Returns null (no clustering —
 * a singleton) if fewer than 4 tokens survive stripping, to avoid false-merging unrelated short
 * quips that happen to share a few common words.
 */
export function computeClusterKey(input: ClusterKeyInput): string | null {
  if (input.expandedUrls.length > 0) {
    const canon = canonicalizeUrl(input.expandedUrls[0]);
    if (canon) return `url:${canon}`;
  }
  const stripped = stripRtPrefixMentionsAndUrls(input.textSnippet ?? "");
  const tokens = normalizeIncidentKey(stripped)?.split(" ").filter(Boolean) ?? [];
  if (tokens.length < 4) return null;
  return `text:${tokens.slice(0, 12).join(" ")}`;
}

/**
 * Housekeeping, no API call: retire any candidate still 'pending' once it's aged
 * past maxAgeHours (default 24) without maturing — the maturation window is a
 * one-time pass, not an infinite retry. Returns the number of rows updated.
 */
export function expireStaleCandidates(maxAgeHours: number = 24): number {
  const db = getDatabase();
  // Same T/Z-format boundary fix as getMaturationBatch — first_seen is ISO8601
  // (T/Z-separated); datetime('now', ...) alone produces a space-separated
  // string that compares incorrectly against it.
  const result = db
    .query(
      `UPDATE x_research_candidate
         SET status = 'expired'
       WHERE status = 'pending'
         AND first_seen < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || ? || ' hours')`
    )
    .run(maxAgeHours);
  return result.changes;
}
