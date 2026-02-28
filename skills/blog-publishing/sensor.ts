// skills/blog-publishing/sensor.ts
// Auto-detect unpublished drafts and scheduled posts ready for publishing

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import * as path from "path";
import * as fs from "fs";

const SENSOR_NAME = "blog-publishing";
const INTERVAL_MINUTES = 60;

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

    log("no action needed");
    return "skip";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
