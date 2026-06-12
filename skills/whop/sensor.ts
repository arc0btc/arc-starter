// skills/whop/sensor.ts
//
// Blog -> paid-chat hot-topic cadence. Detects the newest published arc0.me blog
// post and queues ONE sonnet dispatch task to distill it into a hot-topic and
// post it into the hash-it-out chat room via `arc skills run --name whop -- post-chat`.
//
// No LLM here — pure file scan + durable dedup. The compose+post judgment lives
// in the queued dispatch task (skills: whop + arc-brand-voice).
//
// GATE: disabled by default. Members pay real money; the first posts go through a
// human-review gate (SOUL: a post must add information, ask a real question, or
// make someone want to respond). Flip WHOP_SENSOR_ENABLED to true only after:
//   1. the company API key is scoped `chat:message:create` (POST /v1/messages),
//   2. the first hot-topic has landed and whoabuddy approved the voice, and
//   3. whoabuddy signed off on a recurring auto-post cadence.

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "whop";
// Check on a ~6h cadence; actual posting is naturally throttled by new blog
// posts plus durable per-slug dedup, matching arc0.me's 3-7d freshness.
const INTERVAL_MINUTES = 360;

// Human-review gate. See header. Until true, the sensor self-logs and skips.
const WHOP_SENSOR_ENABLED = false;

// Only consider a post published within this window — avoids spamming the room
// with backlog the first time the gate is opened, and avoids re-posting stale work.
const FRESH_WINDOW_DAYS = 7;

const BLOG_DIR = resolve(import.meta.dir, "../../github/arc0btc/arc0me-site/src/content/docs/blog");
const BLOG_BASE_URL = "https://arc0.me/blog";

const log = createSensorLogger(SENSOR_NAME);

interface BlogPost {
  slug: string;
  title: string;
  publishedAt: string | null;
  draft: boolean;
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

export default async function whopSensor(): Promise<string> {
  if (!WHOP_SENSOR_ENABLED) {
    // Self-gate so the line is visible in sensor logs without burning a claim.
    log("disabled (WHOP_SENSOR_ENABLED=false) — awaiting key scope + voice sign-off");
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const post = newestPublishedPost();
  if (!post) {
    log("no published blog post found");
    return "skip";
  }

  if (!withinFreshWindow(post.publishedAt)) {
    log(`newest post '${post.slug}' is outside the ${FRESH_WINDOW_DAYS}d fresh window — skip`);
    return "skip";
  }

  // Durable dedup: one hot-topic per blog slug, ever (checks all task statuses).
  const source = `sensor:whop:${post.slug}`;
  if (taskExistsForSource(source)) {
    log(`already queued/posted a hot-topic for '${post.slug}' — skip`);
    return "skip";
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
