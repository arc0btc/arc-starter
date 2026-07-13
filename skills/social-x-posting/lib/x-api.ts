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
// READ BUDGET GUARD (AI-016; pay-per-use dollar model 2026-07-06, task #21463):
// every read is metered — X discontinued tiered pricing 2026-02-06 and made
// pay-per-use the default (whoabuddy confirmed the account is on it, task #21462).
// Reads are guarded by a daily DOLLAR budget (X_READ_BUDGET_USD_PER_DAY, default
// $0.50) persisted in db/x-read-budget.json, replacing the old 100-reads COUNT
// ceiling. Non-owned reads (mentions, search) cost $0.005; owned reads (own posts,
// followers, lists — since 2026-04-20) cost $0.001. On 429 a backoff_until
// timestamp is written (15 min) and subsequent calls fast-fail until it clears.
// 402 = balance/prepaid credits exhausted; 429 = rate limit.
// Ground truth + math: research/2026-07-06_x-api-budget-ground-truth.md,
// memory entry x-api-pay-per-use-cost-model.
//
// PER-RESOURCE METERING FIX (2026-07-13, arc-x-research-channel Phase 1): X bills
// per resource RETURNED, not per request — a search page of 10 posts costs 10x a
// single lookup (2026-04-20 rate card). `xApiGet` now bills via `billResourceRead`,
// which extracts the actual resource ids from the response and bills
// `costUsd × count`, with same-UTC-day dedup so a repeat read of an already-billed
// id in the same lane is free. `incrementReadBudget` remains as a flat 1-unit
// back-compat wrapper for callers that haven't adopted per-resource billing (and
// is still CORRECT as-is for genuinely single-resource endpoints like
// `/tweets/{id}`, which only ever return 1 resource per call).
//
// PRICE/BILLING OVERRIDES + APP-ONLY AUTH (2026-07-13, Phase 3): the flat
// $0.005/$0.001 non-owned/owned split above is the DEFAULT, not the whole
// story anymore. `xApiGet`/`xApiGetAppOnly`'s `opts` can override the price
// (`costUsd`, for endpoints with a different or unconfirmed rate — e.g. News
// search), the billing SHAPE (`billMode: "flat"`, for endpoints X prices per
// REQUEST rather than per resource returned — e.g. Trends), and tag the
// ledger with `pricingStatus: "estimated"` when the price isn't on the public
// rate card. `xApiGetAppOnly` is a second entry point for endpoints that
// reject OAuth 1.0a User Context and require OAuth 2.0 App-Only instead
// (confirmed live: WOEID trends, News search) — see the dedicated comment
// block above `getAppOnlyBearerToken` further down this file.

import { getCredential } from "../../../src/credentials.ts";
import { join } from "path";

const API_BASE = "https://api.x.com/2";

// ---- Read budget (AI-016) ---------------------------------------------------

const READ_BUDGET_PATH = join(import.meta.dir, "../../../db/x-read-budget.json");

// ---- Follower cache (P2 arc-funnel-hardening) --------------------------------
// Cache follower metrics for up to 4h to avoid burning read budget on every gauge run.
// The control-plane monitor (arc-m0-north-star.ts) runs every 30min — without caching,
// the gauge would consume 2 reads every 30min = 96 reads/day just for follower data.
// With 4h TTL: at most 6 gauge reads/day for followers, saving ~90 reads/day.
const FOLLOWER_CACHE_PATH = join(import.meta.dir, "../../../db/hook-state/follower-cache.json");
const FOLLOWER_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface FollowerCacheEntry {
  date: string;          // YYYY-MM-DD UTC — invalidated at midnight
  cached_at: string;     // ISO8601 — TTL check
  followers_count: number;
  following_count: number;
  tweet_count: number;
  cached: true;          // Tag so callers can tell this is a cached value
}

async function loadFollowerCache(): Promise<FollowerCacheEntry | null> {
  try {
    const f = Bun.file(FOLLOWER_CACHE_PATH);
    if (!(await f.exists())) return null;
    const data = (await f.json()) as FollowerCacheEntry;
    // Must be today's date and within TTL
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return null;
    const age = Date.now() - new Date(data.cached_at).getTime();
    if (age > FOLLOWER_CACHE_TTL_MS) return null;
    return data;
  } catch {
    // Parse failure or missing = cache miss (never an error)
    return null;
  }
}

