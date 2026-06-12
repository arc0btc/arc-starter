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

import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource, getDatabase } from "../../src/db.ts";
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
import { listMessages, getAppApiKey } from "./lib/whop-api.ts";

const SENSOR_NAME = "whop";
// Check on a ~6h cadence; actual posting is naturally throttled by new blog
// posts plus durable per-slug dedup, matching arc0.me's 3-7d freshness.
const INTERVAL_MINUTES = 360;

const STATE_WRITER_SENSOR_NAME = "whop-state-writer";
const STATE_WRITER_INTERVAL_MINUTES = 60;

const PATTERNS_MONITOR_SENSOR_NAME = "whop-patterns-library-monitor";
const PATTERNS_MONITOR_INTERVAL_MINUTES = 360;

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
  } catch (err) {
    log(`error loading patterns state: ${err instanceof Error ? err.message : String(err)}`);
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
  } catch (err) {
    log(`error saving patterns state: ${err instanceof Error ? err.message : String(err)}`);
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

/** Find new patterns not yet posted to the library. */
function findNewPatterns(
  allPatterns: PatternEntry[],
  state: PatternsLibraryState
): PatternEntry[] {
  return allPatterns.filter((p) => !state.postedPatterns.includes(p.name));
}

/** Monitor patterns.md and queue a task when new patterns are detected. */
async function monitorPatternsLibrary(): Promise<void> {
  const patterns = extractPatterns();
  if (patterns.length === 0) {
    log("no patterns found in patterns.md");
    return;
  }

  let state = loadPatternsState();

  // First run: initialize state with all current patterns (avoid flooding on sensor startup)
  if (state.postedPatterns.length === 0 && patterns.length > 0) {
    log(`first run — initializing state with ${patterns.length} existing patterns`);
    state.postedPatterns = patterns.map((p) => p.name);
    state.lastScannedAt = new Date().toISOString();
    savePatternsState(state);
    return;
  }

  const newPatterns = findNewPatterns(patterns, state);

  if (newPatterns.length === 0) {
    log(`all ${patterns.length} patterns indexed — skip`);
    return;
  }

  // Create dedup source key based on first new pattern name
  const source = `sensor:whop:patterns-library:${newPatterns[0].name}`;
  if (taskExistsForSource(source)) {
    log(`already queued a patterns-library task for first new pattern '${newPatterns[0].name}' — skip`);
    return;
  }

  const patternNames = newPatterns.map((p) => p.name).join(", ");
  const taskId = insertTask({
    subject: `Whop: append ${newPatterns.length} new pattern(s) to Patterns Library index`,
    description: [
      `Detected ${newPatterns.length} new pattern(s) in patterns.md:`,
      "",
      newPatterns.map((p) => `- **${p.name}**: ${p.description}`).join("\n"),
      "",
      "Append these to the Patterns Library index post in the hash-it-out Patterns Library experience.",
      "Use the post-chat command to update the index with the new entries.",
      "Include brief description for each new pattern.",
    ].join("\n"),
    skills: JSON.stringify(["whop"]),
    priority: 6,
    model: "haiku",
    source,
  });

  // Update state to mark these patterns as indexed
  state.postedPatterns.push(...newPatterns.map((p) => p.name));
  state.lastScannedAt = new Date().toISOString();
  savePatternsState(state);

  log(`queued task ${taskId} — ${newPatterns.length} new pattern(s): ${patternNames}`);
}

// ====================================================================
// Reactive reply lane + synthesis lane (POLLING-DESIGN.md)
// ====================================================================

const REPLIES_SENSOR_NAME = "whop-replies";
const REPLIES_INTERVAL_MINUTES = 5;
const SYNTHESIS_SENSOR_NAME = "whop-synthesis";
const SYNTHESIS_INTERVAL_MINUTES = 6 * 60;

// Master kill flags — both default off. Flip after Phase 0 dry-run audit.
const WHOP_REPLY_ENABLED = false;
const WHOP_SYNTHESIS_ENABLED = false;

// Dry-run flags. Even when enabled, default to dry_run=true: sensor queues
// compose-only tasks whose description carries [DRY-RUN] so the dispatched
// session prepares text but DOES NOT call post-chat / reply-chat. Flip to
// false only after auditing artifacts confirms whyReply behaves as designed.
const WHOP_REPLY_DRY_RUN = true;
const WHOP_SYNTHESIS_DRY_RUN = true;

// Channel under management. Verified in SKILL.md.
const CHAT_CHANNEL_ID = "chat_feed_1CbxMbfsj2yvpGqNnMcuCg";

// whyReply tunables — match POLLING-DESIGN.md "Locked tradeoffs".
const REPLY_DAILY_BUDGET = 5;
const THREAD_SPIRAL_CAP = 3;
const RECENT_ARC_COOLDOWN_MIN = 15;
const LENGTH_FLOOR_CHARS = 15;
const MESSAGE_STALE_DAYS = 7;
const ACK_PATTERN = /^(thx|thanks|ty|tysm|🔥|💯|❤️|nice|cool|\+1|ack)[\s.!?]*$/i;

const repliesLog = createSensorLogger(REPLIES_SENSOR_NAME);
const synthesisLog = createSensorLogger(SYNTHESIS_SENSOR_NAME);

interface CandidateDecision {
  msg_id: string;
  from: string;
  outcome: "task_created" | "skip" | "dry_run_task";
  trigger?: string;
  reason?: string;
  task_id?: number | null;
}

/** Newest-first fetch + per-message whyReply evaluation + relationship update. */
async function pollWhopReplies(): Promise<void> {
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

  for (const msg of messages) {
    const trigger = classifyTrigger(msg, messages);
    if (!trigger) continue; // not a candidate at all — silently ignore

    const decision = evaluateWhyReply(msg, messages, store, budgetUsed + countDryRunDecisions(candidates));
    if (decision.skip) {
      candidates.push({
        msg_id: msg.id,
        from: msg.user.username ?? msg.user.id,
        outcome: "skip",
        trigger,
        reason: decision.skip,
      });
      continue;
    }

    // Source dedup — one task per chat message, ever.
    const source = `sensor:whop-replies:${msg.id}`;
    if (taskExistsForSource(source)) {
      candidates.push({
        msg_id: msg.id,
        from: msg.user.username ?? msg.user.id,
        outcome: "skip",
        trigger,
        reason: "already_queued",
      });
      continue;
    }

    const taskId = queueReplyTask(msg, trigger, store);
    candidates.push({
      msg_id: msg.id,
      from: msg.user.username ?? msg.user.id,
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
 * Triggers: direct_mention | mentions_everyone | direct_reply_to_arc.
 */
function classifyTrigger(msg: ChatMessage, batch: ChatMessage[]): string | null {
  // Self-skip: Arc never replies to Arc.
  if (msg.user.id === ARC_USER_ID) return null;

  // Direct mention via the structured mentions array. The API's mention object
  // shape is unverified at scale — accept either {user_id} or {id} forms.
  const mentions = (msg as unknown as { mentions?: Array<{ user_id?: string; id?: string }> }).mentions;
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (m.user_id === ARC_USER_ID || m.id === ARC_USER_ID) return "direct_mention";
    }
  }
  const mentionsEveryone = (msg as unknown as { mentions_everyone?: boolean }).mentions_everyone;
  if (mentionsEveryone) return "mentions_everyone";

  // Reply-to-Arc: parent message is in our batch and authored by Arc.
  if (msg.replying_to_message_id) {
    const parent = batch.find((m) => m.id === msg.replying_to_message_id);
    if (parent && parent.user.id === ARC_USER_ID) return "direct_reply_to_arc";
  }

  return null;
}

interface WhyReplyDecision {
  skip?: string; // skip reason; absent = accept
}

function evaluateWhyReply(
  msg: ChatMessage,
  batch: ChatMessage[],
  store: ReturnType<typeof loadRelationships>,
  liveBudgetUsed: number,
): WhyReplyDecision {
  // Daily budget — checked first because it short-circuits everything.
  if (liveBudgetUsed >= REPLY_DAILY_BUDGET) return { skip: "daily_budget_exhausted" };

  // Length floor — short messages with no question mark are noise.
  const content = msg.content?.trim() ?? "";
  if (content.length < LENGTH_FLOOR_CHARS && !content.includes("?")) {
    return { skip: "below_length_floor" };
  }

  // Ack pattern — pure "thanks", "🔥", etc.
  if (ACK_PATTERN.test(content)) return { skip: "ack_pattern" };

  // Mention age — stale messages from a re-scan get closed gracefully.
  const createdAtMs = Date.parse(msg.created_at);
  if (!Number.isNaN(createdAtMs)) {
    const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
    if (ageDays > MESSAGE_STALE_DAYS) return { skip: "stale_message" };
  }

  // Thread spiral cap — count Arc messages in the same conversation chain.
  const arcThreadCount = countArcMessagesInThread(msg, batch);
  if (arcThreadCount >= THREAD_SPIRAL_CAP) return { skip: "thread_spiral_cap" };

  // Recent-arc cooldown — if Arc replied to this same user within N minutes,
  // hold off so the room doesn't see Arc dominate a thread.
  const rel = getRelationship(store, msg.user.id);
  if (rel) {
    const lastArcReply = [...rel.recent_interactions]
      .reverse()
      .find((i) => i.direction === "from_arc");
    if (lastArcReply) {
      const ageMin = (Date.now() - Date.parse(lastArcReply.at)) / (1000 * 60);
      if (ageMin < RECENT_ARC_COOLDOWN_MIN) return { skip: "recent_arc_cooldown" };
    }
  }

  return {};
}

/**
 * Walk the reply chain from `msg` upward and count how many of the ancestor
 * messages were Arc-authored. This is the conversation chain spiral cap.
 */
function countArcMessagesInThread(msg: ChatMessage, batch: ChatMessage[]): number {
  let count = 0;
  let cursor: string | null | undefined = msg.replying_to_message_id;
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

  return insertTask({
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
      "Reference voice: skills/whop/drafts/2026-06-12-reading-the-quiet.md.",
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
}

/** 6h synthesis lane — read the room, queue one defer-or-post task. */
async function pollWhopSynthesis(): Promise<void> {
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
    : `Post via:\n  arc skills run --name whop -- post-chat --content "<markdown>"`;

  const taskId = insertTask({
    subject: `${dryRunPrefix}Whop synthesis [${bucket}]: read the room, defer or post`,
    description: [
      "Read the last 24h of the AI Prefers Bitcoin chat room and decide:",
      "is there a teaching beat worth adding right now, or do you DEFER?",
      "DEFER is the right answer on most ticks. Voice: arc-brand-voice + SOUL.",
      "Reference voice: skills/whop/drafts/2026-06-12-reading-the-quiet.md.",
      "",
      `Channel: ${CHAT_CHANNEL_ID}`,
      `Window: last 24h | messages in window: ${windowMessages.length}`,
      "",
      "Transcript (oldest first):",
      "```",
      transcript || "(no messages in window)",
      "```",
      "",
      "Relationships of speakers are in db/whop-relationships.json — read it",
      "for context on who's been in the room and what they've said.",
      "",
      postCommand,
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 5,
    model: "sonnet",
    source,
  });

  const artifactPath = writeArtifact("synthesis", {
    tick_at: new Date().toISOString(),
    channel_id: CHAT_CHANNEL_ID,
    bucket,
    window_hours: 24,
    messages_in_window: windowMessages.length,
    dry_run: WHOP_SYNTHESIS_DRY_RUN,
    task_id: taskId,
    transcript_excerpt: transcript.slice(0, 4000),
  });

  synthesisLog(`queued task ${taskId} (dry_run=${WHOP_SYNTHESIS_DRY_RUN}) artifact=${artifactPath}`);
}

export default async function whopSensor(): Promise<string> {
  let result: "ok" | "skip" = "skip";

  // --- Part 1: whop-state.json writer (always on, 60min cadence) ---
  const stateClaimed = await claimSensorRun(STATE_WRITER_SENSOR_NAME, STATE_WRITER_INTERVAL_MINUTES);
  if (stateClaimed) {
    try {
      await writeWhopState();
      result = "ok";
    } catch (err) {
      log(`whop-state write error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Part 3: patterns library monitor (independent, always runs if claimed) ---
  const patternsClaimed = await claimSensorRun(PATTERNS_MONITOR_SENSOR_NAME, PATTERNS_MONITOR_INTERVAL_MINUTES);
  if (patternsClaimed) {
    try {
      await monitorPatternsLibrary();
      result = "ok";
    } catch (err) {
      log(`patterns monitor error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Part 4: reactive reply lane (5min self-gate, gated by WHOP_REPLY_ENABLED) ---
  const repliesClaimed = await claimSensorRun(REPLIES_SENSOR_NAME, REPLIES_INTERVAL_MINUTES);
  if (repliesClaimed) {
    try {
      await pollWhopReplies();
      result = "ok";
    } catch (err) {
      repliesLog(`reply lane error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Part 5: synthesis lane (6h self-gate, gated by WHOP_SYNTHESIS_ENABLED) ---
  const synthesisClaimed = await claimSensorRun(SYNTHESIS_SENSOR_NAME, SYNTHESIS_INTERVAL_MINUTES);
  if (synthesisClaimed) {
    try {
      await pollWhopSynthesis();
      result = "ok";
    } catch (err) {
      synthesisLog(`synthesis lane error: ${err instanceof Error ? err.message : String(err)}`);
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
