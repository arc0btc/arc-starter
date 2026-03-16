// skills/review-commitments/sensor.ts
//
// Scans Arc's recent X posts and sent emails for commitment language,
// creates follow-up verification tasks, and logs commitments to known
// contacts in the contact interaction table. Runs every 60 minutes.
// Pure TypeScript — no LLM.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import {
  initContactsSchema,
  insertContactInteraction,
  searchContacts,
  resolveDisplayName,
  type Contact,
} from "../contacts/schema.ts";

const SENSOR_NAME = "review-commitments";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE_PREFIX = "sensor:review-commitments";
const LOOKBACK_HOURS = 2;
const MAX_COMMITMENTS_PER_RUN = 5;
const MAX_COMMITMENTS_PER_DAY = 10;

const log = createSensorLogger(SENSOR_NAME);

// ---- Commitment detection patterns ----

// Phrases that signal a commitment (must appear with a verb/action context)
const COMMITMENT_PATTERNS: RegExp[] = [
  /\b(i('|')?ll|we('|')?ll|i('|')m going to|we('|')re going to)\b/i,
  /\b(will|going to|plan to|planning to|intend to|aiming to)\b/i,
  /\b(shipping|releasing|launching|deploying|publishing)\b.*\b(today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(by|before|no later than)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end of (day|week)|eod|eow)\b/i,
  /\b(expect to|committed to|promise to|guarantee)\b/i,
  /\b(will (ship|release|launch|deploy|publish|deliver|complete|finish|send|post|share|announce))\b/i,
];

// Exclusion patterns — skip these even if commitment language matches
const EXCLUSION_PATTERNS: RegExp[] = [
  /^RT\s+@/i,                        // Retweets
  /^@\w+\s/,                         // Replies starting with @mention (quoting others)
  /\bwill be\s+(available|there)\b/i, // Generic "will be" without action
  /\bif\s+.*\bwill\b/i,              // Conditional "if X will Y" — not a firm commitment
];

interface Commitment {
  source_type: "x" | "email";
  source_id: string;
  text: string;
  recipient: string | null;  // X handle or email address
  created_at: string;
}

// ---- X API (OAuth 1.0a, minimal GET-only) ----

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

