// skills/social-x-posting/sensor.ts
// Polls X mentions every 15 minutes, creates tasks for mentions worth responding to.
// Deduplicates by storing last-seen tweet ID in hook state.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";
import { join } from "path";

const CREDITS_DEPLETED_PATH = join(import.meta.dir, "../../db/x-credits-depleted.json");
const CREDITS_DEPLETED_TTL_DAYS = 30;

async function isCreditsDepleted(): Promise<boolean> {
  try {
    const file = Bun.file(CREDITS_DEPLETED_PATH);
    if (!(await file.exists())) return false;
    const data = (await file.json()) as { depleted_at: string };
    const depletedAt = new Date(data.depleted_at);
    const expiresAt = new Date(depletedAt.getTime() + CREDITS_DEPLETED_TTL_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < expiresAt) return true;
    // Expired — auto-clear
    await Bun.write(CREDITS_DEPLETED_PATH, "");
    return false;
  } catch {
    return false;
  }
}

const SENSOR_NAME = "social-x-mentions";
const INTERVAL_MINUTES = 15;
const API_BASE = "https://api.x.com/2";

// Keywords to detect topic-specific context needs for mention reply tasks.
const BITCOIN_WALLET_KEYWORDS = [
  "bitcoin wallet", "btc wallet", "bitcoin address", "btc address",
  "bitcoin balance", "send bitcoin", "receive bitcoin",
];
const MULTISIG_KEYWORDS = [
  "multisig", "multi-sig", "taproot multisig", "cosign", "co-sign",
  "threshold signature", "2-of-3", "3-of-5",
];

function detectBitcoinWalletTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return BITCOIN_WALLET_KEYWORDS.some((k) => lower.includes(k));
}

function detectMultisigTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return MULTISIG_KEYWORDS.some((k) => lower.includes(k));
}

const log = createSensorLogger(SENSOR_NAME);

// ---- OAuth 1.0a (minimal, GET-only) ----

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

  // Build OAuth header
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

  return (await response.json()) as Record<string, unknown>;
}

// ---- Mention filtering ----

interface Mention {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
  conversation_id?: string;
  in_reply_to_user_id?: string;
}

function isWorthResponding(mention: Mention, myUserId: string): boolean {
  const text = mention.text.toLowerCase();

  // Skip mentions that are just our own tweets echoed back
  if (mention.author_id === myUserId) return false;

  // Skip very short mentions (just "@arc0btc" with no substance)
  const withoutMentions = text.replace(/@\w+/g, "").trim();
  if (withoutMentions.length < 10) return false;

  // Skip spam patterns
  const spamPatterns = [
    /\b(airdrop|giveaway|free\s+money|click\s+here|join\s+now)\b/i,
    /\b(send\s+\d+|dm\s+me|follow\s+back)\b/i,
    /\b(check\s+my\s+bio|link\s+in\s+bio)\b/i,
  ];
  for (const pattern of spamPatterns) {
    if (pattern.test(text)) return false;
  }

  // Worth responding: questions, substantive mentions, or replies in conversations
  const questionPatterns = /\?|what|how|why|when|thoughts|opinion|think/i;
  const bitcoinPatterns = /\b(bitcoin|btc|stacks|stx|sbtc|ordinals|defi|dao|agent)\b/i;
  const directEngagement = /\b(arc|arc0btc|arc0)\b/i;

  // Prioritize questions about topics we care about
  if (questionPatterns.test(text) && bitcoinPatterns.test(text)) return true;

  // Direct engagement with substance
  if (directEngagement.test(text) && withoutMentions.length > 20) return true;

  // Mentions with engagement signals (others are also engaging)
  const metrics = mention.public_metrics;
  if (metrics && (metrics.like_count >= 2 || metrics.reply_count >= 1)) return true;

  // Bitcoin/Stacks topic mentions with enough substance
  if (bitcoinPatterns.test(text) && withoutMentions.length > 30) return true;

  return false;
}

// ---- Sensor ----

