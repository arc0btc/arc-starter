// skills/blog-publishing/sensor.ts
// Auto-detect weekly cadence gaps and scheduled posts ready for publishing

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, recentTaskExistsForSource, getDatabase } from "../../src/db.ts";
import {
  recentArtifacts,
  renderInline,
  markConsumed,
  type ArtifactType,
  type DistilledArtifact,
} from "../../src/artifacts.ts";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PRODUCT_PAGE_URL, PAID_ROOM_PRODUCT_URL } from "../../src/constants.ts";

const SENSOR_NAME = "blog-publishing";
const INTERVAL_MINUTES = 60;
// arc-day-n-publishing P3 (QUEST.md volume cut: "blog drops from ~20 posts/14d to 4-5/week"):
// 1 -> 1.5 days between posts targets 7/1.5 ≈ 4.67 posts/week from THIS generator (the actual
// root cause of the ~20/14d figure — Day-N ships separately via arc-daily-read/cli.ts and is
// not gated by this threshold). Reversal: set back to 1 to restore the pre-P3 daily cadence.
const CADENCE_DAYS_THRESHOLD = 1.5; // days between blog posts

const log = createSensorLogger(SENSOR_NAME);

/**
 * arc-day-n-publishing P3: reads the same single-value-rollback flag
 * (agent_config.PAID_ROOM_SEEDING_PAUSED) that gates ContentCalendarMachine's paid-room hops
 * (state-machine.ts). Fails toward PAUSED if the row is ever missing. Reversal:
 * UPDATE agent_config SET value='false' WHERE key='PAID_ROOM_SEEDING_PAUSED'.
 */
function paidRoomSeedingPaused(): boolean {
  const db = getDatabase();
  const row = db.query("SELECT value FROM agent_config WHERE key = 'PAID_ROOM_SEEDING_PAUSED'").get() as
    | { value: string }
    | null;
  return row?.value !== "false";
}

// AI-094 (satisfies AI-087): CTA footer appended to every blog post before publish.
// Two lines: one for the $9 product (no FREEMONTH — product step), one for the
// membership continuity (FREEMONTH — membership/L1 step). SOUL.md voice: direct,
// no adverbs, no banned openers, active voice. The footer is an instruction to the
// dispatched session — Arc writes the actual footer text, guided by SOUL.md.
//
// arc-day-n-publishing P3: while PAID_ROOM_SEEDING_PAUSED, drop the membership/FREEMONTH
// line — pushing new signups with a first-month-free code into a room we're deliberately not
// seeding with content is the same failure mode this quest's paid-room pause exists to avoid.
// The $9 report line stays (it's the report tripwire, not the paid room).
function blogCtaFooterInstruction(): string {
  const paused = paidRoomSeedingPaused();
  const footerLines = [
    "---",
    `If this landed, I packaged the full version: Arc Daily Research Report ($9, public provenance). ${PRODUCT_PAGE_URL}`,
    ...(paused ? [] : [`New to the room? First month free — code FREEMONTH at checkout: ${PAID_ROOM_PRODUCT_URL}`]),
  ];
  return [
    "",
    "## CTA footer (AI-094 — append before running publish)",
    "Before running the publish command, add this footer block to the END of the post body",
    "(insert it immediately before the final `---` / `*— arc0.btc*` attribution line):",
    "```",
    ...footerLines,
    "```",
    "Voice (SOUL.md): direct, no adverbs, active. The product line has no FREEMONTH (product step).",
    paused
      ? "arc-day-n-publishing P3: paid-room seeding is paused (agent_config.PAID_ROOM_SEEDING_PAUSED='true') — the membership/FREEMONTH line is deliberately omitted until an organic member exists. Do not add it back manually."
      : "The membership line has FREEMONTH (membership/continuity step). Keep them separated.",
    "Then run: arc skills run --name blog-publishing -- publish --id <post-id>",
  ].join("\n");
}

/**
 * Draft categories. Three pull from the source-artifact pool; `philosophical`
 * is voice-driven (no artifact feed). Excluding `lastCategory` prevents same-
 * topic streaks; the artifact pool acts as the curation gate.
 *
 * arc-day-n-publishing P3: `operating` and `philosophical` are the introspective/self-audit
 * "diary" register the 2026-07-07 portfolio panel flagged (~40% diary share in the ~20/14d
 * figure, below the operator's amplification bar per memory). DIARY_CATEGORIES are gated to
 * fire at most once per DIARY_BATCH_DAYS, batched into ONE weekly ops-log digest rather than a
 * per-day drip — encoded as a gate (see canUseDailyWord in arc-daily-read/cli.ts for the
 * pattern this mirrors), not a manual reminder.
 */
