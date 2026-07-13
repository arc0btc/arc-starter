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

import { getDatabase } from "./db.ts";

// ---- Types ----

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
}

export interface InsertCandidateFields {
  tweet_id: string;
  source_lane: string;
  first_seen: string; // ISO8601, discovery time (NOT the tweet's own created_at)
  author_id?: string;
  text_snippet?: string;
  urls?: string[];
  discovery_context?: string;
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
        (tweet_id, source_lane, first_seen, author_id, text_snippet, urls, discovery_context)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.tweet_id,
      fields.source_lane,
      fields.first_seen,
      fields.author_id ?? null,
      fields.text_snippet ?? null,
      fields.urls ? JSON.stringify(fields.urls) : null,
      fields.discovery_context ?? null
    );
  return result.changes > 0;
}

/**
 * Candidates due for re-scoring: status='pending', aged between minAgeHours and
 * maxAgeHours since first_seen, oldest first, capped at `limit` (100 by default —
 * matches X's /tweets?ids= per-call cap so ALL due candidates fit in ONE batched
 * read).
 */
export function getMaturationBatch(
  maxAgeHours: number = 24,
  minAgeHours: number = 2,
  limit: number = 100
): XResearchCandidate[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM x_research_candidate
       WHERE status = 'pending'
         AND first_seen <= datetime('now', '-' || ? || ' hours')
         AND first_seen >= datetime('now', '-' || ? || ' hours')
       ORDER BY first_seen ASC
       LIMIT ?`
    )
    .all(minAgeHours, maxAgeHours, limit) as XResearchCandidate[];
}

/** Mark a candidate as matured — a Research: task was filed for it. */
export function markCandidateMatured(tweetId: string, researchTaskId: number): void {
  const db = getDatabase();
  db.query(
    `UPDATE x_research_candidate
       SET status = 'matured', matured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), research_task_id = ?
     WHERE tweet_id = ?`
  ).run(researchTaskId, tweetId);
}

/** Mark a candidate as rejected (re-scored, did not clear the bar and won't be
 * reconsidered — used for ids the X API no longer returns, e.g. deleted/protected/
 * suspended since discovery). Candidates that simply haven't cleared the bar YET
 * but are still within the maturation window are left 'pending' by the caller
 * (not rejected) so they get another look as they age further. */
export function markCandidateRejected(tweetId: string): void {
  const db = getDatabase();
  db.query(`UPDATE x_research_candidate SET status = 'rejected' WHERE tweet_id = ?`).run(tweetId);
}

/**
 * Housekeeping, no API call: retire any candidate still 'pending' once it's aged
 * past maxAgeHours (default 24) without maturing — the maturation window is a
 * one-time pass, not an infinite retry. Returns the number of rows updated.
 */
export function expireStaleCandidates(maxAgeHours: number = 24): number {
  const db = getDatabase();
  const result = db
    .query(
      `UPDATE x_research_candidate
         SET status = 'expired'
       WHERE status = 'pending'
         AND first_seen < datetime('now', '-' || ? || ' hours')`
    )
    .run(maxAgeHours);
  return result.changes;
}
