#!/usr/bin/env bun
/**
 * skills/social-engine/quote-trigger-detect.ts
 *
 * arc-day-n-publishing P4 — event-driven quote-tweet trigger + receipt-attachment step.
 *
 * PHASES.md P4 names this as a required, separate lane from the 10-15/day link-free
 * reply program: "event-driven same-day quote-tweets when a big agent story breaks,
 * with Arc's live receipts attached." Nothing in the codebase built this before —
 * confirmed by grepping skills/social-x-posting and skills/social-engine for
 * "quote_tweet_id" / quote-tweet sending logic (zero hits pre-P4).
 *
 * Trigger definition (tunable — matches this codebase's existing "tune from evidence,
 * not the spec" convention, see reply-copy-pool.ts / follow-curated.ts):
 *   A tweet from an is_agent=1 OR reach_fit_tier IN ('A','bitcoin_thesis') account in
 *   the active follow pool (follow_state='following'), posted in the last 24h, whose
 *   (retweet_count + like_count) meets or exceeds ENGAGEMENT_THRESHOLD. This is the
 *   "big agent story breaking" signal — a fresh tweet from a targeted account getting
 *   real traction, not a bare mention or a routine post.
 *
 * Receipt-attachment step:
 *   On a hit, pull ONE live Arc receipt — MAX(edition_n) from daily_read_log, the
 *   Day-N counter this same quest built in P1 — and compose a short, receipt-forward
 *   quote-tweet TEXT. The quote itself carries the link via X's native quote-tweet UI
 *   (attaching quote_tweet_id in the POST body), so the composed text stays receipt-
 *   forward rather than a bare reaction or hype line.
 *
 * THIS SCRIPT DOES NOT SEND. It only detects + composes. Sending (when a real trigger
 * fires) is `bun skills/social-x-posting/cli.ts post --text "<composed>" \
 *   --quote-tweet-id <id>` — that command inherits the full proven guard stack (kill
 * switch, DAILY_TWEET_CAP, budget, enforceInterSendSpacing, terminal-403-no-retry). A
 * quote-tweet is a normal outbound tweet for cap purposes (unlike the reply lane).
 *
 * Usage:
 *   bun skills/social-engine/quote-trigger-detect.ts               # real trigger scan
 *   bun skills/social-engine/quote-trigger-detect.ts --stage-example  # force one example
 *     against the first live tweet found in the follow pool, regardless of engagement
 *     threshold, to prove the composition logic end-to-end. Always prints/writes a
 *     "STAGED EXAMPLE — NOT SENT" result; never calls cli.ts post.
 */

import { Database } from "bun:sqlite";
import { loadXCreds, xApiGet } from "../social-x-posting/lib/x-api.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const STAGE_EXAMPLE = process.argv.includes("--stage-example");

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
// Testing affordance (same spirit as --dry-run elsewhere in this codebase): prove the
// receipt-attachment + composition logic against an already-known real tweet id/handle
// without spending live X read-search budget. Never used by the real-trigger path.
const EXAMPLE_TWEET_ID = flagValue("--example-tweet-id");
const EXAMPLE_HANDLE = flagValue("--example-handle");

// Starting point, not a settled number — tune from evidence once real hits accumulate.
const ENGAGEMENT_THRESHOLD = 20;
const TRIGGER_WINDOW_HOURS = 24;

function log(msg: string) {
  console.error(`[${new Date().toISOString()}] [quote-trigger-detect] ${msg}`);
}

interface CandidateAccount {
  id: number;
  handle: string;
  is_agent: number;
  reach_fit_tier: string | null;
}

interface CandidateTweet {
  id: string;
  text: string;
  created_at: string;
  author_handle: string;
  retweet_count: number;
  like_count: number;
}

async function fetchWithMetrics(handle: string, creds: Awaited<ReturnType<typeof loadXCreds>>): Promise<CandidateTweet[]> {
  if (!creds) return [];
  const resp = await xApiGet("/tweets/search/recent", creds, {
    query: `from:${handle}`,
    max_results: "10",
    "tweet.fields": "created_at,public_metrics",
  });
  const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  return data.map((t) => {
    const metrics = (t["public_metrics"] as Record<string, number> | undefined) ?? {};
    return {
      id: String(t["id"]),
      text: String(t["text"] ?? ""),
      created_at: String(t["created_at"] ?? ""),
      author_handle: handle,
      retweet_count: metrics["retweet_count"] ?? 0,
      like_count: metrics["like_count"] ?? 0,
    };
  });
}

function composeQuoteText(db: Database, candidate: CandidateTweet): string {
  const row = db.query("SELECT MAX(edition_n) as n FROM daily_read_log").get() as { n: number | null } | null;
  const editionN = row?.n ?? 0;
  return `Day ${editionN} and counting. Worth a real receipt on this one: @${candidate.author_handle}'s post is the kind of signal Arc's own operating log exists to cross-check, not just react to.`;
}