const CATEGORIES = ["research", "council", "operating", "philosophical"] as const;
type BlogCategory = (typeof CATEGORIES)[number];
const DIARY_CATEGORIES: readonly BlogCategory[] = ["operating", "philosophical"];
const DIARY_BATCH_DAYS = 7;

function isDiaryCategory(cat: BlogCategory): boolean {
  return (DIARY_CATEGORIES as readonly string[]).includes(cat);
}

/** Map a category to the artifact type it pulls from. `philosophical` returns null. */
function categoryToArtifactType(cat: BlogCategory): ArtifactType | null {
  switch (cat) {
    case "research":
      return "arxiv";
    case "council":
      return "council";
    case "operating":
      return "watch-interior";
    case "philosophical":
      return null;
  }
}

/**
 * Pick the next category, excluding the last one fired, AND excluding diary categories unless
 * `diaryEligible` (>= DIARY_BATCH_DAYS since the last diary pick). Deterministic-ish rotation.
 */
function pickCategory(last: BlogCategory | undefined, diaryEligible: boolean): BlogCategory {
  const pool = CATEGORIES.filter((c) => c !== last && (diaryEligible || !isDiaryCategory(c)));
  // Simple round-robin: deterministic within a single boot, but advances each call.
  // Weighted-random was the v1 plan; round-robin is simpler + tests cleanly.
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Skills array per category — controls what context the dispatched session auto-loads. */
function skillsForCategory(_cat: BlogCategory): string[] {
  return ["blog-publishing"];
}

/**
 * Queue an artifact-fed draft task. Returns true iff a task was queued.
 * Used by the cadence branch — separate from the publish branch. Exported
 * so the smoke test can exercise it without time-shifting the cadence gate.
 */
export async function queueArtifactFedDraft(source: string): Promise<boolean> {
  const state = await readHookState(SENSOR_NAME);
  const lastCategory = state?.last_blog_category as BlogCategory | undefined;
  const lastDiaryPostAt = state?.last_diary_post_at as string | undefined;
  const diaryEligible =
    !lastDiaryPostAt ||
    Date.now() - new Date(lastDiaryPostAt).getTime() >= DIARY_BATCH_DAYS * 24 * 60 * 60 * 1000;
  const category = pickCategory(lastCategory, diaryEligible);
  const artifactType = categoryToArtifactType(category);

  let artifacts: DistilledArtifact[] = [];
  let nuggetsBlock = "";

  if (artifactType) {
    artifacts = recentArtifacts(artifactType, {
      channel: "blog",
      sinceHours: 72,
      limit: 3,
    });
    if (artifacts.length > 0) {
      try {
        nuggetsBlock = renderInline(artifacts, 4000);
      } catch (error) {
        // Single nugget over-budget shouldn't happen (writeDistilled caps at 1200 chars).
        // If it does, surface it and fall back to no-nuggets.
        log(`renderInline budget overflow: ${error instanceof Error ? error.message : String(error)}`);
        artifacts = [];
      }
    }
  }

  const fallbackPrompt =
    category === "philosophical"
      ? "Draft a philosophical post — what you're sitting with right now. SOUL-anchored voice. No metric recap, no \"and then we shipped X\" — the meditative register Arc's blog uses for register #4. ≤ 900 words target."
      : `Daily blog cadence. No fresh ${artifactType ?? category} artifacts in the last 72h, so this draft is voice-driven (same as today's pre-inflows behavior). Survey recent watch reports, recent.log, and your own memory for the spine. Skip if there's nothing genuine to say.`;

  // arc-day-n-publishing P3 volume cut: this IS the once-per-DIARY_BATCH_DAYS weekly digest
  // when a diary category fires — batch the week's introspection into ONE piece, not a
  // per-day drip. Audience lens: this register speaks to Arc's own operating log, written for
  // operators watching how the agent runs itself, not a generic-human diary voice.
  const diaryDigestNote = isDiaryCategory(category)
    ? "\n\nP3 volume cut (arc-day-n-publishing): this is the ONE weekly introspective/ops-log post for this category — batch the week's genuine reflections, self-audits, and \"what broke / what I learned running myself\" moments into ONE piece, not a daily drip. Survey the PAST 7 DAYS (recent.log, watch reports, memory), not just today. Audience: agent operators watching how Arc runs itself — write for someone who wants the operating truth, not a diary entry for a general reader."
    : "";

  const generateDescription = [
    `## Draft category: ${category}`,
    "",
    (artifacts.length > 0
      ? `${artifacts.length} fresh ${artifactType} nugget${artifacts.length === 1 ? "" : "s"} below — use them as the spine of the post. Quote what's quote-worthy; don't try to use every one. The category-rotation rule means you don't have to pick the most generally interesting thing; you have to do *this category* well.`
      : fallbackPrompt) + diaryDigestNote,
    "",
    artifacts.length > 0 ? "## Nuggets\n\n" + nuggetsBlock : "",
    "",
    "## Writing constraints",
    "- 600-900 words; tag the post per existing convention.",
    "- Cite each nugget (arxiv ID / council pattern / watch-report timestamp).",
    "- Selection over invention — the nuggets above are direct quotes from sources you can re-verify.",
    "- Do NOT publish. A follow-up task handles publication.",
    "",
    "## Steps",
    "1. `arc skills run --name blog-publishing -- create --title \"...\" --tags <category>,<more>`",
    "2. Open the draft file (`github/arc0btc/arc0me-site/content/YYYY/...`) and write the body.",
    "3. Close completed with summary mentioning category + which nuggets you used.",
  ].join("\n");

  const generateId = insertTask({
    subject: `Generate ${category} blog post draft${artifacts.length > 0 ? ` (${artifacts.length} fresh ${artifactType} nuggets)` : ""}`,
    description: generateDescription,
    source,
    priority: 6,
    model: "sonnet",
    skills: JSON.stringify(skillsForCategory(category)),
  });

  insertTask({
    subject: "Publish generated blog post",
    description: "Publish the blog post draft generated by the parent task. Find the most recent draft (arc skills run --name blog-publishing -- list), then append the CTA footer and publish." + blogCtaFooterInstruction(),
    source: `task:${generateId}`,
    parent_id: generateId,
    priority: 6,
    model: "haiku",
    skills: JSON.stringify(["blog-publishing"]),
  });

  // Claim artifacts for channel "blog" so they don't re-feed next tick.
  for (const a of artifacts) {
    markConsumed(a.id, a.type, "blog", generateId);
  }

  // Persist last_blog_category for rotation; last_diary_post_at only advances when a diary
  // category actually fires (arc-day-n-publishing P3 weekly-batch gate).
  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: state?.last_ran ?? new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    last_blog_category: category,
    last_diary_post_at: isDiaryCategory(category) ? new Date().toISOString() : lastDiaryPostAt,
  } as Parameters<typeof writeHookState>[1]);

  log(
    `queued ${category} draft (${artifacts.length} nuggets) + publish subtask — generateId=${generateId}`,
  );
  return true;
}

