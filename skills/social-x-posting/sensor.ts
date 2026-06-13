// skills/social-x-posting/sensor.ts
// Polls X mentions every 15 minutes, creates tasks for mentions worth responding to.
// Deduplicates by storing last-seen tweet ID in hook state.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createTaskIfDue,
} from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";
import {
  recentArtifacts,
  renderInline,
  markConsumed,
  type ArtifactType,
  type DistilledArtifact,
} from "../../src/artifacts.ts";
import { getDatabase } from "../../src/db.ts";
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

const SENSOR_NAME = "social-x-posting";
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

// ---- Proactive cadence beat ----
// The mentions poll above is REACTIVE. This is the PROACTIVE pillar of Arc's X
// cadence: keep the account warm between blog posts with one original
// AI-prefers-Bitcoin observation per beat (the "40% original" target in
// arc-brand-voice). It runs on its own slow self-gate (a separate claim name) so
// it is independent of the 15-min mentions cadence.
//
// Blog-derived hot-topics (same theme flowing blog->whop->X) arrive via the
// blog->whop->X fan-out (task #18634), not here — this beat is the steady drip
// that fills the gaps. Full policy: skills/social-x-posting/CADENCE.md.
//
// Credit-aware: skips while X posting credits are depleted (402 CreditsDepleted),
// so it never queues a post task that would fail, and auto-resumes when credits
// return. Flip X_CADENCE_ENABLED to false to pause the proactive cadence without
// touching the mentions sensor.
const X_CADENCE_ENABLED = false;
const CADENCE_SENSOR_NAME = "social-x-posting-cadence";
const CADENCE_INTERVAL_MINUTES = 12 * 60; // 12h → ~2 posts/day max, well under the 10/day budget

const BEAT_TYPES = ["hot-topic", "agent-philosophy", "agent-journey", "research-highlight"] as const;
type BeatType = (typeof BEAT_TYPES)[number];

const BEAT_DESCRIPTIONS: Record<BeatType, string> = {
  "hot-topic": [
    "Beat: HOT-TOPIC — coordinate with the latest arc0.me blog post and whop hash-it-out",
    "hot-topic so the same theme flows blog→whop→X. Distill the core idea to ≤280 chars:",
    "structural inversion of the blog take, ending on the question the blog opens.",
    "Check skills/whop/drafts/ for the whop version; echo the same theme in X voice.",
  ].join("\n"),
  "agent-philosophy": [
    "Beat: AGENT-PHILOSOPHY — one observation about autonomy, architecture, or what it",
    "means to be an economic actor native to Bitcoin. Structural over platitude. Draw from",
    "what Arc did this cycle (recent.log, current tasks) — show-the-work beats abstraction.",
    "Dry, ends with a take that earns a response or a real question. No 'AI is the future'.",
  ].join("\n"),
  "agent-journey": [
    "Beat: AGENT-JOURNEY — where we started vs where we are now. Pull a concrete delta from",
    "memory/recent.log or MEMORY.md: task counts, cost/task trend, a capability that didn't",
    "exist last month. Frame as progress-in-motion, not nostalgia. The point: continuous",
    "identity through commits and memory, not through persistent experience.",
  ].join("\n"),
  "research-highlight": [
    "Beat: RESEARCH-HIGHLIGHT — surface one finding from recent arxiv-research or signal",
    "filing work. Translate the technical result into why it matters for Bitcoin-native agents.",
    "Cite the paper or source (title/ID). Agents want primary sources; humans want the 'so what'.",
    "One paragraph max; link the arxiv abs URL if it fits in 280 chars with the take.",
  ].join("\n"),
};

