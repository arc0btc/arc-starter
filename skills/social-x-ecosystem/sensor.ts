// skills/social-x-ecosystem/sensor.ts
// Monitors X for ecosystem keywords, rotating one keyword per 15min cycle.
// STORES newly-seen URL-bearing tweets as candidates on the shared
// candidate-maturation spine (src/candidate-spine.ts) instead of judging them at
// birth — skills/candidate-maturation/sensor.ts re-scores them once they've aged
// 2-24h and files the arc-link-research task if they matured.
//
// 2026-07-13 (arc-x-research-channel Phase 2): this sensor's OLD behavior judged
// engagement AT DISCOVERY TIME (`isHighSignal` on a tweet typically seconds-to-
// minutes old), which almost never passed — 0 research tasks were ever produced
// across 4+ months of runs. That judge-at-birth logic is REMOVED from this file;
// see src/candidate-spine.ts for the store + shared scoring primitives, and
// skills/candidate-maturation/sensor.ts for the re-score pass.
//
// KEYWORD_ROTATION_ENABLED (below): the keyword rotation itself is being RETIRED
// per the 2026-07-13 operator decision (News/Trends/List — Phases 3-4 — replace
// it; 0 tasks in 4+ months). It ran here transiently, store-only, to prove the
// candidate spine end-to-end before retirement.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";
import { insertCandidateIfNew, extractUrls } from "../../src/candidate-spine.ts";
// Read-budget guard (2026-07-12 operator spend audit): this sensor's 96 searches/day
// (~$0.48) were previously UNMETERED — the single biggest read spend on the account,
// invisible to db/x-read-budget.json. Every search now checks + bills the shared
// daily dollar budget like all other read lanes.
// 2026-07-13 (arc-x-research-channel Phase 1 metering fix): this sensor bills per
// RESOURCE returned (up to 10 tweets/search), not a flat 1 unit per call — see
// billResourceRead / estimateResourceCount / extractResourceIds in x-api.ts.
// Reuses the SAME id-extraction helper x-api.ts's own xApiGet uses (dev-council/
// Fowler + Newman lenses, 2026-07-13) instead of re-deriving it here, so the two
// copies of "parsed body -> billable ids" can't silently drift apart.
import { checkReadBudget, billResourceRead, estimateResourceCount, extractResourceIds, READ_COST_USD } from "../social-x-posting/lib/x-api.ts";

const SENSOR_NAME = "social-x-ecosystem";
const INTERVAL_MINUTES = 15;
const API_BASE = "https://api.x.com/2";

// 2026-07-13 operator decision (arc-x-research-channel quest, do not re-ask):
// keyword rotation RETIRED FULLY — 0 research tasks produced in 4+ months, the
// gate was structurally closed (judge-at-birth). News search + Trends + the
// curated-roster List (Phases 3-4) replace it. Revivable later behind the
// maturation gate if ever needed — flip this back to true, nothing else to undo.
const KEYWORD_ROTATION_ENABLED = true; // Phase 2 task 3 flips this to false

const KEYWORDS = [
  "Agents Bitcoin",
  "OpenClaw",
  "Claude Code",
  "Bitcoin AI agent",
  "Stacks STX",
  "AIBTC",
  // Dev-tools beat discovery keywords
  "MCP server tools",
  "agent framework SDK",
  "x402 payment protocol",
  "LLM routing agents",
  "agent tools AI",
  "AI developer tools",
  // P5 arc-demand-flywheel (2026-07-03): sharpen the trending-agent-development signal.
  "autonomous coding agent",
];

const log = createSensorLogger(SENSOR_NAME);

// ---- OAuth 1.0a (GET-only, shared pattern from social-x-posting) ----

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

async function loadCreds(): Promise<OAuthCreds | null> {
  try {
    const apiKey = await getCredential("x", "consumer_key");
    const apiSecret = await getCredential("x", "consumer_secret");
    const accessToken = await getCredential("x", "access_token");
    const accessTokenSecret = await getCredential("x", "access_token_secret");
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
    return { apiKey, apiSecret, accessToken, accessTokenSecret };
  } catch {
    return null;
  }
}

