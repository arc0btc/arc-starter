#!/usr/bin/env bun
// skills/social-x-posting/cli.ts
// CLI for posting tweets and managing X (Twitter) presence via API v2

import { getCredential } from "../../src/credentials.ts";
import { join } from "path";

const API_BASE = "https://api.x.com/2";
const CACHE_PATH = join(import.meta.dir, "../../db/x-cache.json");
const BUDGET_PATH = join(import.meta.dir, "../../db/x-budget.json");
const BUDGET_HISTORY_PATH = join(import.meta.dir, "../../db/x-budget-history.json"); // AI-005: trailing cadence history
const CREDITS_DEPLETED_PATH = join(import.meta.dir, "../../db/x-credits-depleted.json");

const CREDITS_DEPLETED_TTL_DAYS = 30;

// ---- Credits Depleted Gate ----

interface CreditsDepleted {
  depleted_at: string;
  reason: string;
}

async function checkCreditsDepleted(): Promise<void> {
  try {
    const file = Bun.file(CREDITS_DEPLETED_PATH);
    if (!(await file.exists())) return;
    const data = (await file.json()) as CreditsDepleted;
    const depletedAt = new Date(data.depleted_at);
    const expiresAt = new Date(depletedAt.getTime() + CREDITS_DEPLETED_TTL_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < expiresAt) {
      throw new Error(
        `X API credits depleted (since ${data.depleted_at}). ` +
          `Auto-clears ${expiresAt.toISOString()}. ` +
          `To clear manually: rm db/x-credits-depleted.json`
      );
    }
    // Expired — auto-clear
    await Bun.write(CREDITS_DEPLETED_PATH, "");
    log("Credits depleted flag expired and cleared (30 days passed)");
  } catch (e) {
    // Re-throw our own error; swallow JSON parse issues
    if (e instanceof Error && e.message.includes("credits depleted")) throw e;
  }
}

async function setCreditsDepleted(reason: string): Promise<void> {
  const data: CreditsDepleted = { depleted_at: new Date().toISOString(), reason };
  await Bun.write(CREDITS_DEPLETED_PATH, JSON.stringify(data, null, 2));
  log(`Credits depleted flag written: ${reason}`);
}

// ---- Source-dedup for the non-idempotent POST /tweets write path. ----
// `post`/`reply` hit POST /tweets, which is non-idempotent and has NO idempotency
// header (unlike Whop's `idempotencyKey`). An optional --source key gives replay
// protection via a LOCAL ledger (x_post_log): a recorded source short-circuits
// BEFORE any API/budget call, so a sequential re-run (a dispatch retry or a
// next-cycle fan-out re-fire — the real operational profile, since each agent
// dispatches one task at a time) never double-posts. This mirrors the proven
// whop_post_log ledger (skills/whop/cli.ts); the local ledger is the SOLE
// exactly-once guarantee. Same accepted, practically-unreachable limits as whop:
// concurrent same-source posts could both pass the check-then-act gate, and a
// post-succeeds-then-record-throws window leaves a source unrecorded — both
// unreachable under single-threaded per-agent dispatch + local WAL sqlite.
// No --source = legacy raw post (callers that dedup at the dispatch-task layer
// are unaffected). Table is lazily created in the shared db/arc.sqlite.
async function xPostLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS x_post_log (
       source TEXT PRIMARY KEY,
       tweet_id TEXT,
       posted_at TEXT NOT NULL
     )`,
  );
  return db;
}

// True if this source already posted (prints a skip line so the caller returns
// early without touching the budget or the API). A no-op when no --source given.
async function dedupSkip(source: string | undefined): Promise<boolean> {
  if (!source) return false;
  const db = await xPostLog();
  const prior = db.query("SELECT tweet_id FROM x_post_log WHERE source = ?").get(source) as
    | { tweet_id: string | null }
    | null;
  if (!prior) return false;
  console.log(`already posted: ${source} (tweet ${prior.tweet_id ?? "?"}) — skipping`);
  return true;
}

async function recordPost(source: string, tweetId: string | null): Promise<void> {
  const db = await xPostLog();
  db.query(
    "INSERT OR IGNORE INTO x_post_log (source, tweet_id, posted_at) VALUES (?, ?, ?)",
  ).run(source, tweetId, new Date().toISOString());
}
// ---- X reply log (AI-018/031: give-3x gap for X channel) -------------------
//
// When Arc replies to a mention, we log the original author's X id so
// refreshLeads (lead-source.ts) can increment arc_replies_to_them for that lead.
// The author id comes from the sensor task description via --x-lead-id.
// This closes the give-3x observability gap: X leads now accrue value_touches
// from outbound replies (each reply = one give), enabling the enforcement gate
// to unblock auto-assist once ≥3 gives are on record.
async function xReplyLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS x_reply_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       replied_to_tweet_id TEXT NOT NULL,
       reply_tweet_id TEXT,
       x_lead_author_id TEXT,
       replied_at TEXT NOT NULL
     )`,
  );
  return db;
}

