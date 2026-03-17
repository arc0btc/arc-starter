#!/usr/bin/env bun
// skills/blog-x-syndication/cli.ts
// CLI for blog-to-X syndication management.
//
// Commands:
//   syndicate --post-id <id>                       — manually trigger syndication task for a post
//   mark-syndicated --post-id <id> --tweet-id <id> — record that a post has been syndicated
//   status                                         — show syndication state

import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "blog-x-syndication";
const MAX_FAILURES_BEFORE_INVESTIGATION = 3;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [blog-x-syndication/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function getBlogDir(): string {
  return join(process.cwd(), "github/arc0btc/arc0me-site/src/content/docs/blog");
}

function isDraft(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return true;
  return match[1].split("\n").some((l) => l.startsWith("draft:") && l.includes("true"));
}

function parseTitle(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const titleLine = match[1].split("\n").find((l) => l.startsWith("title:"));
  if (!titleLine) return "";
  return titleLine.replace(/^title:\s*["']?/, "").replace(/["']?$/, "").trim();
}

async function getSyndicatedIds(): Promise<string[]> {
  const state = await readHookState(SENSOR_NAME);
  return (state as Record<string, unknown> | null)?.syndicated_post_ids as string[] ?? [];
}

async function cmdSyndicate(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  if (!flags["post-id"]) {
    process.stderr.write("Usage: arc skills run --name blog-x-syndication -- syndicate --post-id <post-id>\n");
    process.exit(1);
  }

  const postId = flags["post-id"];
  const syndicatedIds = await getSyndicatedIds();

  if (syndicatedIds.includes(postId)) {
    console.log(JSON.stringify({ status: "already_syndicated", post_id: postId }));
    return;
  }

  const taskSource = `sensor:blog-x-syndication:${postId}`;
  if (pendingTaskExistsForSource(taskSource)) {
    console.log(JSON.stringify({ status: "task_pending", post_id: postId }));
    return;
  }

  const postUrl = `https://arc0.me/blog/${postId}/`;

  // Try to read title
  let title = postId;
  const blogDir = getBlogDir();
  if (existsSync(blogDir)) {
    try {
      const file = readdirSync(blogDir).find((f) => f.startsWith(postId));
      if (file) {
        const content = readFileSync(join(blogDir, file), "utf-8");
        const parsed = parseTitle(content);
        if (parsed) title = parsed;
      }
    } catch {
      // non-fatal
    }
  }

  insertTask({
    subject: `Syndicate to X: ${title}`,
    description:
      `Manual syndication request for blog post.\n\n` +
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

  log(`queued syndication task for ${postId}`);
  console.log(JSON.stringify({ status: "queued", post_id: postId, url: postUrl }));
}

async function cmdMarkFailed(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  if (!flags["post-id"]) {
    process.stderr.write(
      "Usage: arc skills run --name blog-x-syndication -- mark-failed --post-id <id>\n"
    );
    process.exit(1);
  }

  const postId = flags["post-id"];
  const state = await readHookState(SENSOR_NAME);
  const failureCounts: Record<string, number> =
    (state as Record<string, unknown> | null)?.failure_counts as Record<string, number> ?? {};
  const needsInvestigation: string[] =
    (state as Record<string, unknown> | null)?.needs_investigation as string[] ?? [];

  const prevCount = failureCounts[postId] ?? 0;
  const newCount = prevCount + 1;
  failureCounts[postId] = newCount;

  if (newCount >= MAX_FAILURES_BEFORE_INVESTIGATION && !needsInvestigation.includes(postId)) {
    needsInvestigation.push(postId);
    log(`${postId} reached ${newCount} failures — moved to needs_investigation`);
  } else {
    log(`${postId} failure count: ${newCount}`);
  }

  await writeHookState(SENSOR_NAME, {
    ...(state as Record<string, unknown> ?? {}),
    failure_counts: failureCounts,
    needs_investigation: needsInvestigation,
  } as Record<string, unknown>);

  console.log(JSON.stringify({
    status: newCount >= MAX_FAILURES_BEFORE_INVESTIGATION ? "needs_investigation" : "failure_recorded",
    post_id: postId,
    failure_count: newCount,
    needs_investigation: needsInvestigation.includes(postId),
  }));
}

async function cmdMarkSyndicated(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  if (!flags["post-id"] || !flags["tweet-id"]) {
    process.stderr.write(
      "Usage: arc skills run --name blog-x-syndication -- mark-syndicated --post-id <id> --tweet-id <id>\n"
    );
    process.exit(1);
  }

  const postId = flags["post-id"];
  const tweetId = flags["tweet-id"];

  const state = await readHookState(SENSOR_NAME);
  const existing = (state as Record<string, unknown> | null)?.syndicated_post_ids as string[] ?? [];

  if (!existing.includes(postId)) {
    const syndicationLog = (state as Record<string, unknown> | null)?.syndication_log as Record<string, string>[] ?? [];
    syndicationLog.push({ post_id: postId, tweet_id: tweetId, syndicated_at: new Date().toISOString() });

    await writeHookState(SENSOR_NAME, {
      ...(state as Record<string, unknown> ?? {}),
      last_ran: new Date().toISOString(),
      last_result: "ok" as const,
      syndicated_post_ids: [...existing, postId],
      syndication_log: syndicationLog,
    });

    log(`marked ${postId} as syndicated (tweet ${tweetId})`);
    console.log(JSON.stringify({ status: "ok", post_id: postId, tweet_id: tweetId }));
  } else {
    log(`${postId} was already marked as syndicated`);
    console.log(JSON.stringify({ status: "already_syndicated", post_id: postId }));
  }
}

async function cmdStatus(): Promise<void> {
  const blogDir = getBlogDir();
  const state = await readHookState(SENSOR_NAME);
  const syndicatedIds = (state as Record<string, unknown> | null)?.syndicated_post_ids as string[] ?? [];
  const syndicationLog = (state as Record<string, unknown> | null)?.syndication_log as Record<string, string>[] ?? [];
  const failureCounts = (state as Record<string, unknown> | null)?.failure_counts as Record<string, number> ?? {};
  const needsInvestigation = (state as Record<string, unknown> | null)?.needs_investigation as string[] ?? [];

  let publishedCount = 0;
  let unsyndicatedPosts: string[] = [];

  if (existsSync(blogDir)) {
    try {
      const files = readdirSync(blogDir).filter(
        (f) => f.endsWith(".mdx") && f !== "index.mdx"
      );
      for (const file of files) {
        const content = readFileSync(join(blogDir, file), "utf-8");
        if (!isDraft(content)) {
          publishedCount++;
          const postId = file.replace(/\.mdx$/, "");
          if (!syndicatedIds.includes(postId)) {
            unsyndicatedPosts.push(postId);
          }
        }
      }
    } catch (e) {
      console.error(`error scanning blog: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  unsyndicatedPosts.sort((a, b) => b.localeCompare(a));

  console.log(JSON.stringify({
    published_posts: publishedCount,
    syndicated_count: syndicatedIds.length,
    unsyndicated_count: unsyndicatedPosts.length,
    unsyndicated_posts: unsyndicatedPosts,
    needs_investigation: needsInvestigation,
    failure_counts: failureCounts,
    last_ran: (state as Record<string, unknown> | null)?.last_ran ?? null,
    recent_syndications: syndicationLog.slice(-5),
  }, null, 2));
}

// ---- Entry point ----

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "syndicate":
    await cmdSyndicate(rest);
    break;
  case "mark-syndicated":
    await cmdMarkSyndicated(rest);
    break;
  case "mark-failed":
    await cmdMarkFailed(rest);
    break;
  case "status":
    await cmdStatus();
    break;
  default:
    process.stderr.write(
      `Usage: arc skills run --name blog-x-syndication -- <command> [options]\n\n` +
      `Commands:\n` +
      `  syndicate --post-id <id>                       Queue syndication task for a post\n` +
      `  mark-syndicated --post-id <id> --tweet-id <id> Record that a post has been syndicated\n` +
      `  mark-failed --post-id <id>                     Record syndication failure (auto-escalates at 3 failures)\n` +
      `  status                                         Show syndication state\n`
    );
    process.exit(1);
}
