#!/usr/bin/env bun

// skills/social-x-posting/lib/x-api.ts
//
// Minimal READ-ONLY X (Twitter) API v2 client — OAuth 1.0a signed GET requests.
//
// Why this exists: the acquisition lane's lead source (skills/whop-sales) needs to
// READ @arc0btc mentions/replies to surface non-member engagers as X leads, and X
// API auth belongs to the X skill — not whop-sales. This lib is the X skill's
// reusable read surface (cross-skill import mirrors how whop-sales already imports
// skills/whop/lib).
//
// The proven POSTING path still lives in cli.ts with its own (currently duplicated)
// OAuth helpers — we deliberately did NOT refactor it here so the working posting
// lane stays untouched (zero regression risk). Collapsing cli.ts's private OAuth
// onto this lib is a tracked follow-up (P11). The signing logic below is copied
// verbatim from cli.ts (HMAC-SHA1 OAuth 1.0a), READ-only: no budget, no
// credits-depleted side-effects, GET requests only.
//
// READ BUDGET GUARD (AI-016): fetchArcMentions is guarded by a daily read cap
// (X_MAX_READS_PER_DAY, default 50) persisted in db/x-read-budget.json. On 429,
// a backoff_until timestamp is written (15 min) and subsequent calls fast-fail
// until the window clears. This prevents runaway consumption on the free tier
// (500k reads/month free; 50/day = ~1.5k/month = well under cap).

import { getCredential } from "../../../src/credentials.ts";
import { join } from "path";

const API_BASE = "https://api.x.com/2";

// ---- Read budget (AI-016) ---------------------------------------------------

const READ_BUDGET_PATH = join(import.meta.dir, "../../../db/x-read-budget.json");

/** Daily cap for X API read calls from this lib (GET /mentions, /users/me). */
export const X_MAX_READS_PER_DAY = 50;