/**
 * Record an outbound X reply so lead-source.ts can fold it into arc_replies_to_them.
 * xLeadAuthorId = the X author_id of the tweet Arc replied to (from --x-lead-id flag).
 * No-op when xLeadAuthorId is absent (legacy callers without the flag are unaffected).
 */
async function recordXReply(
  repliedToTweetId: string,
  replyTweetId: string | null,
  xLeadAuthorId: string | undefined,
): Promise<void> {
  if (!xLeadAuthorId) return;
  const db = await xReplyLog();
  db.query(
    "INSERT INTO x_reply_log (replied_to_tweet_id, reply_tweet_id, x_lead_author_id, replied_at) VALUES (?, ?, ?, ?)",
  ).run(repliedToTweetId, replyTweetId, xLeadAuthorId, new Date().toISOString());
}

// ---- Cache ----

interface CacheEntry {
  id: string;
  type: "tweet" | "user";
  fetched_at: string;
  data: Record<string, unknown>;
}

interface Cache {
  tweets: Record<string, CacheEntry>;
  users: Record<string, CacheEntry>;
}

async function loadCache(): Promise<Cache> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (await file.exists()) {
      return (await file.json()) as Cache;
    }
  } catch {
    // corrupt cache, start fresh
  }
  return { tweets: {}, users: {} };
}