/** Blog posts live as flat .mdx files: src/content/docs/blog/YYYY-MM-DD-slug.mdx */
function getBlogDir(): string {
  return join(process.cwd(), "github/arc0btc/arc0me-site/src/content/docs/blog");
}

/** Extract date from blog filename: 2026-03-03-slug.mdx → "2026-03-03" */
function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
  return match ? match[1] : null;
}

// Parse frontmatter from post content
interface Frontmatter {
  title?: string;
  draft?: boolean;
  scheduled_for?: string;
  date?: string;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm: Frontmatter = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    if (line.startsWith("title:")) {
      fm.title = line.replace(/^title:\s*["']?/, "").replace(/["']?$/, "");
    }
    if (line.startsWith("draft:")) {
      fm.draft = line.includes("true");
    }
    if (line.startsWith("scheduled_for:")) {
      fm.scheduled_for = line.replace(/^scheduled_for:\s*/, "").trim();
    }
    if (line.startsWith("date:")) {
      fm.date = line.replace(/^date:\s*/, "").trim();
    }
  }

  return fm;
}

// Find the most recent blog post date
function getMostRecentPostDate(): Date | null {
  const blogDir = getBlogDir();
  if (!existsSync(blogDir)) return null;

  let mostRecentDate: Date | null = null;

  try {
    const files = readdirSync(blogDir).filter(
      (f) => f.endsWith(".mdx") && f !== "index.mdx"
    );

    for (const file of files) {
      const dateStr = extractDateFromFilename(file);
      if (!dateStr) continue;

      const postDate = new Date(dateStr);
      if (isNaN(postDate.getTime())) continue;

      if (!mostRecentDate || postDate > mostRecentDate) {
        mostRecentDate = postDate;
      }
    }
  } catch (e) {
    log(`error scanning posts for recent date: ${e instanceof Error ? e.message : String(e)}`);
  }

  return mostRecentDate;
}

export default async function blogPublishingSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const blogDir = getBlogDir();

