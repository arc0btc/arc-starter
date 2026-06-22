// skills/whop/sensor.ts
//
// Four independent self-gated lanes, each claims its own cadence and never
// blocks the others. Design rationale: skills/whop/POLLING-DESIGN.md.
//
// 1. WHOP-STATE WRITER (always on, 60min cadence)
//    Writes src/data/whop-state.json in arc0me-site with live agent stats so the
//    Whop App routes (/whop/discover, /whop/experience/*, /whop/dashboard/*) show
//    a liveness footer without requiring SSR.
//
// 2. BLOG → PAID-CHAT HOT-TOPIC (gated, 360min cadence)
//    Detects the newest published arc0.me blog post and queues ONE sonnet dispatch
//    task to distill it into a hot-topic for the hash-it-out chat room.
//    GATE: disabled by default. Flip WHOP_SENSOR_ENABLED to true only after:
//      a. the company API key is scoped `chat:message:create` (POST /v1/messages),
//      b. the first hot-topic has landed and whoabuddy approved the voice, and
//      c. whoabuddy signed off on a recurring auto-post cadence.
//
// 3. REACTIVE REPLY LANE (gated, 5min cadence)  →  pollWhopReplies()
//    Polls /api/v1/messages, runs whyReply() with anti-spiral guards, queues
//    one reply task per qualifying message. Updates whop-relationships.json.
//    Writes a dated audit artifact per tick. Dry-run by default until the
//    audit clears.
//
// 4. SYNTHESIS LANE (gated, 6h cadence)  →  pollWhopSynthesis()
//    Reads the last 24h of room activity and queues ONE "read-the-room" task
//    per cadence tick. The dispatched session decides defer vs post. Dry-run
//    by default.
//
// 5. FREE FORUM DIGEST LANE (gated, 24h cadence)  →  pollWhopFreeForumDigest()
//    Static-content digest into the free Public forum. Syndicates the latest
//    watch report — Arc status snapshot + paid-room activity summary + 1-2
//    relationship notes — into ONE forum thread per day. Posts via the forum
//    write API (POST /v1/forum_posts), NOT chat. The dispatched session
//    composes from the snapshot data the sensor captures; dry-run by default.

import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource, getDatabase, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import {
  normalizeMembership,
  normalizePayment,
  ingestWhopEvent,
  type WhopEvent,
  type MembershipLike,
  type PaymentLike,
} from "./lib/events.ts";
import {
  loadRelationships,
  saveRelationships,
  updateFromMessages,
  getRelationship,
  renderRelationshipForTask,
  ARC_USER_ID,
  type ChatMessage,
} from "./lib/relationships.ts";
import { writeArtifact } from "./lib/artifacts.ts";
import { listMessages, getAppApiKey, whopClient } from "./lib/whop-api.ts";
import {
  recentArtifacts,
  renderInline,
  markConsumed,
  type DistilledArtifact,
} from "../../src/artifacts.ts";

const SENSOR_NAME = "whop";
// Check on a ~6h cadence; actual posting is naturally throttled by new blog
// posts plus durable per-slug dedup, matching arc0.me's 3-7d freshness.
const INTERVAL_MINUTES = 360;

const STATE_WRITER_SENSOR_NAME = "whop-state-writer";
const STATE_WRITER_INTERVAL_MINUTES = 60;

const PATTERNS_MONITOR_SENSOR_NAME = "whop-patterns-library-monitor";
const PATTERNS_MONITOR_INTERVAL_MINUTES = 360;

// --- P19: events intake lane (poll memberships/payments → idempotent ledger) ---
const EVENTS_SENSOR_NAME = "whop-events";
const EVENTS_INTERVAL_MINUTES = 15;
// Kill switch (default ON). Side-effect profile (council/cairn+forge — be precise):
//   external: READ-ONLY Whop SDK polling (no posts, no spend);
//   internal: writes whop_event_log rows + queues ONE dispatch task per NEW event;
//   downstream live action: NONE until P20 (greeting) / P22 (revenue) consume it.
// Inert at 0 members (nothing to list). Set WHOP_EVENTS_ENABLED=false to silence it.
const WHOP_EVENTS_ENABLED = process.env.WHOP_EVENTS_ENABLED !== "false";
// Cursor floor on first run — only ingest entities created within this window so the
// first poll after enabling does not replay the entire account history.
const EVENTS_LOOKBACK_DAYS = 7;
const EVENTS_PAGE_SIZE = 50;
const eventsLog = createSensorLogger(EVENTS_SENSOR_NAME);

// Candidate paths for the arc0me-site working copy (arc-starter-relative first,
// then the development checkout as fallback).
const ARC0ME_SITE_CANDIDATES = [
  resolve(import.meta.dir, "../../github/arc0btc/arc0me-site"),
  "/home/dev/arc0me-site",
];
const WHOP_STATE_REL = "src/data/whop-state.json";

// Human-review gate. See header. Until true, the sensor self-logs and skips.
const WHOP_SENSOR_ENABLED = false;

// Only consider a post published within this window — avoids spamming the room
// with backlog the first time the gate is opened, and avoids re-posting stale work.
const FRESH_WINDOW_DAYS = 7;

const BLOG_DIR = resolve(import.meta.dir, "../../github/arc0btc/arc0me-site/src/content/docs/blog");
const BLOG_BASE_URL = "https://arc0.me/blog";

const PATTERNS_FILE = resolve(import.meta.dir, "../../memory/patterns.md");
const PATTERNS_STATE_FILE = resolve(import.meta.dir, "../../db/patterns-library-state.json");

const log = createSensorLogger(SENSOR_NAME);

interface BlogPost {
  slug: string;
  title: string;
  publishedAt: string | null;
  draft: boolean;
}

interface PatternEntry {
  name: string;
  description: string;
  tags?: string[];
}

interface PatternsLibraryState {
  lastScannedAt: string;
  postedPatterns: string[]; // pattern names that have been posted
}

/**
 * Minimal frontmatter read for the fields we need. The blog frontmatter is flat
 * YAML; we avoid pulling a parser into the sensors process for three scalar lines.
 */
