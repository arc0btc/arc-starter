#!/usr/bin/env bun
// skills/blog-publishing/cli.ts
// CLI for blog post management with ISO8601 pattern

import { initDatabase } from "../../src/db.ts";
import * as path from "path";
import * as fs from "fs";

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [blog-publishing/cli] ${msg}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function getPostsDir(): string {
  return path.join(process.cwd(), "github/arc0btc/arc0me-site/content");
}

function getCurrentIso8601(): string {
  return new Date().toISOString();
}

function getYearMonthDay(iso8601: string = getCurrentIso8601()): { year: string; date: string } {
  const d = new Date(iso8601);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return {
    year,
    date: `${year}-${month}-${day}`,
  };
}

// ---- Subcommands ----

async function cmdCreate(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.title) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- create --title <title> [--slug <slug>] [--tags <tag1,tag2>]\n");
    process.exit(1);
  }

  const title = flags.title;
  const slug = flags.slug || slugify(title);
  const tags = flags.tags ? flags.tags.split(",").map((t) => t.trim()) : [];
  const now = getCurrentIso8601();
  const { year, date } = getYearMonthDay(now);

  const postsDir = getPostsDir();
  const postDir = path.join(postsDir, year, date, slug);

  // Create directory structure
  try {
    await Bun.file(postDir).mkdir({ recursive: true });
  } catch (e) {
    log(`warning: directory may already exist: ${postDir}`);
  }

  // Create frontmatter
  const tagsYaml = tags.length > 0 ? `\ntags:\n${tags.map((t) => `  - ${t}`).join("\n")}` : "";
  const frontmatter = `---
title: "${title}"
date: ${now}
updated: ${now}
draft: true${tagsYaml}
---

# ${title}

*Write your post content here.*
`;

  const indexPath = path.join(postDir, "index.md");
  await Bun.write(indexPath, frontmatter);

  const postId = `${date}-${slug}`;
  log(`created draft post: ${postId}`);
  console.log(JSON.stringify({ success: true, post_id: postId, path: indexPath, status: "draft" }, null, 2));
}

async function cmdList(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const status = flags.status || "all";

  const postsDir = getPostsDir();

  try {
    const entries = await Bun.file(postsDir).text();
  } catch (e) {
    log(`posts directory not found: ${postsDir}`);
    console.log(JSON.stringify({ success: false, error: "Posts directory not found" }, null, 2));
    process.exit(1);
  }

  // Scan directory structure: YYYY/YYYY-MM-DD/slug/index.md
  const posts: Array<{ post_id: string; path: string; date: string }> = [];

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
          if (fs.existsSync(indexPath)) {
            const postId = `${dateDir.name}-${slugDir.name}`;
            posts.push({ post_id: postId, path: indexPath, date: dateDir.name });
          }
        }
      }
    }
  } catch (e) {
    log(`error scanning posts: ${e instanceof Error ? e.message : String(e)}`);
    console.log(JSON.stringify({ success: false, error: "Failed to scan posts directory" }, null, 2));
    process.exit(1);
  }

  log(`found ${posts.length} posts`);
  console.log(JSON.stringify({ success: true, posts, status }, null, 2));
}

async function cmdShow(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- show --id <post-id>\n");
    process.exit(1);
  }

  const postId = flags.id;
  const [date, ...slugParts] = postId.split("-");
  const slug = slugParts.join("-");
  const [year] = date.split("-");

  const postsDir = getPostsDir();
  const indexPath = path.join(postsDir, year, date, slug, "index.md");

  try {
    const content = await Bun.file(indexPath).text();
    log(`retrieved post: ${postId}`);
    console.log(content);
  } catch (e) {
    log(`post not found: ${postId}`);
    process.stderr.write(`Post not found: ${postId}\n`);
    process.exit(1);
  }
}

async function cmdPublish(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- publish --id <post-id>\n");
    process.exit(1);
  }

  const postId = flags.id;
  const [date, ...slugParts] = postId.split("-");
  const slug = slugParts.join("-");
  const [year] = date.split("-");

  const postsDir = getPostsDir();
  const indexPath = path.join(postsDir, year, date, slug, "index.md");

  try {
    let content = await Bun.file(indexPath).text();

    // Update draft: false and set published_at
    const now = getCurrentIso8601();
    content = content.replace(/draft:\s*true/i, "draft: false").replace(/^(---\n[\s\S]*?updated:\s*[^\n]+\n)/m, (match) => {
      return match + `published_at: ${now}\n`;
    });

    await Bun.write(indexPath, content);
    log(`published post: ${postId}`);
    console.log(JSON.stringify({ success: true, post_id: postId, status: "published", published_at: now }, null, 2));
  } catch (e) {
    log(`failed to publish: ${e instanceof Error ? e.message : String(e)}`);
    process.stderr.write(`Failed to publish post: ${postId}\n`);
    process.exit(1);
  }
}