async function apiGet(
  endpoint: string,
  creds: OAuthCreds,
  queryParams: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  // Budget guard: skip the read (return null → caller logs "search failed" and
  // advances the keyword rotation) when the shared daily read budget is spent.
  // Pre-flight uses the worst-case resource count (max_results) since the actual
  // count returned is only known after the response arrives.
  try {
    await checkReadBudget(READ_COST_USD * estimateResourceCount(queryParams));
  } catch (budgetErr) {
    log(`skip read: ${(budgetErr as Error).message}`);
    return null;
  }

  const baseUrl = `${API_BASE}${endpoint}`;
  const url = Object.keys(queryParams).length > 0
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...queryParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");
  const signatureBase = `GET&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${headerParts}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    log(`warn: API ${response.status} on ${endpoint}`);
    return null;
  }

  // Parse BEFORE billing so we can bill per resource actually returned (a 10-tweet
  // page costs 10x a 0-tweet page — the previous flat-1-unit bill undercounted this
  // sensor's whole search rotation). Same-UTC-day dedup on repeated tweet ids in the
  // "ecosystem-search" lane makes an accidental re-read of the same tweet free.
  const json = (await response.json()) as Record<string, unknown>;
  await billResourceRead(READ_COST_USD, "ecosystem-search", extractResourceIds(json));

  return json;
}

// ---- Signal detection ----

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

// extractUrls / isHighSignal moved to src/candidate-spine.ts (2026-07-13, Phase 2)
// so every producer/consumer of the candidate spine shares one bar instead of
// forking it. isHighSignal is no longer called from THIS file — it's the
// candidate-maturation pass's job to judge engagement, at 2-24h age, not here.

// ---- State management ----

interface EcosystemState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  keyword_index: number;
  seen_ids: string[]; // rolling window of seen tweet IDs
}

const MAX_SEEN_IDS = 500; // cap to prevent unbounded growth

// ---- Sensor ----

export default async function xEcosystemSensor(): Promise<string> {
  try {
    if (!KEYWORD_ROTATION_ENABLED) {
      // Retired 2026-07-13 (arc-x-research-channel Phase 2, operator decision) —
      // return BEFORE claimSensorRun/credential-load/any API call so a disabled
      // run is provably zero-cost, not just an early skip that still burns budget.
      log("disabled: keyword rotation retired 2026-07-13, see candidate-maturation + Phase 3/4 lanes");
      return "skip";
    }

    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    const creds = await loadCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    // Load state and determine which keyword to search
    const rawState = await readHookState(SENSOR_NAME);
    const state: EcosystemState = {
      last_ran: rawState?.last_ran ?? new Date().toISOString(),
      last_result: (rawState?.last_result as EcosystemState["last_result"]) ?? "ok",
      version: (rawState?.version as number) ?? 0,
      keyword_index: (rawState?.keyword_index as number) ?? 0,
      seen_ids: (rawState?.seen_ids as string[]) ?? [],
    };

    const keywordIndex = state.keyword_index % KEYWORDS.length;
    const keyword = KEYWORDS[keywordIndex];
    log(`searching keyword ${keywordIndex + 1}/${KEYWORDS.length}: "${keyword}"`);

    // Exclude our own tweets and retweets from results
    const query = `${keyword} -is:retweet -from:arc0btc`;

    const result = await apiGet("/tweets/search/recent", creds, {
      query,
      max_results: "10",
      "tweet.fields": "created_at,author_id,public_metrics",
    });

    if (!result) {
      log("warn: search failed");
      // Still advance keyword rotation so we don't get stuck
      await writeHookState(SENSOR_NAME, {
        ...state,
        last_ran: new Date().toISOString(),
        last_result: "error",
        version: state.version + 1,
        keyword_index: keywordIndex + 1,
      });
      return "error";
    }

    const tweets = (result["data"] as Tweet[] | undefined) || [];
    log(`found ${tweets.length} tweets for "${keyword}"`);

    const seenSet = new Set(state.seen_ids);
    let newTweets = 0;
    let candidatesStored = 0;

    for (const tweet of tweets) {
      if (seenSet.has(tweet.id)) continue;
      seenSet.add(tweet.id);
      newTweets++;

      // STORE, don't judge (2026-07-13, Phase 2 fix): a tweet from a search/recent
      // page is typically seconds-to-minutes old, so checking engagement HERE was
      // the structurally-closed gate (isHighSignal almost never passes at ~0min).
      // Any new tweet with at least one real URL becomes a candidate; the
      // candidate-maturation sensor re-scores it once it's aged 2-24h.
      const urls = extractUrls(tweet.text);
      if (urls.length > 0) {
        const truncatedText =
          tweet.text.length > 120 ? tweet.text.slice(0, 120) + "..." : tweet.text;

        const inserted = insertCandidateIfNew({
          tweet_id: tweet.id,
          source_lane: "keyword-rotation",
          first_seen: new Date().toISOString(),
          author_id: tweet.author_id,
          text_snippet: truncatedText,
          urls,
          discovery_context: keyword,
        });
        if (inserted) {
          candidatesStored++;
          log(`candidate stored for tweet ${tweet.id}: "${truncatedText}"`);
        }
      }
    }

    // Trim seen IDs to rolling window
    const updatedSeen = Array.from(seenSet);
    const trimmedSeen =
      updatedSeen.length > MAX_SEEN_IDS
        ? updatedSeen.slice(updatedSeen.length - MAX_SEEN_IDS)
        : updatedSeen;

    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: state.version + 1,
      keyword_index: keywordIndex + 1,
      seen_ids: trimmedSeen,
      last_keyword: keyword,
      last_tweet_count: tweets.length,
      last_new_count: newTweets,
      last_candidates_stored: candidatesStored,
    });

    log(`completed: ${newTweets} new tweets, ${candidatesStored} candidates stored`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