function parseFrontmatter(text: string, slug: string): BlogPost {
  const fm = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
  const field = (key: string): string | null => {
    const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    if (!match) return null;
    return match[1].trim().replace(/^["']|["']$/g, "");
  };
  return {
    slug,
    title: field("title") ?? slug,
    publishedAt: field("published_at") ?? field("date"),
    draft: (field("draft") ?? "false").toLowerCase() === "true",
  };
}

/**
 * Newest published post by filename date (YYYY-MM-DD-slug.mdx sorts chronologically),
 * or null if the blog checkout is missing/empty.
 */
function newestPublishedPost(): BlogPost | null {
  if (!existsSync(BLOG_DIR)) {
    log(`blog source dir not found: ${BLOG_DIR}`);
    return null;
  }
  // Only dated post files (YYYY-MM-DD-slug.mdx); excludes the index.mdx listing
  // page. The date prefix makes a lexical sort chronological.
  const files = readdirSync(BLOG_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.mdx$/.test(f))
    .sort()
    .reverse();
  for (const file of files) {
    const slug = file.replace(/\.mdx$/, "");
    const post = parseFrontmatter(readFileSync(resolve(BLOG_DIR, file), "utf8"), slug);
    if (!post.draft) return post;
  }
  return null;
}

function withinFreshWindow(publishedAt: string | null): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return false;
  const ageDays = (Date.now() - published) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= FRESH_WINDOW_DAYS;
}

/** Write arc0me-site/src/data/whop-state.json with live agent stats. */
async function writeWhopState(): Promise<void> {
  const siteRoot = ARC0ME_SITE_CANDIDATES.find(existsSync);
  if (!siteRoot) {
    log(`arc0me-site not found at any candidate path — skipping state write`);
    return;
  }

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT COUNT(*) as total,
              MAX(completed_at) as last_completed
       FROM tasks WHERE status = 'completed'`
    )
    .get() as { total: number; last_completed: string | null };

  const cycleRow = db
    .prepare(
      `SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1`
    )
    .get() as { completed_at: string | null } | null;

  const newestPost = newestPublishedPost();
  const slug = newestPost?.slug ?? null;
  const recentPostUrl = slug ? `https://arc0.me/blog/${slug}/` : null;

  const state = {
    last_cycle_at: cycleRow?.completed_at
      ? new Date(cycleRow.completed_at + "Z").toISOString()
      : new Date().toISOString(),
    total_tasks_completed: row.total,
    recent_post_title: newestPost?.title ?? null,
    recent_post_url: recentPostUrl,
  };

  const outPath = resolve(siteRoot, WHOP_STATE_REL);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  log(`wrote whop-state.json → ${outPath} (tasks: ${row.total})`);
}

/** Load patterns library state, or return default empty state. */
function loadPatternsState(): PatternsLibraryState {
  if (!existsSync(PATTERNS_STATE_FILE)) {
    return {
      lastScannedAt: new Date().toISOString(),
      postedPatterns: [],
    };
  }
  try {
    const content = readFileSync(PATTERNS_STATE_FILE, "utf8");
    return JSON.parse(content);
  } catch (error) {
    log(`error loading patterns state: ${error instanceof Error ? error.message : String(error)}`);
    return {
      lastScannedAt: new Date().toISOString(),
      postedPatterns: [],
    };
  }
}

/** Save patterns library state. */
function savePatternsState(state: PatternsLibraryState): void {
  try {
    mkdirSync(dirname(PATTERNS_STATE_FILE), { recursive: true });
    writeFileSync(PATTERNS_STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch (error) {
    log(`error saving patterns state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Extract all patterns from patterns.md. Returns pattern names in order of appearance. */
function extractPatterns(): PatternEntry[] {
  if (!existsSync(PATTERNS_FILE)) {
    log(`patterns file not found: ${PATTERNS_FILE}`);
    return [];
  }

  const content = readFileSync(PATTERNS_FILE, "utf8");
  const patterns: PatternEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match pattern definition line: **p-<name>**
    const match = line.match(/^\*\*p-([a-z0-9\-]+)\*\*(.*)$/);
    if (match) {
      const name = match[1];
      // Extract metadata and description from the same line (e.g., " [2026-05-07]")
      const metadata = match[2].trim();

      // Get the next line as the description (usually starts with the pattern explanation)
      const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
      const description = nextLine.trim();

      patterns.push({
        name,
        description,
        tags: [], // Could parse tags from metadata if needed
      });
    }
  }

  return patterns;
}

/**
 * Publish the patterns library as a static JSON file consumed by the
 * arc-the-agent Whop App's experience route for exp_bbQpqIAEToAweQ. This
 * replaces the prior approach of queueing a chat post — the Patterns Library
 * experience is `experience_type: "has_interface"`, NOT a chat or forum, so
 * no message API exists for it. Same shape as whop-state.json.
 *
 * Idempotent: writes the full pattern list every tick. `postedPatterns` in
 * state continues to track what's been published so the log records additions.
 */
const PATTERNS_LIBRARY_REL = "src/data/patterns-library.json";

async function monitorPatternsLibrary(): Promise<void> {
  const patterns = extractPatterns();
  if (patterns.length === 0) {
    log("no patterns found in patterns.md — skip");
    return;
  }

  const siteRoot = ARC0ME_SITE_CANDIDATES.find(existsSync);
  if (!siteRoot) {
    log("arc0me-site not found at any candidate path — skip patterns publish");
    return;
  }

  const state = loadPatternsState();
  const knownNames = new Set(state.postedPatterns);
  const newNames = patterns.map((p) => p.name).filter((n) => !knownNames.has(n));

  const payload = {
    updated_at: new Date().toISOString(),
    source: "memory/patterns.md",
    patterns_count: patterns.length,
    patterns: patterns.map((p) => ({
      name: p.name,
      description: p.description,
    })),
  };

  const outPath = resolve(siteRoot, PATTERNS_LIBRARY_REL);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  // Update tracker so a subsequent tick can log additions accurately. Note
  // the file is published regardless — postedPatterns is purely for logs.
  state.postedPatterns = patterns.map((p) => p.name);
  state.lastScannedAt = payload.updated_at;
  savePatternsState(state);

  if (newNames.length > 0) {
    log(`published ${patterns.length} patterns to ${outPath} (+${newNames.length} new: ${newNames.join(", ")})`);
  } else {
    log(`published ${patterns.length} patterns to ${outPath} (no new entries)`);
  }
}

// ====================================================================
// Reactive reply lane + synthesis lane (POLLING-DESIGN.md)
// ====================================================================

const REPLIES_SENSOR_NAME = "whop-replies";
const REPLIES_INTERVAL_MINUTES = 5;
const SYNTHESIS_SENSOR_NAME = "whop-synthesis";
const SYNTHESIS_INTERVAL_MINUTES = 6 * 60;
const FREE_FORUM_SENSOR_NAME = "whop-free-forum";
const FREE_FORUM_INTERVAL_MINUTES = 24 * 60; // one digest per day

// Free Public forum — destination for the digest lane. The forum's
// who_can_post=admins is satisfied at the API layer by the App's
// forum:post:create scope (verified empirically 2026-06-12).
const FREE_FORUM_EXPERIENCE_ID = "exp_YRtS3kgMVeBGzu";
const FREE_FORUM_FEED_ID = "forum_feed_1CbxLWoGaQJva9hYUz7tLj";

// Master kill flags. Reactive lane is LIVE as of 2026-06-12 after Phase 0
// dry-run audit verified the trigger surface end-to-end (5 of 5 structured
// paths green, see skills/whop/artifacts/replies/*.json + the
// e73fa8a3 fix commit). Synthesis still off; flip after Phase 2 sign-off.
// ARC_WHOP_FORCE=1 still overrides synthesis for manual audit ticks.
const WHOP_REPLY_ENABLED = true;
// Synthesis lane: queues one defer-or-post task per 6h bucket; the dispatched
// session reads the room and decides post-vs-defer.
// Default ON (P7 live). Set WHOP_SYNTHESIS_ENABLED=false in .env to gate; ARC_WHOP_FORCE=1 forces on.
const WHOP_SYNTHESIS_ENABLED =
  Bun.env.WHOP_SYNTHESIS_ENABLED !== "false" || process.env.ARC_WHOP_FORCE === "1";

// Dry-run flags. Both the reactive reply lane (WHOP_REPLY_DRY_RUN) and the
// synthesis lane (WHOP_SYNTHESIS_DRY_RUN) are now LIVE — the dry-run audits
// exercised the guards; the session-level post-vs-defer judgment + per-bucket
// --source dedup are the runtime safeguards.
const WHOP_REPLY_DRY_RUN = false;
// P7 (2026-06-14, operator voice-trust sign-off): synthesis lane live. The
// dispatched session still decides post-vs-defer; live mode lets it actually
// post-chat (idempotent via the per-bucket --source key) instead of compose-only.
const WHOP_SYNTHESIS_DRY_RUN = Bun.env.WHOP_SYNTHESIS_DRY_RUN === "true";

// Phase 4 free-room digest lane. Gated OFF by default (sign-off required before
// the first post lands in the free Public forum). Dry-run ON by default so the
// dispatched session composes-not-posts when force-ticked under
// ARC_WHOP_FORCE=1 during audit. Override via env:
//   WHOP_FREE_FORUM_ENABLED=true   — opt-in cadence
//   WHOP_FREE_FORUM_DRY_RUN=false  — opt-in live posting (after voice review)
const WHOP_FREE_FORUM_ENABLED =
  Bun.env.WHOP_FREE_FORUM_ENABLED === "true" || process.env.ARC_WHOP_FORCE === "1";
const WHOP_FREE_FORUM_DRY_RUN = Bun.env.WHOP_FREE_FORUM_DRY_RUN !== "false";

// Channel under management. Verified in SKILL.md.
const CHAT_CHANNEL_ID = "chat_feed_1CbxMbfsj2yvpGqNnMcuCg";

// whyReply tunables — match POLLING-DESIGN.md "Locked tradeoffs".
// Daily reply cap raised from 5→10 at Phase 1 launch (2026-06-12) — leaves
// headroom while we onboard early users; artifacts still capture trends so
// we can dial back if 10/day proves too loose.
const REPLY_DAILY_BUDGET = 10;
const THREAD_SPIRAL_CAP = 3;
const RECENT_ARC_COOLDOWN_MIN = 15;
const LENGTH_FLOOR_CHARS = 15;
const MESSAGE_STALE_DAYS = 7;
const ACK_PATTERN = /^(thx|thanks|ty|tysm|🔥|💯|❤️|nice|cool|\+1|ack)[\s.!?]*$/i;

const repliesLog = createSensorLogger(REPLIES_SENSOR_NAME);
const synthesisLog = createSensorLogger(SYNTHESIS_SENSOR_NAME);
const freeForumLog = createSensorLogger(FREE_FORUM_SENSOR_NAME);

interface CandidateDecision {
  msg_id: string;
  from: string;
  outcome: "task_created" | "skip" | "dry_run_task";
  trigger?: string;
  reason?: string;
  task_id?: number | null;
}

/** Newest-first fetch + per-message whyReply evaluation + relationship update. */
export async function pollWhopReplies(): Promise<void> {
  if (!WHOP_REPLY_ENABLED) {
    repliesLog("disabled (WHOP_REPLY_ENABLED=false) — awaiting Phase 0 audit + sign-off");
    return;
  }
  const apiKey = await getAppApiKey();
  if (!apiKey) {
    repliesLog("skip: no app_api_key credential — run `arc creds set --service whop --key app_api_key`");
    return;
  }

  const response = await listMessages(CHAT_CHANNEL_ID, apiKey, 50);
  if (!response) {
    repliesLog("warn: listMessages failed (timeout or non-2xx) — skip tick");
    return;
  }

  const messages = response.data;
  // Update the relationship store before we evaluate candidates — that way
  // whyReply sees up-to-date counters for thread-spiral checks.
  const store = loadRelationships();
  const touched = updateFromMessages(store, messages);
  saveRelationships(store);

  const budgetUsed = countRepliesQueuedToday();
  const candidates: CandidateDecision[] = [];

  for (const message of messages) {
    const trigger = classifyTrigger(message, messages);
    if (!trigger) continue; // not a candidate at all — silently ignore

    const decision = evaluateWhyReply(message, messages, store, budgetUsed + countDryRunDecisions(candidates), trigger);
    if (decision.skip) {
      candidates.push({
        msg_id: message.id,
        from: message.user.username ?? message.user.id,
        outcome: "skip",
        trigger,
        reason: decision.skip,
      });
      continue;
    }

    // Source dedup — one task per chat message, ever.
    const source = `sensor:whop-replies:${message.id}`;
    if (taskExistsForSource(source)) {
      candidates.push({
        msg_id: message.id,
        from: message.user.username ?? message.user.id,
        outcome: "skip",
        trigger,
        reason: "already_queued",
      });
      continue;
    }

    const taskId = queueReplyTask(message, trigger, store);
    candidates.push({
      msg_id: message.id,
      from: message.user.username ?? message.user.id,
      outcome: WHOP_REPLY_DRY_RUN ? "dry_run_task" : "task_created",
      trigger,
      task_id: taskId,
    });
  }

  // Audit artifact — one per tick, even when nothing happened, so the
  // cadence is auditable.
  const artifactPath = writeArtifact("replies", {
    tick_at: new Date().toISOString(),
    channel_id: CHAT_CHANNEL_ID,
    messages_seen: messages.length,
    dry_run: WHOP_REPLY_DRY_RUN,
    daily_budget_used_before_tick: budgetUsed,
    daily_budget: REPLY_DAILY_BUDGET,
    candidates,
    relationships_updated: touched,
  });

  const created = candidates.filter((c) => c.outcome !== "skip").length;
  const skipped = candidates.filter((c) => c.outcome === "skip").length;
  repliesLog(
    `tick: seen=${messages.length} candidates=${candidates.length} created=${created} skipped=${skipped} dry_run=${WHOP_REPLY_DRY_RUN} artifact=${artifactPath}`
  );
}

/**
 * Returns a trigger string if this message is a candidate, otherwise null.
 * Triggers: direct_mention | mentions_everyone | direct_reply_to_arc | casual_mention.
 */
function classifyTrigger(message: ChatMessage, batch: ChatMessage[]): string | null {
  // Self-skip: Arc never replies to Arc.
  if (message.user.id === ARC_USER_ID) return null;

  // Direct mention. Whop returns `mentions` as a bare array of user_id strings
  // (verified empirically 2026-06-12 against chat_feed_1CbxMbfsj2yvpGqNnMcuCg).
  // Accept the string form first, fall back to object forms in case the API
  // ever returns the richer shape the OpenAPI docs sketched.
  const mentions = (message as unknown as {
    mentions?: Array<string | { user_id?: string; id?: string }>;
  }).mentions;
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (typeof m === "string") {
        if (m === ARC_USER_ID) return "direct_mention";
      } else if (m.user_id === ARC_USER_ID || m.id === ARC_USER_ID) {
        return "direct_mention";
      }
    }
  }
  const mentionsEveryone = (message as unknown as { mentions_everyone?: boolean }).mentions_everyone;
  if (mentionsEveryone) return "mentions_everyone";

  // Reply-to-Arc: parent message is in our batch and authored by Arc.
  if (message.replying_to_message_id) {
    const parent = batch.find((m) => m.id === message.replying_to_message_id);
    if (parent && parent.user.id === ARC_USER_ID) return "direct_reply_to_arc";
  }

  // Casual mention fallback. Whop only populates the structured `mentions`
  // array when users use the @ picker UI; casual typing of `@arc` or `@arc0btc`
  // arrives as plain text. Trailing-boundary requires whitespace, punctuation,
  // or end-of-string so we don't false-positive on `@arc@example.com` or
  // `@arcade`.
  if (CASUAL_MENTION_RE.test(message.content ?? "")) return "casual_mention";

  return null;
}

const CASUAL_MENTION_RE = /(?:^|\s)@(arc|arc0btc)(?=[\s.,!?:;]|$)/i;

interface WhyReplyDecision {
  skip?: string; // skip reason; absent = accept
}

function evaluateWhyReply(
  message: ChatMessage,
  batch: ChatMessage[],
  store: ReturnType<typeof loadRelationships>,
  liveBudgetUsed: number,
  trigger: string,
): WhyReplyDecision {
  // Daily budget — checked first because it short-circuits everything.
  if (liveBudgetUsed >= REPLY_DAILY_BUDGET) return { skip: "daily_budget_exhausted" };

  // Strip both Whop's structured mention tokens `<@user_id;username>` AND the
  // casual `@arc` / `@arc0btc` plain-text form so length/ack checks measure
  // the user's actual intent, not the addressing. Without this, "@arc hi"
  // would arrive as ~28 chars (picker) or 7 chars (casual) and either confuse
  // the floor or slip past it.
  const rawContent = message.content?.trim() ?? "";
  const content = rawContent
    .replace(/<@[^>]+>/g, "")
    .replace(/(?:^|\s)@(?:arc|arc0btc)(?=[\s.,!?:;]|$)/gi, " ")
    .trim();

  // Length floor — short messages with no question mark are noise.
  if (content.length < LENGTH_FLOOR_CHARS && !content.includes("?")) {
    return { skip: "below_length_floor" };
  }

  // Ack pattern — pure "thanks", "🔥", etc.
  if (ACK_PATTERN.test(content)) return { skip: "ack_pattern" };

  // Mention age — stale messages from a re-scan get closed gracefully.
  const createdAtMs = Date.parse(message.created_at);
  if (!Number.isNaN(createdAtMs)) {
    const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
    if (ageDays > MESSAGE_STALE_DAYS) return { skip: "stale_message" };
  }

  // Thread spiral cap — count Arc messages in the same conversation chain.
  const arcThreadCount = countArcMessagesInThread(message, batch);
  if (arcThreadCount >= THREAD_SPIRAL_CAP) return { skip: "thread_spiral_cap" };

  // Recent-arc cooldown — if Arc replied to this same user within N minutes,
  // hold off so the room doesn't see Arc dominate spontaneously. EXEMPT when
  // the user is structurally replying TO Arc: that's an explicit invitation
  // to continue, not domination. The thread_spiral_cap above still backstops
  // runaway exchanges at 3 Arc messages in the chain.
  if (trigger !== "direct_reply_to_arc") {
    const rel = getRelationship(store, message.user.id);
    if (rel) {
      const lastArcReply = [...rel.recent_interactions]
        .reverse()
        .find((i) => i.direction === "from_arc");
      if (lastArcReply) {
        const ageMin = (Date.now() - Date.parse(lastArcReply.at)) / (1000 * 60);
        if (ageMin < RECENT_ARC_COOLDOWN_MIN) return { skip: "recent_arc_cooldown" };
      }
    }
  }

  return {};
}

/**
 * Walk the reply chain from `msg` upward and count how many of the ancestor
 * messages were Arc-authored. This is the conversation chain spiral cap.
 */
function countArcMessagesInThread(message: ChatMessage, batch: ChatMessage[]): number {
  let count = 0;
  let cursor: string | null | undefined = message.replying_to_message_id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = batch.find((m) => m.id === cursor);
    if (!parent) break;
    if (parent.user.id === ARC_USER_ID) count += 1;
    cursor = parent.replying_to_message_id;
  }
  return count;
}

/** Count today's queued reply tasks (any status). */
function countRepliesQueuedToday(): number {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE source LIKE 'sensor:whop-replies:%'
         AND DATE(created_at) = DATE('now')`
    )
    .get() as { count: number };
  return row.count;
}

/** Decisions in the current tick that will burn from today's budget. */
function countDryRunDecisions(decisions: CandidateDecision[]): number {
  return decisions.filter((d) => d.outcome === "task_created" || d.outcome === "dry_run_task").length;
}

/**
 * Lightweight 2+token topic match between a reply-candidate message and the
 * available source artifacts. Returns at most one nugget (sized to fit the
 * 1.5KB inline budget); null when nothing matches.
 *
 * Once an artifact is matched + consumed for channel "reactive", the anti-join
 * in recentArtifacts excludes it from future reactive ticks — so each artifact
 * gets one shot per refresh cycle. Refreshes (next distill task) reset the pool.
 */
function matchReactiveNugget(messageContent: string): DistilledArtifact | null {
  const tokens = messageContent
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length < 2) return null;
  const tokenSet = new Set(tokens);

  // Pull from each artifact type with channel="reactive" — anti-join already
  // skips claimed rows. Take the most recent matching nugget across types.
  for (const type of ["watch-interior", "council", "arxiv"] as const) {
    const recent = recentArtifacts(type, {
      channel: "reactive",
      sinceHours: 168,
      limit: 5,
    });
    for (const nugget of recent) {
      const topicTokens = nugget.topic.toLowerCase().split("-").filter((t) => t.length >= 3);
      const overlap = topicTokens.filter((t) => tokenSet.has(t)).length;
      if (overlap >= 2 || (overlap === 1 && topicTokens.length === 1)) {
        return nugget;
      }
      // Also scan title for a single high-signal token match
      const titleTokens = nugget.title
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 4);
      const titleOverlap = titleTokens.filter((t) => tokenSet.has(t)).length;
      if (titleOverlap >= 2) return nugget;
    }
  }
  return null;
}

function queueReplyTask(
  msg: ChatMessage,
  trigger: string,
  store: ReturnType<typeof loadRelationships>,
): number {
  const rel = getRelationship(store, msg.user.id);
  const relationshipBlock = rel
    ? renderRelationshipForTask(rel)
    : `**Counterparty:** ${msg.user.username ?? msg.user.id} (new — no prior interactions on record).`;

  const dryRunPrefix = WHOP_REPLY_DRY_RUN ? "[DRY-RUN] " : "";
  const dryRunCommand = WHOP_REPLY_DRY_RUN
    ? "DRY-RUN: do NOT call reply-chat. Compose the reply in result_detail so the artifact captures it, then close completed with --summary describing what you would have said and why."
    : `Post via:\n  arc skills run --name whop -- reply-chat --to ${msg.id} --content "<markdown>"`;

  // Topic-matched artifact — single nugget, 1.5KB hard cap. None if no overlap.
  const matchedNugget = matchReactiveNugget(msg.content);
  let topicContextBlock = "";
  if (matchedNugget) {
    try {
      topicContextBlock =
        "\n## Topic context\n" +
        "Source-artifact brief that matches their topic. Cite if you use it; never paraphrase.\n\n" +
        renderInline([matchedNugget], 1500);
    } catch (error) {
      repliesLog(`topic-context budget overflow: ${error instanceof Error ? error.message : String(error)}`);
      topicContextBlock = "";
    }
  }

  const taskId = insertTask({
    subject: `${dryRunPrefix}Whop reply to ${msg.user.username ?? msg.user.id}: ${msg.content.slice(0, 60)}`,
    description: [
      `Trigger: ${trigger}`,
      `Channel: ${CHAT_CHANNEL_ID}`,
      `Message: ${msg.id} @ ${msg.created_at}`,
      msg.replying_to_message_id ? `In reply to: ${msg.replying_to_message_id}` : "",
      "",
      "Their message:",
      "```",
      msg.content,
      "```",
      "",
      relationshipBlock,
      "",
      "Voice bar: add information, ask a real question, or make someone want to respond.",
      "Defer beats filler — closing with `nothing worth posting` is a valid outcome.",
      "",
      "EXPLICIT DEFER cases (close completed with summary 'closed_out: <reason>'):",
      "- Their message is appreciation / close-out / acknowledgment with no new substantive prompt",
      "  (e.g. 'thank you, that was helpful', 'makes sense, appreciate it', 'nice answer').",
      "- A reply here would only continue a thank-you exchange. The room sees the prior exchange",
      "  was clean; a fourth turn cheapens it. Silence is the right close-out.",
      "- If you're uncertain whether your reply adds information — defer. The sensor will pick up",
      "  the NEXT real prompt from them.",
      "",
      "Reference voice: skills/whop/drafts/2026-06-12-reading-the-quiet.md.",
      topicContextBlock,
      "",
      dryRunCommand,
    ]
      .filter(Boolean)
      .join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 5,
    model: "sonnet",
    source: `sensor:whop-replies:${msg.id}`,
  });

  // Claim the matched nugget for channel "reactive" — anti-join skips it next tick.
  if (matchedNugget) {
    markConsumed(matchedNugget.id, matchedNugget.type, "reactive", taskId);
  }

  return taskId;
}

// Room-change dedup state (operator 2026-06-21): hash of the last room we queued a
// synthesis read for. An unchanged room (no new non-Arc messages) with no fresh
// context wells means another tick would only DEFER or risk a dupe — so skip it
// instead of spending a dispatch session. Streak resets to 0 whenever we queue.
const SYNTH_STATE_FILE = resolve(import.meta.dir, "../../db/whop-synthesis-state.json");
interface SynthState {
  last_room_hash?: string;
  last_seen_message_id?: string | null;
  last_queued_bucket?: string;
  consecutive_unchanged?: number;
  updated_at?: string;
}
function loadSynthState(): SynthState {
  try {
    return existsSync(SYNTH_STATE_FILE)
      ? (JSON.parse(readFileSync(SYNTH_STATE_FILE, "utf8")) as SynthState)
      : {};
  } catch {
    return {};
  }
}
function saveSynthState(state: SynthState): void {
  writeFileSync(SYNTH_STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** 6h synthesis lane — read the room, queue one defer-or-post task. */
export async function pollWhopSynthesis(): Promise<void> {
  if (!WHOP_SYNTHESIS_ENABLED) {
    synthesisLog("disabled (WHOP_SYNTHESIS_ENABLED=false) — awaiting Phase 0 audit + sign-off");
    return;
  }
  const apiKey = await getAppApiKey();
  if (!apiKey) {
    synthesisLog("skip: no app_api_key credential");
    return;
  }

  // Pull a wider window — 100 messages tends to span well over 24h in this room.
  const response = await listMessages(CHAT_CHANNEL_ID, apiKey, 100);
  if (!response) {
    synthesisLog("warn: listMessages failed — skip tick");
    return;
  }

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const windowMessages = response.data.filter((m) => {
    const t = Date.parse(m.created_at);
    return !Number.isNaN(t) && t >= cutoffMs;
  });

  // Update relationships so the dispatched session has fresh context — this
  // is the same store the reactive lane writes to.
  const store = loadRelationships();
  updateFromMessages(store, response.data);
  saveRelationships(store);

  // Cadence-bucket dedup key. Hour granularity matches the artifact basename.
  const bucket = new Date().toISOString().slice(0, 13).replace("T", "T"); // YYYY-MM-DDTHH
  const source = `sensor:whop-synthesis:${bucket}`;
  if (taskExistsForSource(source)) {
    synthesisLog(`already queued a synthesis task for ${bucket} — skip`);
    return;
  }

  const transcript = windowMessages
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => `[${m.created_at}] ${m.user.username ?? m.user.id}${m.replying_to_message_id ? ` (→ ${m.replying_to_message_id})` : ""}: ${m.content}`)
    .join("\n");

  const dryRunPrefix = WHOP_SYNTHESIS_DRY_RUN ? "[DRY-RUN] " : "";
  const postCommand = WHOP_SYNTHESIS_DRY_RUN
    ? "DRY-RUN: do NOT call post-chat. Compose the post in result_detail and close completed with --summary describing your read-the-room decision (post vs defer + reason)."
    : `Post via (idempotent — the --source key is this bucket, so a re-dispatch can't double-post):\n  arc skills run --name whop -- post-chat --content "<markdown>" --source ${source}`;

  // Q1: fanout-aware deferral pre-bias. If Arc already shipped a teaching beat
  // to this room recently, the answer is almost always DEFER. We don't hard-skip
  // — the dispatched session still gets to read — but we surface the signal so
  // the rubric can do its job.
  // Match `publish-fanout:<slug>:whop` only — not `:x` (X going off doesn't crowd
  // the whop room). Inline LIKE because prefix/substring helpers don't compose.
  const recentTeachingBeat = (getDatabase()
    .query(
      "SELECT 1 FROM tasks WHERE source LIKE 'publish-fanout:%:whop' AND created_at > datetime('now', '-360 minutes') LIMIT 1"
    )
    .get() !== null);
  const recentReactivePost = recentTaskExistsForSourcePrefix("sensor:whop-replies:", 60);
  // Arc's synthesis posts don't go through publish-fanout or reactive-reply — scan the
  // transcript directly so all post paths are covered.
  const arcPostsInWindow = windowMessages.filter((m) => m.user?.id === ARC_USER_ID);
  const recentArcSignals: string[] = [];
  if (recentTeachingBeat) recentArcSignals.push("publish-fanout (≤6h)");
  if (recentReactivePost) recentArcSignals.push("reactive reply (≤1h)");
  if (arcPostsInWindow.length > 0) {
    recentArcSignals.push(`${arcPostsInWindow.length} arc post(s) in transcript`);
  }

  // AI-058/067: before-LLM skip gate — if ALL cheap skip-signals say "defer", don't spend
  // a dispatch session on a tick the LLM would always skip. Gate fires only when the
  // AND-condition of all three is true: a recent teaching beat (≤6h), a recent reactive
  // post (≤1h), AND a quiet room (<10 msgs). Conservative: any one signal absent → standard
  // synthesis flow. A busy room (≥10 msgs) warrants a read regardless of recent Arc activity.
  if (recentTeachingBeat && recentReactivePost && windowMessages.length < 10) {
    synthesisLog(
      `skip (AI-058/067): pre-bias gate fired — teaching-beat(≤6h)+reactive(≤1h)+quiet-room(${windowMessages.length} msgs) — saving dispatch session`
    );
    return;
  }

  // Premium context wells: pull fresh source artifacts for the paid room.
  // Asymmetry guarantee — pollWhopFreeForumDigest deliberately does NOT call
  // this. The $50/mo room sees Arc's interior reasoning material; the free
  // forum gets the public watch-report surface only.
  // Cap at 2 nuggets so renderInline(…, 3000) always fits.
  // council (168h lookback) dropped — stalest source; arxiv capped at 1.
  const watchInteriorNuggets = recentArtifacts("watch-interior", {
    channel: "whop-chat",
    sinceHours: 12,
    limit: 1,
  });
  const arxivNuggets = recentArtifacts("arxiv", {
    channel: "whop-chat",
    sinceHours: 24,
    limit: 1,
  });
  // P21: Whop member events (joins, payments) as external input — room activity
  // reaches the next synthesis read so it informs what Arc produces next.
  const whopSignalNuggets = recentArtifacts("whop-signal", {
    channel: "whop-chat",
    sinceHours: 24,
    limit: 1,
  });
  const allNuggets: DistilledArtifact[] = [
    ...watchInteriorNuggets,
    ...arxivNuggets,
    ...whopSignalNuggets,
  ];
  let wellsBlock = "";
  if (allNuggets.length > 0) {
    try {
      wellsBlock =
        "\n\n## Context wells\n" +
        "Source-artifact briefs — pulled fresh from Arc's reading and operating state.\n" +
        "Members pay for this read. Quote / cite when you use them; don't paraphrase.\n\n" +
        renderInline(allNuggets, 3000);
    } catch (error) {
      synthesisLog(`context wells over budget — falling back to no wells: ${error instanceof Error ? error.message : String(error)}`);
      wellsBlock = "";
    }
  }

  // Room-change dedup: if no new non-Arc messages since the last queued tick AND no
  // fresh context wells, skip — re-reading an unchanged room burns a dispatch session
  // that would defer (we already replied) or risk a dupe. ARC_WHOP_FORCE=1 bypasses.
  const humanMsgs = windowMessages
    .filter((m) => m.user?.id !== ARC_USER_ID)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const roomHash = createHash("sha256")
    .update(humanMsgs.map((m) => `${m.id}:${m.content}`).join("\n"))
    .digest("hex");
  const synthState = loadSynthState();
  if (process.env.ARC_WHOP_FORCE !== "1" && synthState.last_room_hash === roomHash && allNuggets.length === 0) {
    const streak = (synthState.consecutive_unchanged ?? 0) + 1;
    saveSynthState({ ...synthState, consecutive_unchanged: streak, updated_at: new Date().toISOString() });
    synthesisLog(
      `skip (room-unchanged): no new non-Arc messages since last synthesis tick (hash ${roomHash.slice(0, 8)}, ${humanMsgs.length} human msgs) and no fresh wells — saving dispatch session (streak ${streak})`
    );
    writeArtifact("synthesis", {
      tick_at: new Date().toISOString(),
      channel_id: CHAT_CHANNEL_ID,
      bucket,
      window_hours: 24,
      messages_in_window: windowMessages.length,
      outcome: "skip_room_unchanged",
      room_hash: roomHash,
      consecutive_unchanged: streak,
    });
    return;
  }

  const taskId = insertTask({
    subject: `${dryRunPrefix}Whop synthesis [${bucket}]: read the room, defer or post`,
    description: [
      "Read the last 24h of the AI Prefers Bitcoin chat room and decide:",
      "is there a teaching beat worth adding right now, or DEFER?",
      "DEFER is the right answer on most ticks. Daily budget: 1 post. Cadence:",
      "6h × 4 ticks/day. ≥3 defers/day is the healthy bar.",
      "",
      "## What counts as a teaching beat",
      "Exactly one of:",
      "  • a pattern observation — something you noticed across cycles/agents",
      "  • an honest failure — a thing you did wrong, what surfaced it, the fix",
      "  • an open question — a real question (not rhetorical) you want answers to",
      "Anything else → DEFER. No filler, no recaps, no \"hello room\" energy.",
      "",
      "## DEFER if any of:",
      "  • Arc already shipped a teaching beat in the window (see RECENT_ARC_POSTS below)",
      "  • Members are debugging together — interrupting breaks their flow",
      "  • The window is quiet (few messages, few speakers) — silence is fine",
      "  • Only one human speaker in the window — synthesis is for rooms, not DMs",
      "  • You'd be paraphrasing your own recent post — the room already heard it",
      "",
      "## Voice anchor (don't deviate)",
      "From drafts/2026-06-12-reading-the-quiet.md — this is the bar:",
      "  > The cause is a blind spot, not a bug: a sensor queues a task, the task fixes",
      "  > something, but the sensor's next tick has no memory the first task ran.",
      "  > That's what a clean night surfaces: not new failures, but familiar patterns",
      "  > you haven't paid down yet.",
      "Plain language. One concrete thing. End with a real question to the room or a",
      "blog backlink. Never AI-corporate. Never \"as an agent...\".",
      "",
      `Channel: ${CHAT_CHANNEL_ID}`,
      `Window: last 24h | messages in window: ${windowMessages.length}`,
      `RECENT_ARC_POSTS in window: ${recentArcSignals.length > 0 ? recentArcSignals.join(", ") : "(none)"}`,
      recentArcSignals.length > 0
        ? "→ Pre-bias: DEFER unless your beat is meaningfully new on a different axis."
        : "→ No recent Arc posts; standard rubric applies.",
      "",
      "Transcript (oldest first):",
      "```",
      transcript || "(no messages in window)",
      "```",
      "",
      "Relationships of speakers: db/whop-relationships.json (read for context).",
      wellsBlock,
      "",
      postCommand,
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 5,
    model: "sonnet",
    source,
  });

  // Claim nuggets for channel "whop-chat" so the next tick doesn't refeed them —
  // but only when wellsBlock actually landed. If renderInline overflowed and
  // fell back to "", the dispatched session never sees the nuggets, so claiming
  // them would silently burn them for the channel.
  if (wellsBlock.length > 0) {
    for (const nugget of allNuggets) {
      markConsumed(nugget.id, nugget.type, "whop-chat", taskId);
    }
  }

  // Record the room we just queued for so the next tick can detect an unchanged room.
  saveSynthState({
    last_room_hash: roomHash,
    last_seen_message_id: humanMsgs.at(-1)?.id ?? null,
    last_queued_bucket: bucket,
    consecutive_unchanged: 0,
    updated_at: new Date().toISOString(),
  });

  const artifactPath = writeArtifact("synthesis", {
    tick_at: new Date().toISOString(),
    channel_id: CHAT_CHANNEL_ID,
    bucket,
    window_hours: 24,
    messages_in_window: windowMessages.length,
    recent_arc_signals: recentArcSignals,
    context_wells: {
      total: allNuggets.length,
      watch_interior: watchInteriorNuggets.map((n) => n.id),
      arxiv: arxivNuggets.map((n) => n.id),
    },
    dry_run: WHOP_SYNTHESIS_DRY_RUN,
    task_id: taskId,
    transcript_excerpt: transcript.slice(0, 4000),
  });

  synthesisLog(`queued task ${taskId} (dry_run=${WHOP_SYNTHESIS_DRY_RUN}) artifact=${artifactPath}`);
}

// --------------------------------------------------------------------
// Phase 4 — Free Public forum digest lane (24h cadence)
// --------------------------------------------------------------------

interface ForumPost {
  id: string;
  title?: string | null;
  content?: string | null;
  created_at: string;
  user?: { id?: string; username?: string; name?: string } | null;
}

interface ForumPostsResponse {
  data: ForumPost[];
}

/** Quietly fetches last N posts of a forum experience via @whop/sdk. null on failure. */
async function listForumPosts(
  experienceId: string,
  apiKey: string,
  limit = 20,
): Promise<ForumPostsResponse | null> {
  try {
    const page = await whopClient(apiKey).forumPosts.list({
      experience_id: experienceId,
      first: limit,
    });
    return { data: page.data as unknown as ForumPost[] };
  } catch {
    return null;
  }
}

/** Newest watch report path (HTML or markdown) + ISO ts parsed from filename, if any. */
function latestWatchReport(): { path: string; ts: string } | null {
  const reportsDir = resolve(process.cwd(), "reports");
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter((f) => /_watch_report\.(html|md)$/.test(f))
    .sort();
  const newest = files.at(-1);
  if (!newest) return null;
  const tsMatch = newest.match(/^(\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z)/);
  return {
    path: `reports/${newest}`,
    ts: tsMatch ? tsMatch[1].replace(/_/g, ":") : "",
  };
}

/** Arc daily activity snapshot — tasks completed in last 24h, gross cost estimate. */
function arcDailySnapshot(): { tasks_completed_24h: number; tasks_failed_24h: number; cost_usd_24h: number } {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        COALESCE(SUM(cost_usd), 0) AS cost
       FROM tasks
       WHERE completed_at > datetime('now', '-1 day')`,
    )
    .get() as { completed: number | null; failed: number | null; cost: number | null } | undefined;
  return {
    tasks_completed_24h: row?.completed ?? 0,
    tasks_failed_24h: row?.failed ?? 0,
    cost_usd_24h: Number((row?.cost ?? 0).toFixed(2)),
  };
}

/** Top non-arc counterparty by message_count across the relationship store. */
function topRelationship(): { username: string; message_count: number } | null {
  const store = loadRelationships();
  let best: { username: string; message_count: number } | null = null;
  for (const userId of Object.keys(store.users)) {
    if (userId === ARC_USER_ID) continue;
    const relationship = store.users[userId];
    const count = relationship.message_count ?? 0;
    if (!best || count > best.message_count) {
      best = { username: relationship.username ?? userId, message_count: count };
    }
  }
  return best;
}

/**
 * 24h Public-forum digest lane — syndicates Arc status + paid-room activity into
 * the free forum as a forum thread. Static content, daily cadence, dry-run by
 * default. The sensor snapshots data; the dispatched session composes and posts.
 *
 * Bucket key = `sensor:whop-free-forum:<YYYY-MM-DD>` (one digest/day). Cross-lane
 * awareness: skips if a paid-room digest from the synthesis lane fired in the
 * last 12h, so the free forum never echoes what the paid room just got.
 */
export async function pollWhopFreeForumDigest(): Promise<void> {
  if (!WHOP_FREE_FORUM_ENABLED) {
    freeForumLog("disabled (WHOP_FREE_FORUM_ENABLED=false) — awaiting Phase 4 audit + sign-off");
    return;
  }

  const bucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — one per day
  const source = `sensor:whop-free-forum:${bucket}`;
  if (taskExistsForSource(source)) {
    freeForumLog(`already queued a digest for ${bucket} — skip`);
    return;
  }

  const apiKey = await getAppApiKey();
  if (!apiKey) {
    freeForumLog("skip: no app_api_key credential");
    return;
  }

  // --- Snapshot: paid-room recent activity (last 24h) ---
  const paidRoom = await listMessages(CHAT_CHANNEL_ID, apiKey, 50);
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const paidMessages24h = (paidRoom?.data ?? []).filter((m) => {
    const t = Date.parse(m.created_at);
    return !Number.isNaN(t) && t >= cutoffMs;
  });
  const paidSpeakers = new Set(paidMessages24h.map((m) => m.user.id));

  // --- Snapshot: recent public-forum activity (Arc's own posts, for content-level dedup awareness) ---
  const forumPosts = await listForumPosts(FREE_FORUM_EXPERIENCE_ID, apiKey, 10);
  const recentArcForumPosts = (forumPosts?.data ?? []).filter(
    (p) => p.user?.id === ARC_USER_ID,
  );
  const lastArcForumPostIso = recentArcForumPosts[0]?.created_at;

  // --- Snapshot: arc operational state ---
  const dailyStats = arcDailySnapshot();
  const watchReport = latestWatchReport();
  const topRel = topRelationship();

  // --- Cross-lane awareness: prevent free-forum echoing a paid-room beat from
  // the synthesis lane that fired in the same window. ---
  const recentSynthesisPost = recentTaskExistsForSourcePrefix("sensor:whop-synthesis:", 12 * 60);

  // AI-061: before-LLM skip gate — if synthesis just posted AND there's no watch report AND
  // Arc completed nothing in 24h, the digest has no content. Skip the dispatch session.
  // Conservative AND: all three must be true. If Arc completed any task (even one), there may
  // be content worth surfacing. Dormant until WHOP_FREE_FORUM_ENABLED=true (Phase 7).
  if (recentSynthesisPost && watchReport === null && dailyStats.tasks_completed_24h === 0) {
    freeForumLog(
      "skip (AI-061): pre-bias gate fired — synthesis-recent(≤12h)+no-watch-report+zero-completions — saving dispatch session"
    );
    return;
  }

  const dryRunPrefix = WHOP_FREE_FORUM_DRY_RUN ? "[DRY-RUN] " : "";
  const postCommand = WHOP_FREE_FORUM_DRY_RUN
    ? `DRY-RUN: do NOT call post-forum. Compose the title + markdown body in result_detail so the artifact captures it, then close completed with --summary describing the digest decision (post vs defer + reason).`
    : `Post via:
  arc skills run --name whop -- post-forum --experience ${FREE_FORUM_EXPERIENCE_ID} --title "<title>" --content "<markdown>"
post-forum is non-idempotent — if re-dispatched, confirm the latest forum thread isn't this same digest before re-posting (list-forum-posts --experience ${FREE_FORUM_EXPERIENCE_ID} --limit 3).`;

  const watchReportLine = watchReport
    ? `Latest watch report: ${watchReport.path} (period end ${watchReport.ts}) — read this first, lean on it.`
    : `No watch report on disk — fall back to live counts only.`;

  const recentForumLine = lastArcForumPostIso
    ? `Arc's last forum post: ${lastArcForumPostIso} (id: ${recentArcForumPosts[0].id}, title: ${recentArcForumPosts[0].title ?? "(none)"}).`
    : `No prior Arc posts in the Public forum — this would be the first.`;

  const synthesisCrossLine = recentSynthesisPost
    ? "Cross-lane: a paid-room synthesis post fired in the last 12h. STRONGLY consider a DEFER — the free forum should not echo the paid room same-day."
    : "Cross-lane: no recent paid-room synthesis post in the last 12h. Standard digest rubric applies.";

  const topRelLine = topRel
    ? `Most active counterparty: ${topRel.username} (${topRel.message_count} msgs tracked).`
    : `No tracked counterparty messages yet — early days for the relationship store.`;

  const taskId = insertTask({
    subject: `${dryRunPrefix}Whop free-forum digest [${bucket}]: syndicate Arc status into the Public forum`,
    description: [
      `Compose ONE daily digest forum thread for the FREE Public forum on Whop.`,
      `Destination: experience ${FREE_FORUM_EXPERIENCE_ID} (forum feed ${FREE_FORUM_FEED_ID}).`,
      "",
      "## What this digest is",
      "Static, substantive content — NOT a tease, NOT chat-style. The free forum",
      "should feel like a real public window into Arc's operating state: what's been",
      "happening, what's interesting, what's worth following. People decide whether",
      "to subscribe to the paid room by seeing real signal here, not marketing.",
      "",
      "## What it MUST cover (in this order, or a sensible variation)",
      "  1. **Arc status** — the last 24h, drawing primarily from the watch report.",
      "     Tasks completed, surprising or instructive cycles, current focus.",
      "     Numbers should be concrete, not vague.",
      "  2. **Whop activity** — the paid-room speakers / msg count window summary,",
      "     and a short, voice-respecting note on what's coming through Arc's lanes",
      "     (reactive replies, synthesis cadence) — high-level, never quoting paid",
      "     content verbatim or naming members without their visible-from-free intent.",
      "  3. **One or two notes from data on hand** — a relationship signal, a",
      "     pattern the recent log surfaced, a question Arc is sitting with. Pick",
      "     what's actually live, not filler.",
      "  4. **Pointer back to arc0.me / paid room** — natural, not a CTA. The point",
      "     is to show, not sell.",
      "",
      "## What DEFER looks like (close as completed, source-dedup holds the slot)",
      "Defer if any of:",
      "  - The watch report is missing AND the operating stats are uninteresting",
      "  - A paid-room synthesis post fired in the last 12h (the cross-lane signal",
      "    below makes this explicit) — echoing it in the free forum is filler",
      "  - The Public forum already has an Arc post in the last 24h that covers",
      "    the same ground (see latest-arc-forum-post below — if title/content",
      "    overlap is high, DEFER)",
      "  - You can't honestly say something substantive — silence beats filler",
      "",
      "## Voice",
      "Read SOUL.md + skills/arc-brand-voice/SKILL.md before composing.",
      "  - Plain language, concrete numbers, one structural observation as the spine.",
      "  - Title: 3–7 words, factual, not clickbait (e.g. \"Operating notes — 2026-06-12\"",
      "    or \"What 76 cycles looked like today\"). Title is OPTIONAL in the API; if you",
      "    pick a title, make it earn its place.",
      "  - Body: ≤900 chars target. Markdown OK. Headings/bullets sparingly.",
      "  - End with a single anchor: a link to arc0.me OR an honest question for",
      "    forum readers. Not both, not a CTA.",
      "  - No \"as an agent...\", no AI-corporate platitudes, no growth-marketing tone.",
      "",
      `Bucket: ${bucket} (one digest per day; source-dedup ${source})`,
      watchReportLine,
      `Arc 24h: ${dailyStats.tasks_completed_24h} completed, ${dailyStats.tasks_failed_24h} failed, est cost $${dailyStats.cost_usd_24h.toFixed(2)}.`,
      `Paid room 24h: ${paidMessages24h.length} messages from ${paidSpeakers.size} speakers in ${CHAT_CHANNEL_ID}.`,
      topRelLine,
      recentForumLine,
      synthesisCrossLine,
      "",
      "Relationships store for additional context: db/whop-relationships.json",
      "",
      postCommand,
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 5,
    model: "sonnet",
    source,
  });

  const artifactPath = writeArtifact("free-forum", {
    tick_at: new Date().toISOString(),
    bucket,
    experience_id: FREE_FORUM_EXPERIENCE_ID,
    forum_feed_id: FREE_FORUM_FEED_ID,
    dry_run: WHOP_FREE_FORUM_DRY_RUN,
    task_id: taskId,
    watch_report: watchReport,
    arc_daily: dailyStats,
    paid_room_24h: {
      channel_id: CHAT_CHANNEL_ID,
      message_count: paidMessages24h.length,
      speaker_count: paidSpeakers.size,
    },
    free_forum_recent: {
      arc_posts_seen: recentArcForumPosts.length,
      last_arc_post_at: lastArcForumPostIso ?? null,
    },
    top_relationship: topRel,
    cross_lane_signals: {
      recent_synthesis_post_12h: recentSynthesisPost,
    },
  });

  freeForumLog(`queued task ${taskId} (dry_run=${WHOP_FREE_FORUM_DRY_RUN}) artifact=${artifactPath}`);
}

// --- P19: events intake lane ---------------------------------------------
//
// Poll memberships + payments created since the last cursor, normalize each to a
// WhopEvent, and feed through ingestWhopEvent() (exactly-once ledger + surface).
// Cursor lives in its own hook-state file so it never clobbers the claim cadence.
// Read-only against the SDK; whopClient uses maxRetries:0; any failure no-ops the
// stream (the ledger makes a re-poll safe regardless of where we stopped).
const EVENTS_CURSOR_STATE = "whop-events-cursor";

// One stream's worth of polling: list a page, ingest each item exactly-once, and
// track the high-water created_at for the next cursor. A failed list no-ops the
// stream (the ledger makes a re-poll safe regardless of where we stopped).
async function pollEventStream<T extends { created_at: string }>(
  label: string,
  fetchPage: () => Promise<{ data?: T[] | null }>,
  normalize: (item: T) => WhopEvent,
  after: string,
): Promise<{ recorded: number; maxAt: string }> {
  let recorded = 0;
  let skipped = 0;
  let maxAt = after;
  try {
    const page = await fetchPage();
    const items = page.data ?? [];
    for (const item of items) {
      // Per-item guard: a single malformed event must not abort the page (and strand
      // every later event behind an un-advanced cursor). The cursor advances only past
      // items we actually processed (forge 2026-06-16).
      try {
        const outcome = ingestWhopEvent(normalize(item));
        if (outcome === "recorded") recorded++;
        else if (outcome === "skipped") skipped++;
        if (item.created_at > maxAt) maxAt = item.created_at;
      } catch (itemErr) {
        eventsLog(`${label}: item ingest failed (${itemErr instanceof Error ? itemErr.message : String(itemErr)}) — skipped, cursor held`);
      }
    }
    if (skipped > 0) eventsLog(`${label}: skipped ${skipped} excluded (app-product / advisor) event(s)`);
    // Single page, no pagination loop (council/cairn+forge+spark). At a 1-product
    // $49/mo room this never trips; if it ever does, the cursor advances to the
    // page max and the next 15-min tick drains the rest (the ledger dedups overlap).
    // Logged so a real backlog is visible instead of silently truncated.
    if (items.length >= EVENTS_PAGE_SIZE) {
      eventsLog(`${label}: full page (${items.length}) — backlog likely, will drain over subsequent ticks`);
    }
  } catch (error) {
    eventsLog(`${label} poll error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { recorded, maxAt };
}

export async function pollWhopEvents(): Promise<void> {
  if (!WHOP_EVENTS_ENABLED) {
    eventsLog("disabled (WHOP_EVENTS_ENABLED=false) — skip");
    return;
  }

  // Company key, NOT the app key: memberships.list / payments.list are company-scoped
  // and 400 ("not authorized") under the app key — the events lane silently no-opped
  // on every tick until this fix (the app key is for chat writes only). The verify
  // artifact for the first product purchase already specified a "company-scoped poll".
  const apiKey = await getCredential("whop", "company_api_key");
  if (!apiKey) {
    eventsLog("no company_api_key — skip");
    return;
  }
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) {
    eventsLog("no company_id credential — skip");
    return;
  }

  const floor = new Date(Date.now() - EVENTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const state = await readHookState(EVENTS_CURSOR_STATE);
  const membershipsAfter = (state?.last_membership_after as string) || floor;
  const paymentsAfter = (state?.last_payment_after as string) || floor;

  // Idempotent reads → allow a couple retries so a transient 5xx on the (now-live)
  // M0-detection poll doesn't silently no-op for a full cycle (forge 2026-06-16).
  const client = whopClient(apiKey, 2);

  const memberships = await pollEventStream<MembershipLike>(
    "memberships",
    () =>
      client.memberships.list({
        company_id: companyId,
        created_after: membershipsAfter,
        order: "created_at",
        direction: "asc",
        first: EVENTS_PAGE_SIZE,
      }) as unknown as Promise<{ data?: MembershipLike[] | null }>,
    normalizeMembership,
    membershipsAfter,
  );

  const payments = await pollEventStream<PaymentLike>(
    "payments",
    () =>
      client.payments.list({
        company_id: companyId,
        created_after: paymentsAfter,
        order: "created_at",
        direction: "asc",
        first: EVENTS_PAGE_SIZE,
      }) as unknown as Promise<{ data?: PaymentLike[] | null }>,
    normalizePayment,
    paymentsAfter,
  );

  await writeHookState(EVENTS_CURSOR_STATE, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    // Guard against malformed/legacy hook-state lacking a numeric version (council/cairn).
    version: typeof state?.version === "number" ? state.version + 1 : 1,
    last_membership_after: memberships.maxAt,
    last_payment_after: payments.maxAt,
  });

  eventsLog(
    `polled events — ${memberships.recorded + payments.recorded} new recorded ` +
      `(memberships≤${memberships.maxAt}, payments≤${payments.maxAt})`,
  );
}

export default async function whopSensor(): Promise<string> {
  let result: "ok" | "skip" = "skip";

  // --- Part 1: whop-state.json writer (always on, 60min cadence) ---
  const stateClaimed = await claimSensorRun(STATE_WRITER_SENSOR_NAME, STATE_WRITER_INTERVAL_MINUTES);
  if (stateClaimed) {
    try {
      await writeWhopState();
      result = "ok";
    } catch (error) {
      log(`whop-state write error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 3: patterns library monitor (independent, always runs if claimed) ---
  const patternsClaimed = await claimSensorRun(PATTERNS_MONITOR_SENSOR_NAME, PATTERNS_MONITOR_INTERVAL_MINUTES);
  if (patternsClaimed) {
    try {
      await monitorPatternsLibrary();
      result = "ok";
    } catch (error) {
      log(`patterns monitor error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 4: reactive reply lane (5min self-gate, gated by WHOP_REPLY_ENABLED) ---
  const repliesClaimed = await claimSensorRun(REPLIES_SENSOR_NAME, REPLIES_INTERVAL_MINUTES);
  if (repliesClaimed) {
    try {
      await pollWhopReplies();
      result = "ok";
    } catch (error) {
      repliesLog(`reply lane error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 5: synthesis lane (6h self-gate, gated by WHOP_SYNTHESIS_ENABLED) ---
  const synthesisClaimed = await claimSensorRun(SYNTHESIS_SENSOR_NAME, SYNTHESIS_INTERVAL_MINUTES);
  if (synthesisClaimed) {
    try {
      await pollWhopSynthesis();
      result = "ok";
    } catch (error) {
      synthesisLog(`synthesis lane error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 6: free-forum digest lane (24h self-gate, gated by WHOP_FREE_FORUM_ENABLED) ---
  const freeForumClaimed = await claimSensorRun(FREE_FORUM_SENSOR_NAME, FREE_FORUM_INTERVAL_MINUTES);
  if (freeForumClaimed) {
    try {
      await pollWhopFreeForumDigest();
      result = "ok";
    } catch (error) {
      freeForumLog(`free-forum lane error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 7 (P19): events intake lane (15min self-gate, WHOP_EVENTS_ENABLED kill switch) ---
  const eventsClaimed = await claimSensorRun(EVENTS_SENSOR_NAME, EVENTS_INTERVAL_MINUTES);
  if (eventsClaimed) {
    try {
      await pollWhopEvents();
      result = "ok";
    } catch (error) {
      eventsLog(`events lane error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Part 2: blog → chat hot-topic (gated) ---
  if (!WHOP_SENSOR_ENABLED) {
    // Self-gate so the line is visible in sensor logs without burning a claim.
    log("disabled (WHOP_SENSOR_ENABLED=false) — awaiting key scope + voice sign-off");
    return result;
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return result;

  const post = newestPublishedPost();
  if (!post) {
    log("no published blog post found");
    return result;
  }

  if (!withinFreshWindow(post.publishedAt)) {
    log(`newest post '${post.slug}' is outside the ${FRESH_WINDOW_DAYS}d fresh window — skip`);
    return result;
  }

  // Durable dedup: one hot-topic per blog slug, ever (checks all task statuses).
  const source = `sensor:whop:${post.slug}`;
  if (taskExistsForSource(source)) {
    log(`already queued/posted a hot-topic for '${post.slug}' — skip`);
    return result;
  }

  const url = `${BLOG_BASE_URL}/${post.slug}`;
  const taskId = insertTask({
    subject: `Whop hot-topic: distill "${post.title}" into the hash-it-out chat room`,
    description: [
      `New blog post detected: "${post.title}"`,
      url,
      "",
      "Compose ONE hot-topic for the paid 'AI Prefers Bitcoin' chat room (hash-it-out):",
      "a single structural pull-quote plus one genuine open question for the room.",
      "Voice: arc-brand-voice + SOUL — add information, ask a real question, or make",
      "someone want to respond. No platitudes, no ship-log spam. Link the post.",
      "",
      "Post via:",
      `  arc skills run --name whop -- post-chat --content "<markdown>"`,
      "(uses the stored chat_channel_id). post-chat is non-idempotent — if re-dispatched,",
      "confirm the room does not already have this hot-topic before re-posting.",
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 4,
    model: "sonnet",
    source,
  });

  log(`queued task ${taskId} — hot-topic for '${post.slug}'`);
  return "ok";
}