async function saveCache(cache: Cache): Promise<void> {
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ---- Daily Budget ----

interface DailyBudget {
  date: string; // YYYY-MM-DD
  posts: number;
  replies: number;
  likes: number;
  retweets: number;
  follows: number;
}

const BUDGET_LIMITS: Record<string, number> = {
  // GTM cadence dial-down (2026-06-15): hard daily X-post ceiling lowered 10 → 3 so the
  // account reads as lean/high-signal (~1-2 substantive items/day), reserving posts for
  // content-calendar proof-of-work threads (the proactive snippet-drip cadence is paused via
  // X_CADENCE_ENABLED=false in .env). Revert: restore `posts: 10` (or the .bak-gtm copy).
  posts: 3,
  replies: 40,
  likes: 50,
  retweets: 15,
  follows: 20,
};

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadBudget(): Promise<DailyBudget> {
  const today = todayDateStr();
  try {
    const file = Bun.file(BUDGET_PATH);
    if (await file.exists()) {
      const data = (await file.json()) as DailyBudget;
      if (data.date === today) return data;
      // AI-005: Day rolled over — archive yesterday's budget to the history file before resetting.
      // x-budget-history.json is a JSON array, capped at 30 entries (trailing ~1 month).
      try {
        const histFile = Bun.file(BUDGET_HISTORY_PATH);
        const existing = histFile.size > 0 ? ((await histFile.json()) as DailyBudget[]) : [];
        const trimmed = Array.isArray(existing) ? existing.slice(-29) : []; // keep last 29 + new = 30
        trimmed.push(data);
        await Bun.write(BUDGET_HISTORY_PATH, JSON.stringify(trimmed, null, 2));
      } catch {
        // History write is best-effort — never block the budget reset
      }
    }
  } catch {
    // corrupt file, start fresh
  }
  return { date: today, posts: 0, replies: 0, likes: 0, retweets: 0, follows: 0 };
}

async function saveBudget(budget: DailyBudget): Promise<void> {
  await Bun.write(BUDGET_PATH, JSON.stringify(budget, null, 2));
}

async function checkBudget(action: string): Promise<void> {
  const budget = await loadBudget();
  const limit = BUDGET_LIMITS[action];
  if (limit === undefined) return;
  const used = budget[action as keyof DailyBudget] as number;
  if (used >= limit) {
    throw new Error(
      `Daily ${action} budget exhausted: ${used}/${limit}. Resets at midnight UTC.`
    );
  }
}

async function incrementBudget(action: string): Promise<DailyBudget> {
  const budget = await loadBudget();
  const key = action as keyof DailyBudget;
  if (typeof budget[key] === "number") {
    (budget as unknown as Record<string, unknown>)[action] = (budget[key] as number) + 1;
  }
  await saveBudget(budget);
  return budget;
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [x-posting/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

// ---- OAuth 1.0a Signing ----

function percentEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    nonce += chars[byte % chars.length];
  }
  return nonce;
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

interface OAuthCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

async function loadCreds(): Promise<OAuthCreds> {
  const apiKey = await getCredential("x", "consumer_key");
  const apiSecret = await getCredential("x", "consumer_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    const missing: string[] = [];
    if (!apiKey) missing.push("x/consumer_key");
    if (!apiSecret) missing.push("x/consumer_secret");
    if (!accessToken) missing.push("x/access_token");
    if (!accessTokenSecret) missing.push("x/access_token_secret");
    throw new Error(
      `Missing X credentials: ${missing.join(", ")}. ` +
        `Set them with: arc creds set --service x --key <key> --value <value>`
    );
  }

  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

async function buildOAuthHeader(
  method: string,
  url: string,
  creds: OAuthCreds,
  params: Record<string, string> = {}
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and query params for signature base
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ---- API Calls ----

async function apiRequest(
  method: string,
  endpoint: string,
  creds: OAuthCreds,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string>
): Promise<Record<string, unknown>> {
  const baseUrl = `${API_BASE}${endpoint}`;
  const url = queryParams
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const authHeader = await buildOAuthHeader(method, baseUrl, creds, queryParams ?? {});

  const options: RequestInit = {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 204) {
    return { deleted: true };
  }

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 402) {
      await setCreditsDepleted(`402 CreditsDepleted from ${endpoint}`);
      throw new Error(
        `X API 402 CreditsDepleted: posting credits exhausted. ` +
          `Flag written to db/x-credits-depleted.json — future post/reply calls will skip for 30 days.`
      );
    }
    const apiErr = new Error(`X API error ${response.status}: ${JSON.stringify(data)}`) as Error & {
      status?: number;
      body?: unknown;
    };
    apiErr.status = response.status;
    apiErr.body = data;
    throw apiErr;
  }

  return data as Record<string, unknown>;
}

// ---- Low-level reply provider primitive (single send code path) ------------
//
// This is the ONLY function that issues POST /tweets for a reply. It does NO
// dedup, NO budget mutation, and NO x_post_log write — those concerns belong to
// the unified social-engine reply sender (skills/social-engine/reply-send.ts),
// which is the SOLE caller path that decides whether a reply may be sent
// (canonical source_key UNIQUE dedup + outbound_enabled kill switch + budget_ledger).
//
// Returns the raw provider result on success. On a non-2xx the underlying
// apiRequest throws an Error carrying { status, body } so the caller can
// classify a reply-restriction 403 (skip) vs a true auth/scope 401/403 and
// persist the RAW provider JSON. Do NOT add a direct caller that skips the
// unified sender — that would re-open the duplicate-reply bypass.
export interface ProviderReplyResult {
  postId: string | null;
  raw: Record<string, unknown>;
}

export async function providerReplySend(
  text: string,
  tweetId: string,
): Promise<ProviderReplyResult> {
  if (text.length > 280) {
    throw new Error(`Reply too long: ${text.length}/280 characters`);
  }
  // Honor the X-API-credits-depleted gate (402 backpressure) before any send.
  await checkCreditsDepleted();
  const creds = await loadCreds();
  const body = { text, reply: { in_reply_to_tweet_id: tweetId } };
  const result = await apiRequest("POST", "/tweets", creds, body);
  const data = result["data"] as Record<string, string> | undefined;
  return { postId: data?.["id"] ?? null, raw: result };
}

// ---- Commands ----

async function cmdPost(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  if (!text) {
    console.log("Usage: post --text <tweet text>");
    process.exit(1);
  }
  if (text.length > 280) {
    console.log(`Tweet too long: ${text.length}/280 characters`);
    process.exit(1);
  }

  // Local ledger short-circuit BEFORE credits/budget/API — the operative
  // exactly-once guarantee for sequential re-runs (see xPostLog note).
  if (await dedupSkip(flags["source"])) return;
  await checkCreditsDepleted();

  // M0-P0a: thread continuations (--reply-to set) are NOT root tweets and must NOT
  // burn the 3/day root budget. Only root posts count against the daily cap.
  // Admission.ts already enforces this split; this mirrors it in the legacy cli path.
  const isContinuation = !!flags["reply-to"];

  if (!isContinuation) {
    // Root post — check + reserve the 3/day budget.
    // budget_exhausted → exit 2 (deferred, not failed): dispatch must NOT mark
    // status=failed on a budget-over condition; exit 2 signals deferrable.
    try {
      await checkBudget("posts");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("budget exhausted")) {
        log(`root post budget exhausted — exiting 2 (deferred, not failed): ${msg}`);
        console.log(JSON.stringify({ deferred: true, reason: "root_post_budget_exhausted", detail: msg }));
        process.exit(2);
      }
      throw e;
    }
  }

  const creds = await loadCreds();
  const body: Record<string, unknown> = { text };

  // Support reply / thread continuation
  if (flags["reply-to"]) {
    body["reply"] = { in_reply_to_tweet_id: flags["reply-to"] };
  }

  log(`Posting tweet (${text.length} chars, ${isContinuation ? "continuation" : "root"})...`);
  const result = await apiRequest("POST", "/tweets", creds, body);
  const data = result["data"] as Record<string, string> | undefined;
  if (data) {
    // Only root posts burn the 3/day budget counter.
    if (!isContinuation) await incrementBudget("posts");
    if (flags["source"]) await recordPost(flags["source"], data["id"]);
    console.log(JSON.stringify({ id: data["id"], text: data["text"] }, null, 2));
    log(`Tweet posted: ${data["id"]}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// RETIRED direct-send reply path (2026-06-20 reply-lane consolidation).
//
// The legacy `reply` command used to call POST /tweets directly with ONLY a
// --source-string dedup (no thread dedup, ignored outbound_enabled, no per-thread
// cap) — that bypass is the root cause of the duplicate-reply incident.
//
// It now DELEGATES to the single unified reply sender in social-engine, which is
// the ONLY path allowed to send a reply: canonical source_key UNIQUE dedup
// (≤1 reply/thread/day), outbound_enabled kill switch (checked before admission
// AND before the provider call), in-txn budget_ledger debit, and reply-restriction
// 403 → skip with raw provider JSON persisted. No un-deduped send code path remains.
async function cmdReply(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  const tweetId = flags["tweet-id"];
  if (!text || !tweetId) {
    console.log("Usage: reply --text <reply text> --tweet-id <id> [--x-lead-id <author_id>]");
    process.exit(1);
  }

  log(`reply delegating to unified social-engine reply sender (thread ${tweetId})...`);
  const { sendReply } = await import("../social-engine/reply-send.ts");
  const replyResult = await sendReply({
    threadRef: tweetId,
    text,
    xLeadId: flags["x-lead-id"],
    accountHandle: flags["account"],
  });
  console.log(JSON.stringify(replyResult, null, 2));
  if (replyResult.outcome === "sent" || replyResult.outcome === "already_exists") {
    process.exit(0);
  }
  // skipped / blocked outcomes are non-error terminal states (no slot burn beyond
  // what the unified sender records); exit non-zero so the dispatch task surfaces it.
  process.exit(replyResult.outcome === "skipped" || replyResult.outcome === "blocked" ? 3 : 1);
}

async function cmdDelete(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: delete --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  log(`Deleting tweet ${tweetId}...`);
  const result = await apiRequest("DELETE", `/tweets/${tweetId}`, creds);
  console.log(JSON.stringify(result, null, 2));
  log(`Tweet deleted: ${tweetId}`);
}

async function cmdTimeline(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // First get our user ID
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id,username,name,public_metrics",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`User ID: ${userId}, fetching timeline...`);

  const timeline = await apiRequest("GET", `/users/${userId}/tweets`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,public_metrics,conversation_id",
  });

  const tweets = timeline["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent tweets found.");
    return;
  }

  for (const tweet of tweets) {
    const metrics = tweet["public_metrics"] as Record<string, number> | undefined;
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`Text: ${tweet["text"]}`);
    if (metrics) {
      console.log(
        `Engagement: ${metrics["like_count"]} likes, ${metrics["retweet_count"]} RTs, ${metrics["reply_count"]} replies`
      );
    }
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} tweets.`);
}

async function cmdMentions(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // Get user ID first
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`Fetching mentions for user ${userId}...`);

  const mentions = await apiRequest("GET", `/users/${userId}/mentions`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,author_id,public_metrics",
  });

  const tweets = mentions["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent mentions found.");
    return;
  }

  for (const tweet of tweets) {
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`From: ${tweet["author_id"]}`);
    console.log(`Text: ${tweet["text"]}`);
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} mentions.`);
}

async function cmdStatus(_flags: Record<string, string>): Promise<void> {
  try {
    const creds = await loadCreds();
    log("Checking X API access...");
    const me = await apiRequest("GET", "/users/me", creds, undefined, {
      "user.fields": "id,username,name,public_metrics,created_at,description",
    });
    const userData = me["data"] as Record<string, unknown> | undefined;
    if (userData) {
      const metrics = userData["public_metrics"] as Record<string, number> | undefined;
      console.log(JSON.stringify({
        status: "connected",
        id: userData["id"],
        username: userData["username"],
        name: userData["name"],
        description: userData["description"],
        created_at: userData["created_at"],
        followers: metrics?.["followers_count"],
        following: metrics?.["following_count"],
        tweets: metrics?.["tweet_count"],
      }, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ status: "error", message }, null, 2));
  }
}

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const query = flags["query"];
  if (!query) {
    console.log("Usage: search --query <text> [--limit <n>]");
    process.exit(1);
  }

  const limit = flags["limit"] ?? "10";
  const maxResults = Math.min(Math.max(parseInt(limit, 10) || 10, 10), 100);

  const creds = await loadCreds();
  log(`Searching tweets: "${query}" (limit: ${maxResults})...`);

  const result = await apiRequest("GET", "/tweets/search/recent", creds, undefined, {
    query,
    max_results: maxResults.toString(),
    "tweet.fields": "created_at,author_id,public_metrics,conversation_id",
  });

  const tweets = result["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No tweets found.");
    return;
  }

  // Cache results
  const cache = await loadCache();
  const now = new Date().toISOString();
  let newCount = 0;
  for (const tweet of tweets) {
    const id = tweet["id"] as string;
    if (!cache.tweets[id]) {
      newCount++;
    }
    cache.tweets[id] = { id, type: "tweet", fetched_at: now, data: tweet };
  }
  await saveCache(cache);

  for (const tweet of tweets) {
    const metrics = tweet["public_metrics"] as Record<string, number> | undefined;
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`Author: ${tweet["author_id"]}`);
    console.log(`Text: ${tweet["text"]}`);
    if (metrics) {
      console.log(
        `Engagement: ${metrics["like_count"]} likes, ${metrics["retweet_count"]} RTs, ${metrics["reply_count"]} replies`
      );
    }
  }
  console.log(`---`);
  console.log(`Found ${tweets.length} tweets (${newCount} new, cached to db/x-cache.json).`);
}

async function cmdLookup(flags: Record<string, string>): Promise<void> {
  const username = flags["username"];
  if (!username) {
    console.log("Usage: lookup --username <handle>");
    process.exit(1);
  }

  // Strip leading @ if present
  const handle = username.replace(/^@/, "");

  const creds = await loadCreds();
  log(`Looking up user: @${handle}...`);

  const result = await apiRequest("GET", `/users/by/username/${handle}`, creds, undefined, {
    "user.fields": "id,username,name,description,public_metrics,created_at,location,url,verified",
  });

  const userData = result["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    console.log(`User @${handle} not found.`);
    return;
  }

  // Cache user
  const cache = await loadCache();
  const now = new Date().toISOString();
  const id = userData["id"] as string;
  cache.users[id] = { id, type: "user", fetched_at: now, data: userData };
  await saveCache(cache);

  const metrics = userData["public_metrics"] as Record<string, number> | undefined;
  console.log(JSON.stringify({
    id: userData["id"],
    username: userData["username"],
    name: userData["name"],
    description: userData["description"],
    location: userData["location"],
    url: userData["url"],
    created_at: userData["created_at"],
    verified: userData["verified"],
    followers: metrics?.["followers_count"],
    following: metrics?.["following_count"],
    tweets: metrics?.["tweet_count"],
    cached_at: now,
  }, null, 2));
}

async function getMyUserId(creds: OAuthCreds): Promise<string> {
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) throw new Error("Could not fetch user info");
  return userData["id"] as string;
}

async function cmdLike(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: like --tweet-id <id>");
    process.exit(1);
  }

  await checkBudget("likes");
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Liking tweet ${tweetId}...`);
  const result = await apiRequest("POST", `/users/${userId}/likes`, creds, { tweet_id: tweetId });
  await incrementBudget("likes");
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ liked: data?.["liked"] ?? true, tweet_id: tweetId }, null, 2));
  log(`Tweet liked: ${tweetId}`);
}