async function run() {
  const db = new Database(DB_PATH, { readonly: true });

  if (STAGE_EXAMPLE && EXAMPLE_TWEET_ID && EXAMPLE_HANDLE) {
    // Read-budget-free path: compose against an already-known real tweet id/handle
    // (e.g. one surfaced by this session's own reply-lane discovery runs) to prove the
    // composition logic without a fresh network read.
    const candidate: CandidateTweet = {
      id: EXAMPLE_TWEET_ID,
      text: "",
      created_at: new Date().toISOString(),
      author_handle: EXAMPLE_HANDLE,
      retweet_count: 0,
      like_count: 0,
    };
    const text = composeQuoteText(db, candidate);
    console.log(JSON.stringify({
      mode: "STAGED_EXAMPLE_NOT_SENT",
      banner: "STAGED EXAMPLE — NOT SENT",
      source: "example-tweet-id/example-handle override (read-budget-free — no live X search call made)",
      target_tweet_id: candidate.id,
      target_handle: candidate.author_handle,
      composed_text: text,
      would_send_command: `bun skills/social-x-posting/cli.ts post --text "${text.replace(/"/g, '\\"')}" --quote-tweet-id ${candidate.id}`,
      note: "Proves the receipt-attachment + composition path (MAX(edition_n) pull + text assembly) against a real, already-known live tweet id. No real 'big agent story' engagement trigger fired this run, and this script never calls cli.ts post.",
      generated_at: new Date().toISOString(),
    }, null, 2));
    db.close();
    return;
  }

  const creds = await loadXCreds();
  if (!creds) {
    log("X credentials not available — exiting.");
    return;
  }

  const accounts = db.query(`
    SELECT id, handle, is_agent, reach_fit_tier
    FROM social_accounts
    WHERE follow_state = 'following'
      AND targeting_status = 'eligible'
      AND (is_agent = 1 OR reach_fit_tier IN ('A', 'bitcoin_thesis'))
    ORDER BY handle ASC
  `).all() as CandidateAccount[];

  log(`Scanning ${accounts.length} agent/bitcoin-thesis accounts in the active pool (window=${TRIGGER_WINDOW_HOURS}h, threshold=${ENGAGEMENT_THRESHOLD})`);

  const now = Date.now();
  const windowMs = TRIGGER_WINDOW_HOURS * 3600 * 1000;
  let firstLiveTweet: CandidateTweet | null = null;
  let triggeredHit: CandidateTweet | null = null;

  for (const account of accounts) {
    let tweets: CandidateTweet[];
    try {
      tweets = await fetchWithMetrics(account.handle, creds);
    } catch (e: any) {
      log(`@${account.handle}: search error — ${(e?.message ?? String(e)).slice(0, 100)}`);
      continue;
    }
    for (const t of tweets) {
      const age = now - new Date(t.created_at).getTime();
      if (age < 0 || age > windowMs) continue;
      if (!firstLiveTweet) firstLiveTweet = t;
      const engagement = t.retweet_count + t.like_count;
      if (engagement >= ENGAGEMENT_THRESHOLD) {
        log(`TRIGGER: @${account.handle} tweet ${t.id} — engagement=${engagement} (>= ${ENGAGEMENT_THRESHOLD})`);
        triggeredHit = t;
        break;
      }
    }
    if (triggeredHit) break;
    if (STAGE_EXAMPLE && firstLiveTweet) break; // stage-example only needs one candidate
  }

  if (triggeredHit) {
    const text = composeQuoteText(db, triggeredHit);
    console.log(JSON.stringify({
      mode: "real_trigger",
      target_tweet_id: triggeredHit.id,
      target_handle: triggeredHit.author_handle,
      engagement: triggeredHit.retweet_count + triggeredHit.like_count,
      composed_text: text,
      next_step: `bun skills/social-x-posting/cli.ts post --text "${text.replace(/"/g, '\\"')}" --quote-tweet-id ${triggeredHit.id}`,
      note: "A real trigger fired. This script does not send — review then run next_step manually, or wire it into the reply-watchlist-sensor's cron cadence once proven.",
    }, null, 2));
    db.close();
    return;
  }

  if (STAGE_EXAMPLE && firstLiveTweet) {
    const text = composeQuoteText(db, firstLiveTweet);
    const staged = {
      mode: "STAGED_EXAMPLE_NOT_SENT",
      banner: "STAGED EXAMPLE — NOT SENT",
      target_tweet_id: firstLiveTweet.id,
      target_handle: firstLiveTweet.author_handle,
      engagement: firstLiveTweet.retweet_count + firstLiveTweet.like_count,
      engagement_threshold: ENGAGEMENT_THRESHOLD,
      crossed_threshold: (firstLiveTweet.retweet_count + firstLiveTweet.like_count) >= ENGAGEMENT_THRESHOLD,
      composed_text: text,
      would_send_command: `bun skills/social-x-posting/cli.ts post --text "${text.replace(/"/g, '\\"')}" --quote-tweet-id ${firstLiveTweet.id}`,
      note: "Staged to prove the receipt-attachment + composition path end to end against a real live tweet. No real 'big agent story' engagement trigger fired this run, and this script never calls cli.ts post — a real send only happens when a human or a future dispatch turn reviews a genuine trigger hit and runs the command above.",
      generated_at: new Date().toISOString(),
    };
    console.log(JSON.stringify(staged, null, 2));
    db.close();
    return;
  }

  console.log(JSON.stringify({ mode: "no_trigger", message: "No tweet in the active pool crossed the engagement threshold this run. Not a failure — this is the expected common case." }, null, 2));
  db.close();
}

run().catch((e) => {
  console.error("[quote-trigger-detect] Fatal:", e.message);
  process.exit(1);
});
