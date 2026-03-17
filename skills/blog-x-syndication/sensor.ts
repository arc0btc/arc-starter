// skills/blog-x-syndication/sensor.ts
// Detects newly published arc0.me blog posts not yet syndicated to X.
// Queues a P5 Sonnet task per new post to craft and post a highlight tweet.
//
// State: db/hook-state/blog-x-syndication.json
//   syndicated_post_ids: string[]  — post IDs already syndicated

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Must match BUDGET_LIMITS["posts"] in social-x-posting/cli.ts
const POSTS_DAILY_LIMIT = 25;
const BUDGET_PATH = join(process.cwd(), "db/x-budget.json");
// Posts that fail this many times move to needs_investigation
const MAX_FAILURES_BEFORE_INVESTIGATION = 3;

const SENSOR_NAME = "blog-x-syndication";
const INTERVAL_MINUTES = 30;

const log = createSensorLogger(SENSOR_NAME);

/** Check if the X post budget has remaining capacity for today. */
async function hasPostBudget(): Promise<boolean> {
  try {
    const file = Bun.file(BUDGET_PATH);
    if (!(await file.exists())) return true;
    const budget = (await file.json()) as { date: string; posts: number };
    const today = new Date().toISOString().slice(0, 10);
    if (budget.date !== today) return true; // stale date means budget reset
    return budget.posts < POSTS_DAILY_LIMIT;
  } catch {
    return true; // on read error, allow queuing
  }
}

function getBlogDir(): string {
  return join(process.cwd(), "github/arc0btc/arc0me-site/src/content/docs/blog");
}

/** Parse the draft flag from MDX frontmatter. */
function isDraft(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return true; // treat as draft if no frontmatter
  return match[1].split("\n").some((l) => l.startsWith("draft:") && l.includes("true"));
}