async function saveFollowerCache(metrics: { followers_count: number; following_count: number; tweet_count: number }): Promise<void> {
  const entry: FollowerCacheEntry = {
    date: new Date().toISOString().slice(0, 10),
    cached_at: new Date().toISOString(),
    followers_count: metrics.followers_count,
    following_count: metrics.following_count,
    tweet_count: metrics.tweet_count,
    cached: true,
  };
  const tmp = FOLLOWER_CACHE_PATH + ".tmp";
  await Bun.write(tmp, JSON.stringify(entry, null, 2) + "\n");
  const { renameSync } = await import("node:fs");
  renameSync(tmp, FOLLOWER_CACHE_PATH);
}

/** Per-read pay-per-use rates (2026 X API). Non-owned reads (mentions, search)
 * are $0.005; OWNED reads (own posts, followers, lists — the discount X shipped
 * 2026-04-20) are $0.001. */
export const READ_COST_USD = 0.005;
export const OWNED_READ_COST_USD = 0.001;

/** Daily DOLLAR ceiling for X API reads from this lib. Was $0.50 (the
 * dollar-equivalent of the old 100-reads/day count ceiling; steady-state
 * ~$0.38/day, mentions poll ~90% of it). Raised to $1.00 on 2026-07-12 when the
 * two previously UNMETERED read callers (social-x-ecosystem search ~$0.48/day +
 * arc-link-research lookups) were routed through this guard — the raise keeps
 * total permitted spend where it already effectively was, it does not authorize
 * new spend; per-lane split in x-read-budget.json `by_lane` is the audit trail.
 * Operator dial: lower it once the ecosystem cadence decision lands. */
export const X_READ_BUDGET_USD_PER_DAY = 1.0;