export default async function xMentionsSensor(): Promise<string> {
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

    // Get our user ID
    const me = await apiGet("/users/me", creds, { "user.fields": "id" });
    if (!me) {
      log("error: could not fetch user info");
      return "error";
    }
    const userData = me["data"] as Record<string, string> | undefined;
    if (!userData) {
      log("error: no user data in response");
      return "error";
    }
    const myUserId = userData["id"];

    // Load last-seen ID from hook state
    const state = await readHookState(SENSOR_NAME);
    const lastSeenId = (state?.["last_seen_id"] as string) || undefined;

    // Fetch mentions
    const params: Record<string, string> = {
      max_results: "20",
      "tweet.fields": "created_at,author_id,public_metrics,conversation_id,in_reply_to_user_id",
    };
    if (lastSeenId) {
      params["since_id"] = lastSeenId;
    }

    const mentionsResponse = await apiGet(`/users/${myUserId}/mentions`, creds, params);
    if (!mentionsResponse) {
      log("warn: mentions fetch failed");
      return "error";
    }

    const mentions = (mentionsResponse["data"] as Mention[] | undefined) || [];
    const meta = mentionsResponse["meta"] as Record<string, string> | undefined;
    const newestId = meta?.["newest_id"];

    if (mentions.length === 0) {
      log("no new mentions");
      // Still update state to track last run
      if (newestId) {
        await writeHookState(SENSOR_NAME, {
          ...(state || { version: 0 }),
          last_ran: new Date().toISOString(),
          last_result: "ok",
          version: (state?.version || 0) + 1,
          last_seen_id: newestId,
        });
      }
      return "ok";
    }

    log(`found ${mentions.length} new mentions`);

    // Skip task creation if posting credits are depleted
    if (await isCreditsDepleted()) {
      log("skip task creation: X credits depleted (db/x-credits-depleted.json)");
      if (newestId) {
        await writeHookState(SENSOR_NAME, {
          ...(state || { version: 0 }),
          last_ran: new Date().toISOString(),
          last_result: "skip",
          version: (state?.version || 0) + 1,
          last_seen_id: newestId,
        });
      }
      return "ok";
    }

    // Filter to actionable mentions
    let tasksCreated = 0;
    for (const mention of mentions) {
      if (!isWorthResponding(mention, myUserId)) {
        log(`skip mention ${mention.id}: filtered out`);
        continue;
      }

      const source = `sensor:${SENSOR_NAME}:${mention.id}`;
      const truncatedText =
        mention.text.length > 100
          ? mention.text.slice(0, 100) + "..."
          : mention.text;

      const taskId = insertTaskIfNew(source, {
        subject: `Reply to X mention from user ${mention.author_id}`,
        description: [
          `Tweet ID: ${mention.id}`,
          `Author ID: ${mention.author_id}`,
          `Date: ${mention.created_at}`,
          `Text: ${mention.text}`,
          mention.conversation_id ? `Conversation: ${mention.conversation_id}` : "",
          "",
          "Review this mention and reply if appropriate. Use:",
          `  arc skills run --name social-x-posting -- reply --text "<reply>" --tweet-id ${mention.id}`,
        ]
          .filter(Boolean)
          .join("\n"),
        skills: JSON.stringify([
          "social-x-posting",
          ...(detectBitcoinWalletTopic(mention.text) ? ["bitcoin-wallet"] : []),
          ...(detectMultisigTopic(mention.text) ? ["bitcoin-taproot-multisig"] : []),
        ]),
        priority: 7,
        model: "sonnet",
      });

      if (taskId !== null) {
        tasksCreated++;
        log(`task created for mention ${mention.id}: "${truncatedText}"`);
      }
    }

    // Update last-seen ID
    const newLastSeen = newestId || mentions[0]?.id || lastSeenId;
    await writeHookState(SENSOR_NAME, {
      ...(state || { version: 0 }),
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state?.version || 0) + 1,
      last_seen_id: newLastSeen || "",
      last_mention_count: mentions.length,
      last_tasks_created: tasksCreated,
    });

    log(`run completed: ${mentions.length} mentions, ${tasksCreated} tasks created`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