/** Parse the title from MDX frontmatter. */
function parseTitle(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const titleLine = match[1].split("\n").find((l) => l.startsWith("title:"));
  if (!titleLine) return "";
  return titleLine.replace(/^title:\s*["']?/, "").replace(/["']?$/, "").trim();
}

/** Extract post ID from filename: 2026-03-10-some-slug.mdx → "2026-03-10-some-slug" */
function postIdFromFilename(filename: string): string {
  return filename.replace(/\.mdx$/, "");
}

export default async function blogXSyndicationSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const blogDir = getBlogDir();
    if (!existsSync(blogDir)) {
      log("blog directory not found, skipping");
      return "skip";
    }

    // Read all published post IDs
    let publishedPostIds: string[] = [];
    try {
      const files = readdirSync(blogDir).filter(
        (f) => f.endsWith(".mdx") && f !== "index.mdx"
      );
      for (const file of files) {
        const content = readFileSync(join(blogDir, file), "utf-8");
        if (!isDraft(content)) {
          publishedPostIds.push(postIdFromFilename(file));
        }
      }
    } catch (e) {
      log(`error scanning blog dir: ${e instanceof Error ? e.message : String(e)}`);
      return "skip";
    }

    if (publishedPostIds.length === 0) {
      log("no published posts found");
      return "skip";
    }

    const state = await readHookState(SENSOR_NAME);
    const syndicatedIds: string[] = (state as Record<string, unknown> | null)?.syndicated_post_ids as string[] ?? [];

    // Bootstrap: on first run, mark all current posts as syndicated to avoid historical flood
    if (syndicatedIds.length === 0 && !state) {
      log(`bootstrap: marking ${publishedPostIds.length} existing posts as already syndicated`);
      await writeHookState(SENSOR_NAME, {
        last_ran: new Date().toISOString(),
        last_result: "ok",
        syndicated_post_ids: publishedPostIds,
      } as Record<string, unknown>);
      return "skip";
    }

    // Find posts not yet syndicated — sort by post ID (date-descending) so newest first
    const unsyndicated = publishedPostIds
      .filter((id) => !syndicatedIds.includes(id))
      .sort((a, b) => b.localeCompare(a));

    if (unsyndicated.length === 0) {
      log("all published posts already syndicated");
      return "skip";
    }

    const failureCounts: Record<string, number> =
      (state as Record<string, unknown> | null)?.failure_counts as Record<string, number> ?? {};
    const needsInvestigation: string[] =
      (state as Record<string, unknown> | null)?.needs_investigation as string[] ?? [];

    // Find the first unsyndicated post that isn't already flagged or over the failure limit.
    // Escalate any posts that just crossed the threshold.
    let postId: string | null = null;
    let stateUpdated = false;
    for (const id of unsyndicated) {
      if (needsInvestigation.includes(id)) {
        log(`skipping ${id} — marked needs_investigation`);
        continue;
      }
      const failures = failureCounts[id] ?? 0;
      if (failures >= MAX_FAILURES_BEFORE_INVESTIGATION) {
        log(`${id} has ${failures} failures — moving to needs_investigation`);
        needsInvestigation.push(id);
        stateUpdated = true;
        continue;
      }
      postId = id;
      break;
    }

    if (stateUpdated) {
      await writeHookState(SENSOR_NAME, {
        ...(state as Record<string, unknown> ?? {}),
        needs_investigation: needsInvestigation,
        failure_counts: failureCounts,
      } as Record<string, unknown>);
    }

    if (!postId) {
      log("no actionable unsyndicated posts (all pending, needs_investigation, or over failure limit)");
      return "skip";
    }

    // Check X post budget before queuing — if exhausted, wait for next 30-min sensor run
    if (!(await hasPostBudget())) {
      log(`X post budget exhausted (${POSTS_DAILY_LIMIT}/day), skipping — will retry next run`);
      return "skip";
    }

    const taskSource = `sensor:blog-x-syndication:${postId}`;

    if (pendingTaskExistsForSource(taskSource)) {
      log(`task already pending for ${postId}`);
      return "skip";
    }

    // Read title for task subject
    let title = postId;
    try {
      const file = readdirSync(blogDir).find((f) => f.startsWith(postId));
      if (file) {
        const content = readFileSync(join(blogDir, file), "utf-8");
        const parsed = parseTitle(content);
        if (parsed) title = parsed;
      }
    } catch {
      // non-fatal — use postId as fallback
    }

    const postUrl = `https://arc0.me/blog/${postId}/`;

    insertTask({
      subject: `Syndicate to X: ${title}`,
      description:
        `New blog post published on arc0.me that hasn't been shared on X yet.\n\n` +
        `Post ID: ${postId}\n` +
        `URL: ${postUrl}\n\n` +
        `Steps:\n` +
        `1. Read the post: arc skills run --name blog-publishing -- show --id ${postId}\n` +
        `2. Check budget: arc skills run --name social-x-posting -- budget\n` +
        `   - If posts remaining == 0, stop here. Run: arc skills run --name blog-x-syndication -- mark-failed --post-id ${postId}\n` +
        `3. Craft an X post that:\n` +
        `   - Leads with the sharpest insight or surprising angle from the post\n` +
        `   - Explains WHY it matters — not just the title + link\n` +
        `   - Ends with the URL: ${postUrl}\n` +
        `   - Uses Arc's voice: direct, precise, genuine\n` +
        `   - No "check out my post" openers. No filler. Max 1 hashtag.\n` +
        `4. Post: arc skills run --name social-x-posting -- post --text "<your tweet>"\n` +
        `5a. On success: arc skills run --name blog-x-syndication -- mark-syndicated --post-id ${postId} --tweet-id <tweet-id>\n` +
        `5b. On failure: arc skills run --name blog-x-syndication -- mark-failed --post-id ${postId}`,
      source: taskSource,
      priority: 5,
      model: "sonnet",
      skills: JSON.stringify(["blog-x-syndication", "social-x-posting", "blog-publishing"]),
    });

    log(`queued syndication task for ${postId} (${unsyndicated.length - 1} more pending)`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
