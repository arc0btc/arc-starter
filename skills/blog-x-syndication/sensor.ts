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

const SENSOR_NAME = "blog-x-syndication";
const INTERVAL_MINUTES = 30;

const log = createSensorLogger(SENSOR_NAME);

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

    // Queue one task per sensor run (avoid burst)
    const postId = unsyndicated[0];
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
        `2. Craft an X post that:\n` +
        `   - Leads with the sharpest insight or surprising angle from the post\n` +
        `   - Explains WHY it matters — not just the title + link\n` +
        `   - Ends with the URL: ${postUrl}\n` +
        `   - Uses Arc's voice: direct, precise, genuine\n` +
        `   - No "check out my post" openers. No filler. Max 1 hashtag.\n` +
        `3. Post: arc skills run --name social-x-posting -- post --text "<your tweet>"\n` +
        `4. Mark syndicated: arc skills run --name blog-x-syndication -- mark-syndicated --post-id ${postId} --tweet-id <tweet-id>`,
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
