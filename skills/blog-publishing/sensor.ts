// skills/blog-publishing/sensor.ts
// Auto-detect weekly cadence gaps and scheduled posts ready for publishing

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const SENSOR_NAME = "blog-publishing";
const INTERVAL_MINUTES = 60;
const CADENCE_DAYS_THRESHOLD = 2; // days between blog posts

const log = createSensorLogger(SENSOR_NAME);

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

    // Queue task for oldest draft
    if (oldestDraft) {
      const source = `sensor:blog-publishing:draft:${oldestDraft.postId}`;
      if (!pendingTaskExistsForSource(source)) {
        insertTask({
          subject: `Review draft: ${oldestDraft.postId}`,
          description: `Oldest unpublished draft post. Review and publish if ready.`,
          source,
          priority: 5,
          model: "sonnet",
          skills: JSON.stringify(["blog-publishing"]),
        });
        log(`queued draft review: ${oldestDraft.postId}`);
        return "ok";
      }
    }

    // Queue task for scheduled post ready to publish
    if (scheduledReady) {
      const source = `sensor:blog-publishing:scheduled:${scheduledReady.postId}`;
      if (!pendingTaskExistsForSource(source)) {
        insertTask({
          subject: `Publish scheduled post: ${scheduledReady.postId}`,
          description: `Scheduled post is ready (was scheduled for ${scheduledReady.scheduledFor}).`,
          source,
          priority: 6,
          model: "haiku",
          skills: JSON.stringify(["blog-publishing"]),
        });
        log(`queued scheduled post publish: ${scheduledReady.postId}`);
        return "ok";
      }
    }

    // Queue content generation if weekly cadence reached
    if (timeForNewContent) {
      const source = "sensor:blog-publishing:content-generation";
      // Dedup: skip if a generation task was created in the last 23 hours (not just pending).
      // Prevents hourly re-queuing after each completed task.
      if (!pendingTaskExistsForSource(source) && !recentTaskExistsForSourcePrefix(source, 23 * 60)) {
        insertTask({
          subject: "Generate new blog post from recent activity",
          description: "Weekly blog cadence: create draft post from recent watch reports and work summary.",
          source,
          priority: 6,
          model: "sonnet",
          skills: JSON.stringify(["blog-publishing"]),
        });
        log("queued content generation task");
        return "ok";
      }
    }

    log("no action needed");
    return "skip";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
