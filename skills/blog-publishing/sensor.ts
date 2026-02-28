// skills/blog-publishing/sensor.ts
// Auto-detect unpublished drafts and scheduled posts ready for publishing

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import * as path from "path";
import * as fs from "fs";

const SENSOR_NAME = "blog-publishing";
const INTERVAL_MINUTES = 60;
const WEEKLY_MINUTES = 7 * 24 * 60; // 7 days in minutes

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [sensor:blog-publishing] ${msg}`);
}

function getPostsDir(): string {
  return path.join(process.cwd(), "github/arc0btc/arc0me-site/content");
}

function getCurrentIso8601(): string {
  return new Date().toISOString();
}

// Parse frontmatter from post content
interface Frontmatter {
  title?: string;
  draft?: boolean;
  scheduled_for?: string;
  published_at?: string;
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
    if (line.startsWith("published_at:")) {
      fm.published_at = line.replace(/^published_at:\s*/, "").trim();
    }
  }

  return fm;
}

// Find the most recent published blog post's creation date
function getMostRecentPostDate(): Date | null {
  const postsDir = getPostsDir();
  if (!fs.existsSync(postsDir)) return null;

  let mostRecentDate: Date | null = null;

  try {
    const years = fs.readdirSync(postsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

    for (const yearDir of years) {
      const yearPath = path.join(postsDir, yearDir.name);
      const dateDirs = fs.readdirSync(yearPath, { withFileTypes: true }).filter((d) => d.isDirectory());

      for (const dateDir of dateDirs) {
        const datePath = path.join(yearPath, dateDir.name);
        const slugDirs = fs.readdirSync(datePath, { withFileTypes: true }).filter((d) => d.isDirectory());

        for (const slugDir of slugDirs) {
          const indexPath = path.join(datePath, slugDir.name, "index.md");
          if (!fs.existsSync(indexPath)) continue;

          const content = fs.readFileSync(indexPath, "utf-8");
          const fm = parseFrontmatter(content);

          // Check if published (either has published_at or draft=false)
          if (fm.published_at || (fm.draft === false)) {
            const postDate = new Date(dateDir.name);
            if (isNaN(postDate.getTime())) continue;

            if (!mostRecentDate || postDate > mostRecentDate) {
              mostRecentDate = postDate;
            }
          }
        }
      }
    }
  } catch (e) {
    log(`error scanning posts for recent date: ${e instanceof Error ? e.message : String(e)}`);
  }

  return mostRecentDate;
}

export default async function blogPublishingSensor(): Promise<string> {
  try {
    initDatabase();

    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const postsDir = getPostsDir();

    // Check if posts directory exists
    if (!fs.existsSync(postsDir)) {
      log("posts directory not found, skipping");
      return "skip";
    }

    let oldestDraft: { postId: string; date: string } | null = null;
    let scheduledReady: { postId: string; scheduledFor: string } | null = null;
    let timeForNewContent = false;

    // Check if it's time to generate new content (weekly cadence)
    const mostRecentPostDate = getMostRecentPostDate();
    if (mostRecentPostDate) {
      const now = new Date();
      const daysSinceLastPost = (now.getTime() - mostRecentPostDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastPost >= 7) {
        timeForNewContent = true;
      }
    } else {
      // No posts exist yet - time to create the first one
      timeForNewContent = true;
    }

    try {
      const years = fs.readdirSync(postsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

      for (const yearDir of years) {
        const yearPath = path.join(postsDir, yearDir.name);
        const dateDirs = fs.readdirSync(yearPath, { withFileTypes: true }).filter((d) => d.isDirectory());

        for (const dateDir of dateDirs) {
          const datePath = path.join(yearPath, dateDir.name);
          const slugDirs = fs.readdirSync(datePath, { withFileTypes: true }).filter((d) => d.isDirectory());

          for (const slugDir of slugDirs) {
            const indexPath = path.join(datePath, slugDir.name, "index.md");
            if (!fs.existsSync(indexPath)) continue;

            const content = fs.readFileSync(indexPath, "utf-8");
            const fm = parseFrontmatter(content);
            const postId = `${dateDir.name}-${slugDir.name}`;

            // Check for unpublished drafts
            if (fm.draft && !fm.published_at) {
              if (!oldestDraft || dateDir.name < oldestDraft.date) {
                oldestDraft = { postId, date: dateDir.name };
              }
            }

            // Check for scheduled posts ready to publish
            if (fm.scheduled_for && !fm.published_at) {
              const now = getCurrentIso8601();
              if (fm.scheduled_for <= now) {
                scheduledReady = { postId, scheduledFor: fm.scheduled_for };
                // Only auto-publish the first one found
                break;
              }
            }
          }
          if (scheduledReady) break;
        }
        if (scheduledReady) break;
      }
    } catch (e) {
      log(`error scanning posts: ${e instanceof Error ? e.message : String(e)}`);
      return "skip";
    }

    // Queue task for oldest draft (if exists and no pending task)
    if (oldestDraft) {
      const source = `sensor:blog-publishing:draft:${oldestDraft.postId}`;
      if (!pendingTaskExistsForSource(source)) {
        insertTask({
          subject: `Review draft: ${oldestDraft.postId}`,
          description: `Oldest unpublished draft post. Review and publish if ready.`,
          source,
          priority: 6,
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
          priority: 5,
          skills: JSON.stringify(["blog-publishing"]),
        });
        log(`queued scheduled post publish: ${scheduledReady.postId}`);
        return "ok";
      }
    }

    // Queue task for content generation if weekly cadence reached
    if (timeForNewContent) {
      const source = "sensor:blog-publishing:content-generation";
      if (!pendingTaskExistsForSource(source)) {
        insertTask({
          subject: "Generate new blog post from recent activity",
          description: "Weekly blog cadence: create draft post from recent watch reports and work summary.",
          source,
          priority: 6,
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