    if (!existsSync(blogDir)) {
      log("blog directory not found, skipping");
      return "skip";
    }

    let oldestDraft: { postId: string; date: string } | null = null;
    let scheduledReady: { postId: string; scheduledFor: string } | null = null;
    let timeForNewContent = false;

    // Check weekly cadence
    const mostRecentPostDate = getMostRecentPostDate();
    if (mostRecentPostDate) {
      const now = new Date();
      const daysSinceLastPost = (now.getTime() - mostRecentPostDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastPost >= CADENCE_DAYS_THRESHOLD) {
        timeForNewContent = true;
      }
    } else {
      // No posts exist yet
      timeForNewContent = true;
    }

    // Scan blog files for drafts and scheduled posts
    try {
      const files = readdirSync(blogDir).filter(
        (f) => f.endsWith(".mdx") && f !== "index.mdx"
      );

      for (const file of files) {
        const dateStr = extractDateFromFilename(file);
        if (!dateStr) continue;

        const slug = file.replace(/^(\d{4}-\d{2}-\d{2})-/, "").replace(/\.mdx$/, "");
        const postId = `${dateStr}-${slug}`;
        const filePath = join(blogDir, file);
        const content = readFileSync(filePath, "utf-8");
        const fm = parseFrontmatter(content);

        // Check for unpublished drafts
        if (fm.draft === true) {
          if (!oldestDraft || dateStr < oldestDraft.date) {
            oldestDraft = { postId, date: dateStr };
          }
        }

        // Check for scheduled posts ready to publish
        if (fm.scheduled_for) {
          const now = new Date().toISOString();
          if (fm.scheduled_for <= now) {
            scheduledReady = { postId, scheduledFor: fm.scheduled_for };
            break;
          }
        }
      }
    } catch (e) {
      log(`error scanning posts: ${e instanceof Error ? e.message : String(e)}`);
      return "skip";
    }

    // Queue task for oldest draft (decomposed: review then publish)
    if (oldestDraft) {
      const source = `sensor:blog-publishing:draft:${oldestDraft.postId}`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        const reviewId = insertTask({
          subject: `Review and finalize draft: ${oldestDraft.postId}`,
          description: `Review oldest unpublished draft. Finalize content and frontmatter. Do NOT publish — a follow-up task handles publication.`,
          source,
          priority: 5,
          model: "sonnet",
          skills: JSON.stringify(["blog-publishing"]),
        });
        insertTask({
          subject: `Publish post: ${oldestDraft.postId}`,
          description: `Publish the reviewed draft. Append the CTA footer, then run: arc skills run --name blog-publishing -- publish --id ${oldestDraft.postId}` + blogCtaFooterInstruction(),
          source: `task:${reviewId}`,
          parent_id: reviewId,
          priority: 5,
          model: "haiku",
          skills: JSON.stringify(["blog-publishing"]),
        });
        log(`queued draft review + publish subtask: ${oldestDraft.postId}`);
        return "ok";
      }
    }

    // Queue task for scheduled post ready to publish (single sonnet task — haiku times out on publish)
    if (scheduledReady) {
      const source = `sensor:blog-publishing:scheduled:${scheduledReady.postId}`;
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        insertTask({
          subject: `Publish scheduled post: ${scheduledReady.postId}`,
          description: `Scheduled post is ready (was scheduled for ${scheduledReady.scheduledFor}). Append the CTA footer, then run: arc skills run --name blog-publishing -- publish --id ${scheduledReady.postId}` + blogCtaFooterInstruction(),
          source,
          priority: 6,
          model: "sonnet",
          skills: JSON.stringify(["blog-publishing"]),
        });
        log(`queued scheduled post publish: ${scheduledReady.postId}`);
        return "ok";
      }
    }

    // Queue content generation if daily cadence reached.
    //
    // Category rotation: research / council / operating / philosophical. The
    // first three pull 2-3 fresh nuggets from the source-artifact pool;
    // philosophical falls back to "recent activity" framing (voice-driven, not
    // artifact-fed). Whichever category last fired is excluded from this tick's
    // pool — round-robin variety without lock-in.
    if (timeForNewContent) {
      const source = "sensor:blog-publishing:content-generation";
      if (!recentTaskExistsForSource(source, 24 * 60)) {
        const queued = await queueArtifactFedDraft(source);
        if (queued) return "ok";
      }
    }

    log("no action needed");
    return "skip";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
