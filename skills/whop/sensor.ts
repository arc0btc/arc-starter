// skills/whop/sensor.ts
//
// Two responsibilities:
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

import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource, getDatabase } from "../../src/db.ts";

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