interface XReadBudget {
  date: string;        // YYYY-MM-DD UTC
  reads: number;
  backoff_until?: string; // ISO8601 — set on 429, cleared when expired
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadReadBudget(): Promise<XReadBudget> {
  const today = todayUTC();
  try {
    const file = Bun.file(READ_BUDGET_PATH);
    if (await file.exists()) {
      const data = (await file.json()) as XReadBudget;
      if (data.date === today) return data;
    }
  } catch {
    // corrupt or missing — start fresh
  }
  return { date: today, reads: 0 };
}

async function saveReadBudget(budget: XReadBudget): Promise<void> {
  const tmp = READ_BUDGET_PATH + ".tmp";
  await Bun.write(tmp, JSON.stringify(budget, null, 2) + "\n");
  // Rename for atomic write (same-filesystem)
  const { renameSync } = await import("node:fs");
  renameSync(tmp, READ_BUDGET_PATH);
}

/**
 * Throws if we are over the daily read budget or inside a 429 backoff window.
 * Call BEFORE any GET to the X API from this lib.
 */
export async function checkReadBudget(): Promise<void> {
  const budget = await loadReadBudget();
  if (budget.backoff_until && new Date() < new Date(budget.backoff_until)) {
    throw new Error(
      `X read API: 429 backoff active until ${budget.backoff_until} — skipping read`,
    );
  }
  if (budget.reads >= X_MAX_READS_PER_DAY) {
    throw new Error(
      `X read budget exhausted: ${budget.reads}/${X_MAX_READS_PER_DAY} reads today. Resets at midnight UTC.`,
    );
  }
}

/** Increment the read counter after a successful GET. */
export async function incrementReadBudget(): Promise<void> {
  const budget = await loadReadBudget();
  budget.reads += 1;
  await saveReadBudget(budget);
}

/** Write a 429 backoff (15 min) to the budget file. */
export async function setReadBackoff(): Promise<void> {
  const budget = await loadReadBudget();
  budget.backoff_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await saveReadBudget(budget);
}

// ---- Credentials ------------------------------------------------------------

// Arc's own X user id (@arc0btc) — a constant. Callers pass this to fetchArcMentions
// so it can SKIP the /users/me round-trip (mentions is user-scoped). That halves X
// read consumption per fetch, which matters on the low free-tier read caps (forge
// #3). /users/me remains the fallback when no id is supplied.
export const ARC_X_USER_ID = "1952849545785909248";

export interface XCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/** Load X OAuth 1.0a creds. Returns null (not throw) when any are missing so the
 * lead refresh can degrade to a benign skip — mirrors the forum path's no-key. */
export async function loadXCreds(): Promise<XCreds | null> {
  const apiKey = await getCredential("x", "consumer_key");
  const apiSecret = await getCredential("x", "consumer_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

// ---- OAuth 1.0a signing (copied from cli.ts — proven; see header note) -------

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
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildOAuthHeader(
  method: string,
  url: string,
  creds: XCreds,
  params: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

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

/** A signed, read-only GET against the X API v2. Throws on non-2xx.
 * Budget-aware: checks read budget before the call, increments after success,
 * and writes a 429 backoff on rate-limit responses (AI-016). */
export async function xApiGet(
  endpoint: string,
  creds: XCreds,
  queryParams: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  // Guard: enforce daily read budget and 429 backoff before touching the network.
  await checkReadBudget();

  const baseUrl = `${API_BASE}${endpoint}`;
  // Build the query string with the SAME percentEncode used to compute the OAuth
  // signature base — URLSearchParams encodes a space as "+" while the signature uses
  // "%20", so any param with a space (or !*'()) would otherwise mismatch and 401
  // (cairn #2). Sorting matches the signature-base ordering too.
  const qs = Object.keys(queryParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(queryParams[k])}`)
    .join("&");
  const url = qs ? `${baseUrl}?${qs}` : baseUrl;
  const authHeader = await buildOAuthHeader("GET", baseUrl, creds, queryParams);
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: authHeader },
  });
  const data = await response.json();

  if (response.status === 429) {
    // Rate limit hit — write a 15-min backoff then throw.
    await setReadBackoff();
    throw new Error(`X API GET ${endpoint} 429: rate limited — backoff written (15 min)`);
  }

  if (!response.ok) {
    throw new Error(`X API GET ${endpoint} ${response.status}: ${JSON.stringify(data)}`);
  }

  // Success — consume one read unit.
  await incrementReadBudget();

  return data as Record<string, unknown>;
}

// ---- Mentions ---------------------------------------------------------------

export interface XMention {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author_username?: string;
  author_name?: string;
  /** Present when the tweet is a reply; whom it replied to (used to detect
   * replies to Arc → the warm Class-A signal). */
  in_reply_to_user_id?: string;
  /** The replied-to tweet id (parent), when this is a reply. */
  replied_to_tweet_id?: string;
}

export interface XMentionsResult {
  arc_user_id: string;
  arc_username: string | null;
  mentions: XMention[];
  newest_id?: string;
}

/**
 * Fetch recent @arc0btc mentions (replies + standalone mentions). Resolves Arc's
 * own X user id via /users/me first (mentions is a user-scoped endpoint), then
 * pulls the mentions timeline WITH author-username expansion and reply metadata so
 * the caller can (a) attribute each mention to a handle and (b) tell a reply-to-Arc
 * (warm) from a bare mention. SCALING CEILING (like the forum fetch): one page of
 * `maxResults` — older mentions are not paged; logs when it touches the ceiling.
 *
 * PAGINATION (AI-019): pass `sinceId` to fetch only mentions newer than the last
 * seen id. The returned `newest_id` from the API meta is surfaced in the result
 * so the caller can persist it for the next fetch.
 */
export async function fetchArcMentions(opts: {
  creds: XCreds;
  /** Arc's X user id. Pass ARC_X_USER_ID to skip the /users/me round-trip (saves a
   * read); omit to resolve it live via /users/me. */
  arcUserId?: string;
  maxResults?: number;
  /** Only fetch mentions newer than this tweet id (since_id cursor for pagination). */
  sinceId?: string;
  log?: (m: string) => void;
}): Promise<XMentionsResult> {
  const log = opts.log ?? (() => {});
  let arcUserId = opts.arcUserId ?? "";
  let arcUsername: string | null = null;
  if (!arcUserId) {
    const me = await xApiGet("/users/me", opts.creds, { "user.fields": "id,username" });
    const meData = (me["data"] ?? {}) as Record<string, unknown>;
    arcUserId = meData["id"] ? String(meData["id"]) : "";
    arcUsername = (meData["username"] as string | undefined) ?? null;
  }
  if (!arcUserId) throw new Error("could not resolve Arc X user id (/users/me returned no id)");

  const max = Math.min(Math.max(opts.maxResults ?? 25, 5), 100);
  const queryParams: Record<string, string> = {
    max_results: String(max),
    "tweet.fields": "created_at,author_id,in_reply_to_user_id,referenced_tweets,conversation_id",
    expansions: "author_id",
    "user.fields": "username,name",
  };
  if (opts.sinceId) {
    queryParams["since_id"] = opts.sinceId;
  }

  const resp = await xApiGet(`/users/${arcUserId}/mentions`, opts.creds, queryParams);

  const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  const includes = (resp["includes"] as Record<string, unknown> | undefined) ?? {};
  const users = (includes["users"] as Array<Record<string, unknown>> | undefined) ?? [];
  const meta = (resp["meta"] as Record<string, unknown> | undefined) ?? {};
  const newestId = meta["newest_id"] ? String(meta["newest_id"]) : undefined;
  const userMap = new Map<string, { username?: string; name?: string }>();
  for (const u of users) {
    userMap.set(String(u["id"]), {
      username: u["username"] as string | undefined,
      name: u["name"] as string | undefined,
    });
  }
  if (data.length >= max) {
    log(`x mentions: hit page ceiling (${data.length} >= ${max}) — older mentions not paged`);
  }

  const mentions: XMention[] = data.map((t) => {
    const refs = (t["referenced_tweets"] as Array<Record<string, unknown>> | undefined) ?? [];
    const repliedTo = refs.find((r) => r["type"] === "replied_to");
    const authorId = t["author_id"] ? String(t["author_id"]) : "";
    const u = userMap.get(authorId);
    return {
      id: String(t["id"]),
      text: String(t["text"] ?? ""),
      created_at: String(t["created_at"] ?? ""),
      author_id: authorId,
      author_username: u?.username,
      author_name: u?.name,
      in_reply_to_user_id: t["in_reply_to_user_id"] ? String(t["in_reply_to_user_id"]) : undefined,
      replied_to_tweet_id: repliedTo ? String(repliedTo["id"]) : undefined,
    };
  });

  return { arc_user_id: arcUserId, arc_username: arcUsername, mentions, newest_id: newestId };
}

// ---- Search recent tweets by handle (P2 arc-reach-unblock) -----------------

export interface RecentTweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  conversation_id: string;
}

export interface SearchRecentResult {
  tweets: RecentTweet[];
  newest_id?: string;
}

/**
 * Search recent tweets from a specific handle using "from:<handle>" query.
 * Budget-aware via checkReadBudget() / incrementReadBudget() (AI-016 guard).
 * Returns at most maxResults tweets (capped 5-100).
 *
 * Used by reply-watchlist-sensor.ts Phase 1 discovery to find recent tweets
 * from in-network watchlist accounts without shelling out to cli.ts.
 */
export async function searchRecentByHandle(
  handle: string,
  creds: XCreds,
  opts: { maxResults?: number; sinceId?: string } = {},
): Promise<SearchRecentResult> {
  const max = Math.min(Math.max(opts.maxResults ?? 10, 10), 100);
  const queryParams: Record<string, string> = {
    query: `from:${handle}`,
    max_results: String(max),
    "tweet.fields": "created_at,author_id,conversation_id",
  };
  if (opts.sinceId) queryParams["since_id"] = opts.sinceId;

  const resp = await xApiGet("/tweets/search/recent", creds, queryParams);
  const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  const meta = (resp["meta"] as Record<string, unknown> | undefined) ?? {};
  const tweets: RecentTweet[] = data.map((t) => ({
    id: String(t["id"]),
    text: String(t["text"] ?? ""),
    created_at: String(t["created_at"] ?? ""),
    author_id: String(t["author_id"] ?? ""),
    conversation_id: String(t["conversation_id"] ?? t["id"]),
  }));
  return { tweets, newest_id: meta["newest_id"] ? String(meta["newest_id"]) : undefined };
}

// ---- Follower metrics (P5 arc-reach-unblock) --------------------------------

export interface FollowerMetrics {
  followers_count: number;
  following_count: number;
  tweet_count: number;
}

/**
 * Fetch live follower metrics for the authenticated user via /users/:id or /users/me.
 * Pass arcUserId (ARC_X_USER_ID) to skip the /users/me round-trip — halves read cost.
 * Budget-aware (checkReadBudget via xApiGet). Throws on API failure —
 * callers implement graceful degradation.
 */
export async function fetchFollowerMetrics(
  creds: XCreds,
  arcUserId?: string,
): Promise<FollowerMetrics> {
  const endpoint = arcUserId ? `/users/${arcUserId}` : "/users/me";
  const resp = await xApiGet(endpoint, creds, {
    "user.fields": "public_metrics",
  });
  const data = (resp["data"] as Record<string, unknown> | undefined) ?? {};
  const metrics = (data["public_metrics"] as Record<string, number> | undefined) ?? {};
  return {
    followers_count: metrics["followers_count"] ?? 0,
    following_count: metrics["following_count"] ?? 0,
    tweet_count: metrics["tweet_count"] ?? 0,
  };
}

// ---- Per-touch post metrics (P5 arc-reach-unblock) -------------------------

export interface PostTouchMetrics {
  id: string;
  created_at: string | null;   // null when API omits the field (not empty string)
  like_count: number;
  retweet_count: number;
  reply_count: number;
  impression_proxy: number; // likes + RTs + replies (proxy for reach on Basic tier)
}

/**
 * Fetch public_metrics for up to 10 tweet IDs in a single GET /tweets?ids=... call.
 * Returns an empty array when tweetIds is empty (zero-post safe).
 * Budget-aware (checkReadBudget via xApiGet). Throws on API failure.
 * X API free/basic tier does NOT expose impression_count in public_metrics;
 * impression_proxy = like_count + retweet_count + reply_count.
 */
export async function fetchRecentPostMetrics(
  tweetIds: string[],
  creds: XCreds,
): Promise<PostTouchMetrics[]> {
  if (tweetIds.length === 0) return [];
  const ids = tweetIds.slice(0, 10).join(",");
  const resp = await xApiGet("/tweets", creds, {
    ids,
    "tweet.fields": "created_at,public_metrics",
  });
  const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  return data.map((t) => {
    const m = (t["public_metrics"] as Record<string, number> | undefined) ?? {};
    const like_count = m["like_count"] ?? 0;
    const retweet_count = m["retweet_count"] ?? 0;
    const reply_count = m["reply_count"] ?? 0;
    return {
      id: String(t["id"]),
      created_at: t["created_at"] ? String(t["created_at"]) : null,
      like_count,
      retweet_count,
      reply_count,
      impression_proxy: like_count + retweet_count + reply_count,
    };
  });
}

/** Check read budget, throwing if fewer than `minSlots` remain today.
 * Use instead of `checkReadBudget()` when a single run consumes multiple reads. */
export async function checkReadBudgetN(minSlots: number): Promise<void> {
  const budget = await loadReadBudget();
  if (budget.backoff_until && new Date() < new Date(budget.backoff_until)) {
    throw new Error(
      `X read API: 429 backoff active until ${budget.backoff_until} — skipping read`,
    );
  }
  const remaining = X_MAX_READS_PER_DAY - budget.reads;
  if (remaining < minSlots) {
    throw new Error(
      `X read budget low: ${budget.reads}/${X_MAX_READS_PER_DAY} reads today, need ${minSlots} slots. Resets at midnight UTC.`,
    );
  }
}

/** Return how many read slots remain today (0 = exhausted). */
export async function getRemainingReadSlots(): Promise<number> {
  const budget = await loadReadBudget();
  const today = new Date().toISOString().slice(0, 10);
  if (budget.date !== today) return X_MAX_READS_PER_DAY;
  if (budget.backoff_until && new Date() < new Date(budget.backoff_until)) return 0;
  return Math.max(0, X_MAX_READS_PER_DAY - budget.reads);
}