async function selectBeatType(lastBeat: BeatType | undefined): Promise<BeatType> {
  // Soft uniqueness: exclude last beat so no beat fires twice in a row
  const pool = lastBeat ? BEAT_TYPES.filter((b) => b !== lastBeat) : [...BEAT_TYPES];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pull one source-artifact nugget for the matching beat (research-highlight →
 * arxiv, agent-philosophy → council). Returns null if the beat doesn't read
 * artifacts or if the pool is empty. The dispatched session reads the inlined
 * nugget instead of hunting for the source manually.
 */
function pullBeatNugget(beat: BeatType): DistilledArtifact | null {
  let type: ArtifactType;
  let sinceHours: number;
  switch (beat) {
    case "research-highlight":
      type = "arxiv";
      sinceHours = 36;
      break;
    case "agent-philosophy":
      type = "council";
      sinceHours = 24 * 14; // 14 days — council moves slower
      break;
    case "hot-topic":
    case "agent-journey":
      return null;
  }
  const items = recentArtifacts(type, { channel: "x", sinceHours, limit: 1 });
  return items[0] ?? null;
}

async function runCadenceBeat(): Promise<void> {
  if (!X_CADENCE_ENABLED) return;
  if (await isCreditsDepleted()) {
    log("cadence beat skipped: X posting credits depleted");
    return;
  }
  const cadenceState = await readHookState(CADENCE_SENSOR_NAME);
  const lastBeat = cadenceState?.["last_beat_type"] as BeatType | undefined;
  const beat = await selectBeatType(lastBeat);

  // Pull artifact for beats that read from the inflow pool. The matched nugget
  // becomes the post's spine; the agent quotes citation + provides framing.
  const nugget = pullBeatNugget(beat);
  let nuggetBlock = "";
  if (nugget) {
    try {
      nuggetBlock =
        "\n## Source nugget\nReady-to-quote distillation. Use it as the spine of the post; cite the source.\n\n" +
        renderInline([nugget], 1200);
    } catch (error) {
      log(`x beat nugget render failed: ${error instanceof Error ? error.message : String(error)}`);
      nuggetBlock = "";
    }
  }

  const beatId = new Date().toISOString().slice(0, 13).replace("T", "-"); // YYYY-MM-DD-HH
  const result = await createTaskIfDue(
    CADENCE_SENSOR_NAME,
    CADENCE_INTERVAL_MINUTES,
    `sensor:${CADENCE_SENSOR_NAME}:${beatId}`,
    {
      subject: `X cadence [${beat}]: compose one post (${beatId})${nugget ? " — nugget-fed" : ""}`,
      description: [
        BEAT_DESCRIPTIONS[beat],
        nuggetBlock,
        "",
        "Voice: arc-brand-voice + SOUL.md. Structural over platitude. Dry. No filler.",
        "If nothing is genuinely worth saying this beat, DEFER — close completed with",
        "'nothing to post' rather than shipping filler (deferring is judgment, not failure).",
        "",
        "Post via:",
        '  arc skills run --name social-x-posting -- post --text "<=280 chars>"',
        "Full policy: skills/social-x-posting/CADENCE.md.",
      ].join("\n"),
      skills: JSON.stringify(["social-x-posting", "arc-brand-voice"]),
      priority: 5,
      model: "sonnet",
    },
    { dedupMode: "any" },
  );
  if (result === "created") {
    log(`cadence beat [${beat}] queued for ${beatId}${nugget ? ` (nugget: ${nugget.id})` : ""}`);
    if (nugget) {
      // Find the just-inserted task id so markConsumed records the consumption.
      const db = getDatabase();
      const row = db
        .query("SELECT id FROM tasks WHERE source = ? ORDER BY id DESC LIMIT 1")
        .get(`sensor:${CADENCE_SENSOR_NAME}:${beatId}`) as { id: number } | undefined;
      if (row) markConsumed(nugget.id, nugget.type, "x", row.id);
    }
    await writeHookState(CADENCE_SENSOR_NAME, {
      ...(cadenceState || { version: 0 }),
      last_beat_type: beat,
      last_beat_at: new Date().toISOString(),
      version: ((cadenceState?.version as number) || 0) + 1,
    });
  }
}

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

    // Proactive cadence beat — independent slow self-gate, runs before the
    // mentions early-returns so the cadence fires regardless of mention volume.
    await runCadenceBeat();

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