interface XReadBudget {
  date: string;        // YYYY-MM-DD UTC
  spend_usd: number;   // dollars spent on reads today — the control surface
  reads: number;       // read count today (observability only, not enforced)
  backoff_until?: string; // ISO8601 — set on 429, cleared when expired
  // Per-lane attribution (2026-07-12, operator spend audit): who spent what today.
  // Keys are endpoint families ("tweets/search/recent", "users/mentions", ...) or a
  // caller-supplied lane ("ecosystem-search", "link-research"). Observability only —
  // the enforced control surface stays the flat spend_usd above.
  // pricing_status (2026-07-13, Phase 3 arc-x-research-channel): written by
  // News/Trends-style lanes whose per-unit price isn't confirmed on the public
  // X rate card. "estimated" flags a conservative, clearly-documented guess
  // (never silently treated as confirmed); omitted/"confirmed" = today's
  // pre-existing lanes, all priced off the confirmed rate card. Phase 6's
  // budget-fit audit greps for this field to see what's still unverified
  // without re-deriving it from scratch.
  by_lane?: Record<string, { reads: number; spend_usd: number; pricing_status?: "confirmed" | "estimated" }>;
  // Per-resource 24h-UTC dedup ledger (2026-07-13, Phase 1 metering fix): resource
  // ids already BILLED today, keyed by lane. X bills per resource RETURNED, not per
  // request — a search page of 10 posts costs 10x a single lookup — and re-reading
  // an already-billed resource the same UTC day is free. Resets for free on the
  // existing date rollover (loadReadBudget returns a fresh budget once `date`
  // no longer matches today).
  billed_ids?: Record<string, string[]>;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadReadBudget(): Promise<XReadBudget> {
  const today = todayUTC();
  try {
    const file = Bun.file(READ_BUDGET_PATH);
    if (await file.exists()) {
      const data = (await file.json()) as Partial<XReadBudget>;
      if (data.date === today) {
        // Migration: a same-day file written by the old count-only schema has
        // `reads` but no `spend_usd` — estimate spend from the read count at the
        // non-owned rate so mid-day rollovers don't reset the budget to zero.
        return {
          date: today,
          spend_usd: data.spend_usd ?? (data.reads ?? 0) * READ_COST_USD,
          reads: data.reads ?? 0,
          backoff_until: data.backoff_until,
          by_lane: data.by_lane,
          billed_ids: data.billed_ids,
        };
      }
    }
  } catch {
    // corrupt or missing — start fresh
  }
  return { date: today, spend_usd: 0, reads: 0 };
}

async function saveReadBudget(budget: XReadBudget): Promise<void> {
  const tmp = READ_BUDGET_PATH + ".tmp";
  await Bun.write(tmp, JSON.stringify(budget, null, 2) + "\n");
  // Rename for atomic write (same-filesystem)
  const { renameSync } = await import("node:fs");
  renameSync(tmp, READ_BUDGET_PATH);
}

// KNOWN LIMITATION (dev-council, all 5 lenses independently raised this, 2026-07-13):
// loadReadBudget → mutate → saveReadBudget is a read-modify-write across MULTIPLE
// independently-scheduled processes (the 15-min ecosystem sensor, the 30-min
// north-star gauge, on-demand link-research, ad-hoc cli runs) sharing this ONE
// file, with no lock/CAS/version. The tmp-write-renameSync gives atomic file
// REPLACEMENT (no reader ever sees torn/corrupt JSON) but not mutual exclusion —
// two overlapping ticks can both load the same pre-mutation budget and both save,
// silently losing one increment (a lost update). This is PRE-EXISTING (identical
// shape before the 2026-07-13 per-resource metering fix) and NOT worsened by it.
// Accepted for now, but the materiality of "accepted" has moved (dev-council/
// Kleppmann lens, Phase 4, 2026-07-13 — CORRECTING this comment's prior "a few
// cents" characterization, which was accurate when every writer billed 1-15
// resources per call): list-roster's tweet-poll (Phase 4) can bill up to ~100
// resources in ONE `applyBill` (a single `/lists/{id}/tweets` page at
// max_results=100, ~$0.50) — a lost update on THAT call under-counts up to
// half the daily cap in one shot, not a few cents, and the failure direction
// is cap UNDER-enforcement on real money (an actually-spent read the ledger
// never learns about). Four independently-scheduled writers now share this
// file (ecosystem-search remnant, x-news-trends, candidate-maturation,
// list-roster). Still not fixed this phase (a full move to an atomic SQLite
// `UPDATE spend = spend + ?` row is its own change, out of Phase 4's budget) —
// but Phase 6's budget-fit audit should treat this as a real, not theoretical,
// gap given the batch sizes now in play. Revisit (file lock, or move the
// ledger to a SQLite row) before the daily cap or poll batch size grows further.

/**
 * Throws if the projected read spend would exceed the daily dollar budget, or if
 * a 429 backoff window is active. Call BEFORE any GET to the X API from this lib.
 * `costUsd` is the price of the read about to be made — READ_COST_USD (non-owned,
 * default) or OWNED_READ_COST_USD (own posts/followers/lists).
 */
export async function checkReadBudget(costUsd: number = READ_COST_USD): Promise<void> {
  const budget = await loadReadBudget();
  if (budget.backoff_until && new Date() < new Date(budget.backoff_until)) {
    throw new Error(
      `X read API: 429 backoff active until ${budget.backoff_until} — skipping read`,
    );
  }
  if (budget.spend_usd + costUsd > X_READ_BUDGET_USD_PER_DAY) {
    throw new Error(
      `X read budget exhausted: $${budget.spend_usd.toFixed(3)}/$${X_READ_BUDGET_USD_PER_DAY.toFixed(2)} spent today ` +
        `(${budget.reads} reads), next read costs $${costUsd.toFixed(3)}. Resets at midnight UTC.`,
    );
  }
}

/** Apply `count` billed units of `costUsd` each to the loaded budget (mutates + persists).
 * Shared tail end of both the per-resource and the flat-unit billing paths so the
 * dollar math (rounding, by_lane bookkeeping) lives in exactly one place.
 * `pricingStatus`, when passed, is written onto the lane's `by_lane` entry
 * (2026-07-13, Phase 3) — omit to leave whatever status (if any) the lane
 * already carries untouched, so a lane tagged "estimated" stays visibly flagged
 * until a future call explicitly passes "confirmed". */
async function applyBill(
  budget: XReadBudget,
  costUsd: number,
  lane: string,
  count: number,
  pricingStatus?: "confirmed" | "estimated",
): Promise<{ billedCount: number; spendUsd: number }> {
  if (count <= 0) return { billedCount: 0, spendUsd: 0 };
  const spendUsd = Math.round(costUsd * count * 1e6) / 1e6;
  // Round to micro-dollars so repeated float adds don't drift the persisted value.
  budget.spend_usd = Math.round((budget.spend_usd + spendUsd) * 1e6) / 1e6;
  budget.reads += count;
  const lanes = budget.by_lane ?? {};
  const entry = lanes[lane] ?? { reads: 0, spend_usd: 0 };
  entry.reads += count;
  entry.spend_usd = Math.round((entry.spend_usd + spendUsd) * 1e6) / 1e6;
  if (pricingStatus) entry.pricing_status = pricingStatus;
  lanes[lane] = entry;
  budget.by_lane = lanes;
  await saveReadBudget(budget);
  return { billedCount: count, spendUsd };
}

/**
 * Bill a completed read for the resources it ACTUALLY returned (2026-07-13 metering
 * fix — the load-bearing change of arc-x-research-channel Phase 1). X bills per
 * resource RETURNED, not per request: a `search/recent` page of 10 posts costs 10x
 * a single-tweet lookup, and a page of 0 posts costs $0 — the previous meter billed
 * a flat 1 unit per call regardless of N.
 *
 * Pass `resourceIds` = every resource id the response actually returned (tweet ids,
 * user ids, ...). A same-UTC-day re-read of an id already billed in this SAME lane
 * is free (X's 24h dedup + our own `since_id` discipline should make re-polls rare,
 * but retries/replays that re-fetch the same id must not re-bill it — this is the
 * "every re-research/retry/replay re-billed the whole batch" leak the 2026-07-11
 * spend audit named).
 *
 * Omit `resourceIds` (or pass undefined) for single/unknown-count reads whose
 * response shape doesn't expose an id list, OR for endpoints priced PER REQUEST
 * rather than per resource returned (2026-07-13, Phase 3: X's Trends endpoints
 * bill $0.010/request regardless of how many trend items come back — passing
 * `undefined` here, via `xApiGet`'s `billMode: "flat"`, is exactly how a
 * per-request-priced lane bills 1 unit instead of N) — bills exactly 1 unit, no
 * dedup tracking possible without an id to key on. This is also the back-compat
 * path for any caller still using `incrementReadBudget` directly.
 *
 * `pricingStatus`, when passed, tags the lane's `by_lane` entry (see
 * `XReadBudget.by_lane`'s doc comment) — pass `"estimated"` for lanes whose
 * per-unit price isn't confirmed on the public rate card (e.g. News search,
 * Phase 3) so the ledger itself carries the caveat, not just a log line.
 */
export async function billResourceRead(
  costUsd: number,
  lane: string,
  resourceIds?: string[],
  pricingStatus?: "confirmed" | "estimated",
): Promise<{ billedCount: number; spendUsd: number }> {
  const budget = await loadReadBudget();

  if (!resourceIds) {
    return applyBill(budget, costUsd, lane, 1, pricingStatus);
  }
  if (resourceIds.length === 0) {
    // Response returned zero resources — X charges for what it returns, so this is
    // a genuine $0 read (an empty search page, an empty batch lookup, ...). Nothing
    // was billed, so there's no lane entry to tag with pricingStatus either.
    return { billedCount: 0, spendUsd: 0 };
  }

  const billedIds = budget.billed_ids ?? {};
  const laneBilled = new Set(billedIds[lane] ?? []);
  const newIds = resourceIds.filter((id) => !laneBilled.has(id));
  if (newIds.length === 0) {
    return { billedCount: 0, spendUsd: 0 }; // every id already billed today in this lane — free
  }
  for (const id of newIds) laneBilled.add(id);
  billedIds[lane] = Array.from(laneBilled);
  budget.billed_ids = billedIds;

  return applyBill(budget, costUsd, lane, newIds.length, pricingStatus);
}

/**
 * @deprecated Use `billResourceRead(costUsd, lane, resourceIds)` directly and pass
 * the actual resource ids the response returned — this flat 1-unit wrapper is only
 * numerically correct for genuinely single-resource reads (`/tweets/{id}`), and
 * gives up the 24h-UTC dedup that `billResourceRead` provides for a same-day
 * re-read of the same id. Kept only so pre-Phase-1 callers keep working unchanged.
 *
 * Add a completed read's cost to the daily budget after a successful GET — flat
 * 1-unit billing, no per-resource counting or dedup. `lane` attributes the spend
 * in by_lane (operator spend audit 2026-07-12) — pass an endpoint family or caller
 * name; omitted = "unattributed". */
export async function incrementReadBudget(costUsd: number = READ_COST_USD, lane: string = "unattributed"): Promise<void> {
  await billResourceRead(costUsd, lane, undefined);
}

/** Estimate the worst-case resource count a read is ABOUT to return, from its
 * request query params — used as the PRE-FLIGHT `checkReadBudget` ceiling since
 * the true count is only known after the response arrives. Reads `max_results`
 * (search/mentions/timeline-style calls) or `ids` (batched `/tweets?ids=` lookups,
 * comma-separated); defaults to 1 (single-resource reads like `/users/me`). */
export function estimateResourceCount(queryParams: Record<string, string>): number {
  const maxResults = queryParams["max_results"];
  if (maxResults) {
    const n = parseInt(maxResults, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const ids = queryParams["ids"];
  if (ids) {
    const n = ids.split(",").filter((s) => s.trim().length > 0).length;
    if (n > 0) return n;
  }
  return 1;
}

/** Extract resource ids from a parsed X API v2 response body for per-resource
 * billing: `response.data` as an ARRAY → each item's `.id` (a search/mentions/
 * batch-lookup page — an EMPTY array is a legitimate zero-resource response and
 * returns `[]`, billing $0, not a flat unit); `response.data` as an OBJECT → its
 * own `.id` wrapped in a 1-element array (a single-resource read like
 * `/users/me`). `response.data` MISSING/null/non-object → also `[]`: X commonly
 * omits `data` entirely on a zero-result page (search/mentions with no matches),
 * and every endpoint this client calls is known to return either an array or an
 * object here on success — so an absent `data` key on a 2xx response means "zero
 * resources returned," never "unknown shape." (The `undefined` "bill 1 flat unit,
 * no known id" path in `billResourceRead` exists for callers that DON'T go through
 * this extractor at all — e.g. `incrementReadBudget`'s back-compat wrapper, or
 * arc-link-research's single-tweet lookup when the id genuinely can't be found —
 * not for a parsed body that legitimately contains zero resources.) */
export function extractResourceIds(response: Record<string, unknown>): string[] {
  const d = response["data"];
  if (Array.isArray(d)) {
    // Every X API v2 resource carries an id-shaped field in practice — usually
    // `id`, but News search stories use `rest_id` instead (2026-07-13, Phase 3:
    // confirmed live against docs.x.com/x-api/news/search-news —
    // {rest_id, name, summary, category, cluster_posts_results, contexts}, no
    // `id` field at all). Check both so News stories get the same same-UTC-day
    // dedup benefit every other resource type already has. An item missing
    // BOTH still cost money to return, so it must ALWAYS bill and never dedup —
    // a per-array-INDEX fallback (`__no_id_0`, ...) would be wrong: two different
    // malformed items landing at the same index on the same UTC day would collide
    // and the second would be silently deduped to $0 (dev-council/Kleppmann lens,
    // 2026-07-13). A fresh random id per occurrence guarantees it's billed exactly
    // once and never mistaken for a repeat.
    return d.map((item) => {
      const rec = item as Record<string, unknown>;
      const id = rec?.["id"] ?? rec?.["rest_id"];
      return id !== undefined && id !== null ? String(id) : `__no_id_${crypto.randomUUID()}`;
    });
  }
  if (d && typeof d === "object") {
    const rec = d as Record<string, unknown>;
    const id = rec["id"] ?? rec["rest_id"];
    return id !== undefined && id !== null ? [String(id)] : [];
  }
  return [];
}

/** Normalize an endpoint path to a stable lane key for by_lane attribution:
 * numeric path segments (ids) are dropped, e.g. "/users/195.../mentions" →
 * "users/mentions", "/tweets/search/recent" → "tweets/search/recent". */
export function endpointLane(endpoint: string): string {
  const parts = endpoint.split("?")[0].split("/").filter((p) => p && !/^\d+$/.test(p));
  return parts.join("/") || "root";
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
 * Budget-aware: checks the daily dollar read budget before the call, adds the
 * read's cost after success, and writes a 429 backoff on rate-limit responses
 * (AI-016). Pass `{ owned: true }` for OWNED reads (own posts, followers, lists)
 * so they bill at the $0.001 rate instead of the $0.005 non-owned rate. Pass
 * `{ lane: "..." }` (2026-07-13, arc-x-research-channel Phase 2) to bill under a
 * caller-chosen NAMED by_lane key instead of the default `endpointLane(endpoint)`
 * derivation — e.g. the candidate-maturation pass's batched `/tweets?ids=` read
 * needs its own `"candidate-maturation"` lane, not the generic `"tweets"` lane
 * `fetchRecentPostMetrics` already uses for the same endpoint. Omitting it keeps
 * every existing caller's current lane unchanged.
 *
 * (2026-07-13, Phase 3) Three more optional overrides, all additive/backward-
 * compatible — omitting any of them preserves today's behavior exactly:
 * - `costUsd`: overrides the owned/non-owned default price when a caller knows
 *   the TRUE (or a documented best-estimate) per-unit price — e.g. Trends'
 *   confirmed $0.010/request, or News search's UNCONFIRMED estimated rate.
 * - `billMode: "flat"`: bills exactly 1 unit of `costUsd` regardless of how many
 *   resources the response contains, instead of the default per-resource
 *   billing. Use for endpoints X prices PER REQUEST, not per resource returned —
 *   Trends ($0.010/req however many trend items come back) is the reason this
 *   exists; the default `"per-resource"` behavior is correct for every
 *   pre-Phase-3 caller and remains the default.
 * - `pricingStatus: "estimated"`: tags the lane's `by_lane` ledger entry so a
 *   provisional price is visibly flagged in the persisted budget file itself,
 *   not just in a log line — see `billResourceRead`'s doc comment. */
interface BillingOpts {
  lane?: string;
  billMode?: "per-resource" | "flat";
  pricingStatus?: "confirmed" | "estimated";
}

/** Shared tail for both `xApiGet` (OAuth 1.0a) and `xApiGetAppOnly` (OAuth 2.0
 * App-Only Bearer, 2026-07-13 Phase 3): perform the already-built request,
 * handle 429/error responses identically, then bill the read. Extracted so the
 * two auth styles can't silently drift apart on billing/error-handling
 * behavior — only the auth header differs between the two public functions. */
async function performBilledGet(
  url: string,
  headers: Record<string, string>,
  endpoint: string,
  costUsd: number,
  opts: BillingOpts,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "GET", headers });

  // Check status BEFORE parsing the body (dev-council/Newman lens, 2026-07-13): X
  // does not guarantee a JSON body on 429/5xx responses. The old ordering parsed
  // first, so a non-JSON error body threw out of `response.json()` and the 429
  // backoff below never ran — defeating the backoff precisely during a rate-limit
  // storm, and silently skipping billing for a request that still happened.
  if (response.status === 429) {
    // Rate limit hit — write a 15-min backoff then throw.
    await setReadBackoff();
    throw new Error(`X API GET ${endpoint} 429: rate limited — backoff written (15 min)`);
  }

  if (!response.ok) {
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text().catch(() => "<unreadable error body>");
    }
    throw new Error(`X API GET ${endpoint} ${response.status}: ${JSON.stringify(errBody)}`);
  }

  const data = await response.json();

  // Success — bill this read. Default: per-resource metering (the resources it
  // ACTUALLY returned), attributed by endpoint family, with same-UTC-day dedup on
  // repeated ids in this lane. `billMode: "flat"` (Phase 3) bills exactly 1 unit
  // instead — for endpoints priced per REQUEST regardless of result count (Trends).
  const typedData = data as Record<string, unknown>;
  const resourceIds = opts.billMode === "flat" ? undefined : extractResourceIds(typedData);
  await billResourceRead(costUsd, opts.lane ?? endpointLane(endpoint), resourceIds, opts.pricingStatus);

  return typedData;
}

/** Build `${API_BASE}${endpoint}[?querystring]` using the SAME percentEncode
 * (not URLSearchParams) and sort order `buildOAuthHeader`'s signature base
 * uses — URLSearchParams encodes a space as "+" while the OAuth 1.0a signature
 * uses "%20", so any param with a space (or !*'()) would otherwise mismatch
 * and 401 (cairn #2). Shared by `xApiGet` and `xApiGetAppOnly` (dev-council/
 * Fowler lens, 2026-07-13 — this was the one piece of real duplication
 * between the two auth-mode entry points; everything else differs enough
 * between OAuth 1.0a signing and Bearer auth that it's correctly NOT shared). */
function buildRequestUrl(endpoint: string, queryParams: Record<string, string>): { baseUrl: string; url: string } {
  const baseUrl = `${API_BASE}${endpoint}`;
  const qs = Object.keys(queryParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(queryParams[k])}`)
    .join("&");
  return { baseUrl, url: qs ? `${baseUrl}?${qs}` : baseUrl };
}

export async function xApiGet(
  endpoint: string,
  creds: XCreds,
  queryParams: Record<string, string> = {},
  opts: {
    owned?: boolean;
    lane?: string;
    costUsd?: number;
    billMode?: "per-resource" | "flat";
    pricingStatus?: "confirmed" | "estimated";
  } = {},
): Promise<Record<string, unknown>> {
  // Guard: enforce daily dollar read budget and 429 backoff before the network.
  // Pre-flight uses the WORST-CASE resource count from the request (max_results /
  // ids) since the true count returned is only known after the response arrives —
  // see billResourceRead below for the actual per-resource billing. An explicit
  // `opts.costUsd` (Phase 3) takes priority over the owned/non-owned default so a
  // caller-supplied price is respected pre-flight too, not just when billing.
  const costUsd = opts.costUsd ?? (opts.owned ? OWNED_READ_COST_USD : READ_COST_USD);
  await checkReadBudget(costUsd * estimateResourceCount(queryParams));

  const { baseUrl, url } = buildRequestUrl(endpoint, queryParams);
  const authHeader = await buildOAuthHeader("GET", baseUrl, creds, queryParams);
  return performBilledGet(url, { Authorization: authHeader }, endpoint, costUsd, opts);
}

// ---- OAuth 2.0 App-Only (Bearer) auth (2026-07-13, Phase 3 arc-x-research-channel) ---

// Some X API v2 endpoints EXPLICITLY FORBID OAuth 1.0a User Context and require
// OAuth 2.0 App-Only or User Context instead — confirmed LIVE this phase (not
// documented anywhere the Phase 1 console reconciliation could reach without
// browser access): `GET /2/trends/by/woeid/{id}` and `GET /2/news/search` both
// 403 "Unsupported Authentication...Authenticating with OAuth 1.0a User Context
// is forbidden for this endpoint. Supported authentication types are [OAuth 2.0
// User Context, OAuth 2.0 Application-Only]" against xApiGet's existing OAuth
// 1.0a signer. App-Only is the right fit here (not the interactive User-Context
// PKCE flow) because these are PUBLIC reads (trending topics, public news
// stories) with no per-user scope — the standard non-interactive
// `client_credentials` grant, using the SAME consumer key/secret already
// stored (no new credential needed, no browser/PKCE flow to build).
// (`personalized_trends` is the opposite case — confirmed live to ALREADY work
// via the existing OAuth 1.0a `xApiGet`/`loadXCreds()` path, since it's
// genuinely user-scoped; no App-Only bearer needed there.)

let cachedBearerToken: string | null = null;

/** Exchange consumer key/secret for an OAuth 2.0 App-Only bearer token via the
 * `client_credentials` grant. This is an auth-token exchange, not a billed X
 * API v2 read — never metered. Cached in-memory for the lifetime of this
 * process only (each scheduled check-in run is its own short-lived process, so
 * there's no staleness risk from a longer-lived disk cache — a fresh token per
 * run costs nothing extra). */
export async function getAppOnlyBearerToken(
  creds: Pick<XCreds, "apiKey" | "apiSecret">,
): Promise<string> {
  if (cachedBearerToken) return cachedBearerToken;
  const basic = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString("base64");
  const resp = await fetch("https://api.x.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    throw new Error(
      `X OAuth2 App-Only token exchange failed: ${resp.status} ${await resp.text().catch(() => "<unreadable>")}`,
    );
  }
  const json = (await resp.json()) as { token_type: string; access_token: string };
  // The token endpoint percent-encodes the access_token (e.g. embeds a "%2F")
  // — decode it once here so every caller gets the raw bearer value.
  cachedBearerToken = decodeURIComponent(json.access_token);
  return cachedBearerToken;
}

/** A GET against the X API v2 using OAuth 2.0 App-Only (Bearer) auth — for the
 * subset of endpoints that reject OAuth 1.0a User Context (see the comment
 * block above). Same budget-guard + per-resource/flat billing tail as
 * `xApiGet` (`performBilledGet`) — only the auth header differs. `creds` only
 * needs `apiKey`/`apiSecret` (the App-Only grant doesn't use the user access
 * token/secret at all). */
export async function xApiGetAppOnly(
  endpoint: string,
  creds: Pick<XCreds, "apiKey" | "apiSecret">,
  queryParams: Record<string, string> = {},
  opts: {
    costUsd?: number;
    lane?: string;
    billMode?: "per-resource" | "flat";
    pricingStatus?: "confirmed" | "estimated";
  } = {},
): Promise<Record<string, unknown>> {
  const costUsd = opts.costUsd ?? READ_COST_USD;
  await checkReadBudget(costUsd * estimateResourceCount(queryParams));

  const { url } = buildRequestUrl(endpoint, queryParams);

  const bearer = await getAppOnlyBearerToken(creds);
  try {
    return await performBilledGet(url, { Authorization: `Bearer ${bearer}` }, endpoint, costUsd, opts);
  } catch (err) {
    // Self-heal on a stale/revoked token (dev-council/Lamport + Newman lenses,
    // 2026-07-13): the in-memory bearer cache has no explicit expiry — today's
    // short-lived scheduled-run processes never live long enough for this to
    // matter, but a future long-lived resident process would otherwise have
    // EVERY subsequent App-Only call wedged for the rest of its life once X
    // revokes/rotates the token, with no recovery path. Clear the cache and
    // retry ONCE with a freshly-exchanged token before giving up — cheap
    // insurance that costs nothing extra in the common case where this never
    // fires (no billing happens on the failed attempt; `performBilledGet`
    // only bills after a successful response).
    const message = (err as Error).message;
    if (message.includes("401") && cachedBearerToken) {
      cachedBearerToken = null;
      const freshBearer = await getAppOnlyBearerToken(creds);
      return performBilledGet(url, { Authorization: `Bearer ${freshBearer}` }, endpoint, costUsd, opts);
    }
    throw err;
  }
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
    const me = await xApiGet("/users/me", opts.creds, { "user.fields": "id,username" }, { owned: true });
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
): Promise<FollowerMetrics & { cached?: boolean }> {
  // P2 arc-funnel-hardening: check 4h cache before consuming read budget.
  const cached = await loadFollowerCache();
  if (cached) {
    return {
      followers_count: cached.followers_count,
      following_count: cached.following_count,
      tweet_count: cached.tweet_count,
      cached: true,
    };
  }
  const endpoint = arcUserId ? `/users/${arcUserId}` : "/users/me";
  const resp = await xApiGet(endpoint, creds, {
    "user.fields": "public_metrics",
  }, { owned: true });
  const data = (resp["data"] as Record<string, unknown> | undefined) ?? {};
  const metrics = (data["public_metrics"] as Record<string, number> | undefined) ?? {};
  const result = {
    followers_count: metrics["followers_count"] ?? 0,
    following_count: metrics["following_count"] ?? 0,
    tweet_count: metrics["tweet_count"] ?? 0,
  };
  // Save to cache so next call within 4h skips the API
  try { await saveFollowerCache(result); } catch { /* cache write is best-effort */ }
  return result;
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
  // Arc's own posts → owned read ($0.001).
  const resp = await xApiGet("/tweets", creds, {
    ids,
    "tweet.fields": "created_at,public_metrics",
  }, { owned: true });
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

/** Dollars remaining in today's read budget (0 = exhausted). Use for consumers
 * that want to check headroom before a multi-read run. */
export async function getRemainingReadBudgetUsd(): Promise<number> {
  const budget = await loadReadBudget();
  if (budget.date !== todayUTC()) return X_READ_BUDGET_USD_PER_DAY;
  if (budget.backoff_until && new Date() < new Date(budget.backoff_until)) return 0;
  return Math.max(0, X_READ_BUDGET_USD_PER_DAY - budget.spend_usd);
}