async function loadXCreds(): Promise<OAuthCreds | null> {
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

async function xApiGet(
  endpoint: string,
  creds: OAuthCreds,
  queryParams: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  const baseUrl = `https://api.x.com/2${endpoint}`;
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
    log(`warn: X API ${response.status} on ${endpoint}`);
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

// ---- Commitment scanning ----

function hasCommitmentLanguage(text: string): boolean {
  // Check exclusions first
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  // Check for commitment patterns
  for (const pattern of COMMITMENT_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/** Extract @mentions from tweet text. */
function extractMentions(text: string): string[] {
  const matches = text.match(/@(\w+)/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

/** Extract email recipient from to_address. */
function extractEmailRecipient(toAddress: string): string {
  return toAddress.toLowerCase().trim();
}

// ---- Data sources ----

interface XTweet {
  id: string;
  text: string;
  created_at: string;
}

async function fetchRecentTweets(creds: OAuthCreds, sinceId: string | null): Promise<XTweet[]> {
  // Get user ID
  const me = await xApiGet("/users/me", creds, { "user.fields": "id" });
  if (!me) return [];
  const userData = me["data"] as Record<string, string> | undefined;
  if (!userData) return [];
  const userId = userData["id"];

  const params: Record<string, string> = {
    max_results: "20",
    "tweet.fields": "created_at",
  };
  if (sinceId) {
    params["since_id"] = sinceId;
  }

  const response = await xApiGet(`/users/${userId}/tweets`, creds, params);
  if (!response) return [];

  const tweets = (response["data"] as XTweet[] | undefined) || [];
  return tweets;
}

interface SentEmail {
  remote_id: string;
  to_address: string;
  subject: string | null;
  body_preview: string | null;
  received_at: string;
}

function getRecentSentEmails(sinceIso: string): SentEmail[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT remote_id, to_address, subject, body_preview, received_at
       FROM email_messages
       WHERE folder = 'sent'
         AND received_at > ?
       ORDER BY received_at DESC
       LIMIT 50`
    )
    .all(sinceIso) as SentEmail[];
}

// ---- Contact matching ----

function findContactByXHandle(handle: string): Contact | null {
  const results = searchContacts(handle);
  return results.find((c) => c.x_handle?.toLowerCase() === handle.toLowerCase()) ?? null;
}

function findContactByEmail(email: string): Contact | null {
  const results = searchContacts(email);
  return results.find((c) => c.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

// ---- Main sensor ----

export default async function reviewCommitmentsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const hookState = await readHookState(SENSOR_NAME);
  const seenTweetIds = new Set<string>((hookState?.seen_tweet_ids as string[]) ?? []);
  const seenEmailIds = new Set<string>((hookState?.seen_email_ids as string[]) ?? []);
  const lastTweetId = (hookState?.last_tweet_id as string) || null;

  const commitments: Commitment[] = [];

  // --- Scan X timeline ---
  const xCreds = await loadXCreds();
  let newestTweetId = lastTweetId;

  if (xCreds) {
    try {
      const tweets = await fetchRecentTweets(xCreds, lastTweetId);
      log(`scanned ${tweets.length} recent tweets`);

      for (const tweet of tweets) {
        if (seenTweetIds.has(tweet.id)) continue;
        seenTweetIds.add(tweet.id);

        // Track newest for pagination
        if (!newestTweetId || tweet.id > newestTweetId) {
          newestTweetId = tweet.id;
        }

        if (hasCommitmentLanguage(tweet.text)) {
          const mentions = extractMentions(tweet.text);
          commitments.push({
            source_type: "x",
            source_id: tweet.id,
            text: tweet.text,
            recipient: mentions[0] ?? null,
            created_at: tweet.created_at,
          });
        }
      }
    } catch (e) {
      log(`warn: X timeline fetch failed: ${(e as Error).message}`);
    }
  } else {
    log("skip X scan: credentials not configured");
  }

  // --- Scan sent emails ---
  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  try {
    const emails = getRecentSentEmails(sinceIso);
    log(`scanned ${emails.length} recent sent emails`);

    for (const email of emails) {
      if (seenEmailIds.has(email.remote_id)) continue;
      seenEmailIds.add(email.remote_id);

      const fullText = [email.subject ?? "", email.body_preview ?? ""].join(" ");
      if (hasCommitmentLanguage(fullText)) {
        commitments.push({
          source_type: "email",
          source_id: email.remote_id,
          text: fullText.slice(0, 300),
          recipient: extractEmailRecipient(email.to_address),
          created_at: email.received_at,
        });
      }
    }
  } catch (e) {
    log(`warn: email scan failed: ${(e as Error).message}`);
  }

  log(`found ${commitments.length} commitment(s)`);

  if (commitments.length === 0) {
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (hookState?.version ?? 0) + 1,
      seen_tweet_ids: [...seenTweetIds].slice(-200),
      seen_email_ids: [...seenEmailIds].slice(-200),
      last_tweet_id: newestTweetId,
    });
    return "ok";
  }

  // Check daily cap
  const db = getDatabase();
  const todayCount = (db.query(
    `SELECT COUNT(*) as c FROM tasks
     WHERE source LIKE '${TASK_SOURCE_PREFIX}:%'
       AND created_at >= date('now')`
  ).get() as { c: number })?.c ?? 0;

  if (todayCount >= MAX_COMMITMENTS_PER_DAY) {
    log(`daily cap reached (${todayCount}/${MAX_COMMITMENTS_PER_DAY}) — skipping`);
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "capped",
      version: (hookState?.version ?? 0) + 1,
      seen_tweet_ids: [...seenTweetIds].slice(-200),
      seen_email_ids: [...seenEmailIds].slice(-200),
      last_tweet_id: newestTweetId,
    });
    return "ok";
  }

  const budget = Math.min(MAX_COMMITMENTS_PER_DAY - todayCount, MAX_COMMITMENTS_PER_RUN);

  // Initialize contacts schema for interaction logging
  initContactsSchema();

  let queued = 0;
  for (const commitment of commitments.slice(0, budget)) {
    const source = `${TASK_SOURCE_PREFIX}:${commitment.source_type}:${commitment.source_id}`;

    // Log to contact interaction if recipient is a known contact
    if (commitment.recipient) {
      try {
        const contact = commitment.source_type === "x"
          ? findContactByXHandle(commitment.recipient)
          : findContactByEmail(commitment.recipient);

        if (contact) {
          insertContactInteraction({
            contact_id: contact.id,
            type: "commitment",
            summary: `Commitment made via ${commitment.source_type}: ${commitment.text.slice(0, 200)}`,
            occurred_at: commitment.created_at,
          });
          log(`logged commitment to contact ${resolveDisplayName(contact)}`);
        }
      } catch (e) {
        log(`warn: contact interaction log failed: ${(e as Error).message}`);
      }
    }

    const sourceLabel = commitment.source_type === "x"
      ? `tweet ${commitment.source_id}`
      : `email ${commitment.source_id}`;
    const truncatedText = commitment.text.length > 150
      ? commitment.text.slice(0, 150) + "..."
      : commitment.text;

    const description = [
      `Verify completion of commitment detected in ${sourceLabel}:`,
      ``,
      `"${commitment.text}"`,
      ``,
      `Date: ${commitment.created_at}`,
      commitment.recipient ? `Recipient: ${commitment.recipient}` : "",
      ``,
      `Steps:`,
      `1. Review the original ${commitment.source_type === "x" ? "tweet" : "email"} for context`,
      `2. Check if the promised action was completed`,
      `3. If completed, close this task as completed with evidence`,
      `4. If not yet due, reschedule by updating scheduled_for`,
      `5. If overdue and incomplete, create a follow-up action task`,
    ].filter(Boolean).join("\n");

    const taskId = insertTaskIfNew(source, {
      subject: `Verify commitment: ${truncatedText}`,
      description,
      skills: '["review-commitments"]',
      priority: 6,
      model: "sonnet",
    });

    if (taskId !== null) {
      queued++;
      log(`task created for ${sourceLabel}`);
    }
  }

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (hookState?.version ?? 0) + 1,
    seen_tweet_ids: [...seenTweetIds].slice(-200),
    seen_email_ids: [...seenEmailIds].slice(-200),
    last_tweet_id: newestTweetId,
    last_commitments_found: commitments.length,
    last_tasks_created: queued,
  });

  log(`queued ${queued} verification task(s)`);
  return "ok";
}
