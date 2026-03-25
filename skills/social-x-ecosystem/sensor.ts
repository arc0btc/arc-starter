// skills/social-x-ecosystem/sensor.ts
// Monitors X for ecosystem keywords, rotating one keyword per 15min cycle.
// Stores seen tweet IDs to avoid re-fetching. Files URL-bearing tweets as
// arc-link-research tasks when they show high signal.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { recentTaskExistsForSource, insertTask } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "social-x-ecosystem";
const INTERVAL_MINUTES = 15;
const API_BASE = "https://api.x.com/2";

const KEYWORDS = [
  "Agents Bitcoin",
  "OpenClaw",
  "Claude Code",
  "Bitcoin AI agent",
  "Stacks STX",
  "AIBTC",
  // Dev-tools beat discovery keywords
  "MCP protocol tools",
  "agent framework SDK",
  "x402 payment protocol",
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
  });

  if (!response.ok) {
    log(`warn: API ${response.status} on ${endpoint}`);
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
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

const URL_RE = /https?:\/\/[^\s)]+/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE);
  if (!matches) return [];
  // Filter out t.co shortlinks that are just twitter's own wrapping
  return matches.filter((u) => !u.startsWith("https://t.co/"));
}

function isHighSignal(tweet: Tweet): boolean {
  const metrics = tweet.public_metrics;
  if (!metrics) return false;
  // High engagement: 5+ likes or 2+ retweets or 3+ replies
  return metrics.like_count >= 5 || metrics.retweet_count >= 2 || metrics.reply_count >= 3;
}

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
    let tasksCreated = 0;

    for (const tweet of tweets) {
      if (seenSet.has(tweet.id)) continue;
      seenSet.add(tweet.id);
      newTweets++;

      // Check for research-worthy tweets: has URLs + high engagement
      const urls = extractUrls(tweet.text);
      if (urls.length > 0 && isHighSignal(tweet)) {
        const source = `sensor:${SENSOR_NAME}:${tweet.id}`;
        const linkList = urls.join(", ");
        const truncatedText =
          tweet.text.length > 120 ? tweet.text.slice(0, 120) + "..." : tweet.text;

        if (!recentTaskExistsForSource(source, 24 * 60)) {
          insertTask({
            subject: `Research: ecosystem signal — ${keyword}`,
            description: [
              `Source: X search for "${keyword}"`,
              `Tweet ID: ${tweet.id}`,
              `Author ID: ${tweet.author_id}`,
              `Date: ${tweet.created_at}`,
              `Text: ${truncatedText}`,
              `Links: ${linkList}`,
              "",
              `Engagement: ${tweet.public_metrics?.like_count ?? 0} likes, ${tweet.public_metrics?.retweet_count ?? 0} RTs, ${tweet.public_metrics?.reply_count ?? 0} replies`,
              "",
              "Evaluate these links for mission relevance. Use:",
              `  arc skills run --name arc-link-research -- process --links "${linkList}"`,
            ].join("\n"),
            skills: JSON.stringify(["arc-link-research"]),
            priority: 7,
            model: "sonnet",
            source,
          });
          tasksCreated++;
          log(`task created for tweet ${tweet.id}: "${truncatedText}"`);
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
      last_tasks_created: tasksCreated,
    });

    log(`completed: ${newTweets} new tweets, ${tasksCreated} research tasks created`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