async function cmdSchedule(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id || !flags.for) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- schedule --id <post-id> --for <iso8601>\n");
    process.exit(1);
  }

  const postId = flags.id;
  const scheduledFor = flags.for;
  const [date, ...slugParts] = postId.split("-");
  const slug = slugParts.join("-");
  const [year] = date.split("-");

  const postsDir = getPostsDir();
  const indexPath = path.join(postsDir, year, date, slug, "index.md");

  try {
    let content = await Bun.file(indexPath).text();

    // Add scheduled_for field
    content = content.replace(/^(---\n[\s\S]*?updated:\s*[^\n]+\n)/m, (match) => {
      return match + `scheduled_for: ${scheduledFor}\n`;
    });

    await Bun.write(indexPath, content);
    log(`scheduled post: ${postId} for ${scheduledFor}`);
    console.log(JSON.stringify({ success: true, post_id: postId, status: "scheduled", scheduled_for: scheduledFor }, null, 2));
  } catch (e) {
    log(`failed to schedule: ${e instanceof Error ? e.message : String(e)}`);
    process.stderr.write(`Failed to schedule post: ${postId}\n`);
    process.exit(1);
  }
}

async function cmdDraft(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- draft --id <post-id>\n");
    process.exit(1);
  }

  const postId = flags.id;
  const [date, ...slugParts] = postId.split("-");
  const slug = slugParts.join("-");
  const [year] = date.split("-");

  const postsDir = getPostsDir();
  const indexPath = path.join(postsDir, year, date, slug, "index.md");

  try {
    let content = await Bun.file(indexPath).text();

    // Set draft: true
    content = content.replace(/draft:\s*(true|false)/i, "draft: true");

    await Bun.write(indexPath, content);
    log(`reverted post to draft: ${postId}`);
    console.log(JSON.stringify({ success: true, post_id: postId, status: "draft" }, null, 2));
  } catch (e) {
    log(`failed to revert to draft: ${e instanceof Error ? e.message : String(e)}`);
    process.stderr.write(`Failed to revert post to draft: ${postId}\n`);
    process.exit(1);
  }
}

async function cmdDelete(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    process.stderr.write("Usage: arc skills run --name blog-publishing -- delete --id <post-id>\n");
    process.exit(1);
  }

  const postId = flags.id;
  const [date, ...slugParts] = postId.split("-");
  const slug = slugParts.join("-");
  const [year] = date.split("-");

  const postsDir = getPostsDir();
  const postDir = path.join(postsDir, year, date, slug);

  try {
    // Remove directory recursively
    const rm = await Bun.spawn(["rm", "-rf", postDir]);
    if (rm.exitCode !== 0) throw new Error(`rm exited with code ${rm.exitCode}`);

    log(`deleted post: ${postId}`);
    console.log(JSON.stringify({ success: true, post_id: postId, deleted: true }, null, 2));
  } catch (e) {
    log(`failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    process.stderr.write(`Failed to delete post: ${postId}\n`);
    process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`blog-publishing CLI

USAGE
  arc skills run --name blog-publishing -- <subcommand> [flags]

SUBCOMMANDS
  create --title <title> [--slug <slug>] [--tags <tag1,tag2>]
    Create a new draft post with ISO8601 timestamp.

  list [--status draft|published|scheduled]
    List all posts or filter by status.

  show --id <post-id>
    Display post content (YYYY-MM-DD-slug).

  publish --id <post-id>
    Set draft: false and mark as published.

  draft --id <post-id>
    Revert a post to draft status.

  schedule --id <post-id> --for <iso8601>
    Schedule post for future publication (2026-03-01T09:00:00Z).

  delete --id <post-id>
    Remove post directory and files.

EXAMPLES
  arc skills run --name blog-publishing -- create --title "My First Post" --tags "stacks,bitcoin"
  arc skills run --name blog-publishing -- list
  arc skills run --name blog-publishing -- show --id 2026-02-28-my-first-post
  arc skills run --name blog-publishing -- publish --id 2026-02-28-my-first-post
  arc skills run --name blog-publishing -- schedule --id 2026-02-28-future --for 2026-03-01T09:00:00Z
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "create":
      await cmdCreate(args.slice(1));
      break;
    case "list":
      await cmdList(args.slice(1));
      break;
    case "show":
      await cmdShow(args.slice(1));
      break;
    case "publish":
      await cmdPublish(args.slice(1));
      break;
    case "draft":
      await cmdDraft(args.slice(1));
      break;
    case "schedule":
      await cmdSchedule(args.slice(1));
      break;
    case "delete":
      await cmdDelete(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