async function cmdUnlike(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: unlike --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Unliking tweet ${tweetId}...`);
  const result = await apiRequest("DELETE", `/users/${userId}/likes/${tweetId}`, creds);
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ liked: data?.["liked"] ?? false, tweet_id: tweetId }, null, 2));
  log(`Tweet unliked: ${tweetId}`);
}

async function cmdRetweet(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: retweet --tweet-id <id>");
    process.exit(1);
  }

  await checkBudget("retweets");
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Retweeting ${tweetId}...`);
  const result = await apiRequest("POST", `/users/${userId}/retweets`, creds, { tweet_id: tweetId });
  await incrementBudget("retweets");
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ retweeted: data?.["retweeted"] ?? true, tweet_id: tweetId }, null, 2));
  log(`Retweeted: ${tweetId}`);
}

async function cmdUnretweet(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: unretweet --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Unretweeting ${tweetId}...`);
  const result = await apiRequest("DELETE", `/users/${userId}/retweets/${tweetId}`, creds);
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ retweeted: data?.["retweeted"] ?? false, tweet_id: tweetId }, null, 2));
  log(`Unretweeted: ${tweetId}`);
}

// ---- Follow (audience exposure + reply-permission) ----
// Mirrors cmdRetweet/cmdLike exactly: same apiRequest signed-POST path, same daily
// budget plumbing (the "follows" limit already existed in BUDGET_LIMITS). Reuses the
// proven OAuth 1.0a helper — no auth duplication. Accept either --username (resolves
// via /users/by/username) or --target-id (caller pre-resolved the id to save a read).
// Output is single-line JSON so a batch orchestrator can parse ok/already/error.
async function cmdFollow(flags: Record<string, string>): Promise<void> {
  const rawHandle = (flags["username"] ?? "").replace(/^@/, "");
  let targetId = flags["target-id"] ?? "";
  if (!targetId && !rawHandle) {
    console.log("Usage: follow (--username <handle> | --target-id <id>)");
    process.exit(1);
  }

  await checkBudget("follows");
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  if (!targetId) {
    const lk = await apiRequest("GET", `/users/by/username/${rawHandle}`, creds, undefined, { "user.fields": "id" });
    const u = lk["data"] as Record<string, unknown> | undefined;
    if (!u || !u["id"]) {
      console.log(JSON.stringify({ ok: false, error: "user_not_found", username: rawHandle }));
      process.exit(2);
    }
    targetId = String(u["id"]);
  }

  log(`Following ${rawHandle || targetId} (id=${targetId})...`);
  try {
    const result = await apiRequest("POST", `/users/${userId}/following`, creds, { target_user_id: targetId });
    await incrementBudget("follows");
    const data = (result["data"] as Record<string, unknown> | undefined) ?? {};
    const following = data["following"] === true;
    const pendingFollow = data["pending_follow"] === true;
    console.log(JSON.stringify({ ok: true, following, pending_follow: pendingFollow, target_id: targetId, username: rawHandle || null }));
  } catch (err) {
    const e = err as Error & { status?: number; body?: unknown };
    // Re-following an account you already follow returns 200 with following:true on X,
    // so a thrown error here is a real failure (429/restriction/etc). Surface status so
    // the orchestrator can back off on 429.
    console.log(JSON.stringify({ ok: false, status: e.status ?? null, error: e.message, target_id: targetId, username: rawHandle || null }));
    process.exit(3);
  }
}

async function cmdBudget(_flags: Record<string, string>): Promise<void> {
  const budget = await loadBudget();
  console.log(JSON.stringify({
    date: budget.date,
    posts: { used: budget.posts, limit: BUDGET_LIMITS["posts"], remaining: BUDGET_LIMITS["posts"] - budget.posts },
    replies: { used: budget.replies, limit: BUDGET_LIMITS["replies"], remaining: BUDGET_LIMITS["replies"] - budget.replies },
    likes: { used: budget.likes, limit: BUDGET_LIMITS["likes"], remaining: BUDGET_LIMITS["likes"] - budget.likes },
    retweets: { used: budget.retweets, limit: BUDGET_LIMITS["retweets"], remaining: BUDGET_LIMITS["retweets"] - budget.retweets },
    follows: { used: budget.follows, limit: BUDGET_LIMITS["follows"], remaining: BUDGET_LIMITS["follows"] - budget.follows },
  }, null, 2));
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "post":
      await cmdPost(flags);
      break;
    case "reply":
      await cmdReply(flags);
      break;
    case "delete":
      await cmdDelete(flags);
      break;
    case "timeline":
      await cmdTimeline(flags);
      break;
    case "mentions":
      await cmdMentions(flags);
      break;
    case "search":
      await cmdSearch(flags);
      break;
    case "lookup":
      await cmdLookup(flags);
      break;
    case "like":
      await cmdLike(flags);
      break;
    case "unlike":
      await cmdUnlike(flags);
      break;
    case "retweet":
      await cmdRetweet(flags);
      break;
    case "unretweet":
      await cmdUnretweet(flags);
      break;
    case "follow":
      await cmdFollow(flags);
      break;
    case "budget":
      await cmdBudget(flags);
      break;
    case "status":
      await cmdStatus(flags);
      break;
    default:
      console.log(`x-posting — Post and manage tweets via X API v2

Commands:
  post       --text <text> [--source <key>]    Post a tweet (max 280 chars)
                                               (--source: a re-run with the same key is suppressed
                                                by the local x_post_log ledger — no double-post)
  reply      --text <text> --tweet-id <id> [--source <key>] [--x-lead-id <author_id>]
             Reply to a tweet. --source: idempotent re-run. --x-lead-id: log as give-3x value_touch for this X lead.
  delete     --tweet-id <id>                   Delete a tweet
  like       --tweet-id <id>                   Like a tweet
  unlike     --tweet-id <id>                   Unlike a tweet
  retweet    --tweet-id <id>                   Retweet a tweet
  unretweet  --tweet-id <id>                   Undo a retweet
  follow     --username <handle>|--target-id <id>  Follow an account (audience exposure)
  timeline   [--limit <n>]                     Show recent tweets (default: 10)
  mentions   [--limit <n>]                     Show recent mentions (default: 10)
  search     --query <text> [--limit <n>]      Search recent tweets (10-100, default: 10)
  lookup     --username <handle>               Look up a user by username
  budget                                       Show daily action budget usage
  status                                       Check API access and account info

Daily budget limits (resets at midnight UTC):
  10 posts, 40 replies, 50 likes, 15 retweets, 20 follows

Credentials required (set via arc creds set --service x --key <key> --value <value>):
  x/consumer_key         OAuth 1.0a Consumer Key
  x/consumer_secret      OAuth 1.0a Consumer Secret
  x/access_token         User Access Token
  x/access_token_secret  User Access Token Secret

Get credentials from https://developer.x.com/`);
      break;
  }
}

// Only auto-run the CLI when this file is the entrypoint. When imported as a
// module (e.g. social-engine/reply-send.ts importing providerReplySend) the
// top-level main() must NOT execute. import.meta.main is true only for the
// process entry module under Bun.
if (import.meta.main) {
  main().catch((error) => {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
