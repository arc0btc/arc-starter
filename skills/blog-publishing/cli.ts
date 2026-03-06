#!/usr/bin/env bun
// skills/blog-publishing/cli.ts
// CLI for blog post management with ISO8601 pattern

import { initDatabase } from "../../src/db.ts";
import * as path from "path";
import * as fs from "fs";

// ---- Helpers ----

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [blog-publishing/cli] ${message}`);
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

function getBlogDocsDir(): string {
  return path.join(process.cwd(), "github/arc0btc/arc0me-site/src/content/docs/blog");
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
  // postId format: YYYY-MM-DD-slug
  const date = postId.substring(0, 10);
  const slug = postId.substring(11);
  const year = date.substring(0, 4);

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
    process.stderr.write("Usage: arc skills run --name blog-publishing -- publish --id <post-id> [--force]\n");
    process.exit(1);
  }

  const postId = flags.id;
  const force = flags.force !== undefined;
  // postId format: YYYY-MM-DD-slug
  const date = postId.substring(0, 10);
  const slug = postId.substring(11);
  const year = date.substring(0, 4);

  const postsDir = getPostsDir();
  const indexPath = path.join(postsDir, year, date, slug, "index.md");

  try {
    let content = await Bun.file(indexPath).text();

    // Pre-flight: content-quality gate (skip with --force)
    if (!force) {
      // Strip frontmatter to get the post body
      const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      log(`running content-quality gate (${bodyContent.length} chars)`);

      const gate = Bun.spawn(
        ["bash", "bin/arc", "skills", "run", "--name", "arc-content-quality", "--", "gate",
          "--content", bodyContent, "--type", "blog"],
        { cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );

      const [gateOut, gateErr] = await Promise.all([
        new Response(gate.stdout).text(),
        new Response(gate.stderr).text(),
      ]);
      const gateExit = await gate.exited;

      if (gateExit === 2) {
        const message = (gateErr || gateOut).trim();
        log(`content-quality gate FAILED — aborting publish`);
        process.stderr.write(`BLOCKED: content-quality gate failed for ${postId}\n${message}\nFix content or use --force to bypass.\n`);
        console.log(JSON.stringify({ success: false, post_id: postId, blocked: true, reason: message }, null, 2));
        process.exit(1);
      } else if (gateExit !== 0) {
        const message = (gateErr || gateOut).trim();
        log(`content-quality gate error (exit ${gateExit})`);
        process.stderr.write(`content-quality gate error: ${message}\n`);
        process.exit(1);
      } else {
        const message = (gateOut || gateErr).trim();
        if (message) log(`content-quality: ${message}`);
      }
    } else {
      log(`--force: skipping content-quality gate`);
    }

    // Update draft: false and set published_at
    const now = getCurrentIso8601();
    content = content.replace(/draft:\s*true/i, "draft: false").replace(/^(---\n[\s\S]*?updated:\s*[^\n]+\n)/m, (match) => {
      return match + `published_at: ${now}\n`;
    });

    await Bun.write(indexPath, content);
    log(`published post: ${postId}`);

    // Sync to src/content/docs/blog/<post-id>.mdx for Astro
    const blogDocsDir = getBlogDocsDir();
    const mdxPath = path.join(blogDocsDir, `${postId}.mdx`);
    try {
      fs.mkdirSync(blogDocsDir, { recursive: true });
      await Bun.write(mdxPath, content);
      log(`synced to blog docs: ${mdxPath}`);
    } catch (syncErr) {
      log(`warning: failed to sync to blog docs: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`);
    }

    console.log(JSON.stringify({ success: true, post_id: postId, status: "published", published_at: now, mdx_path: mdxPath }, null, 2));
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
  // postId format: YYYY-MM-DD-slug
  const date = postId.substring(0, 10);
  const slug = postId.substring(11);
  const year = date.substring(0, 4);

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
  // postId format: YYYY-MM-DD-slug
  const date = postId.substring(0, 10);
  const slug = postId.substring(11);
  const year = date.substring(0, 4);

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
  // postId format: YYYY-MM-DD-slug
  const date = postId.substring(0, 10);
  const slug = postId.substring(11);
  const year = date.substring(0, 4);

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

async function cmdVerifyDeploy(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const siteUrl = flags.url || "https://arc0.me";
  const timeout = parseInt(flags.timeout || "10", 10) * 1000;

  const checks: Array<{ name: string; status: string; details?: string; error?: string }> = [];

  // Check 1: Site is accessible
  try {
    log(`checking site accessibility: ${siteUrl}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(siteUrl, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok || response.status === 301 || response.status === 302) {
      checks.push({ name: "Site Accessible", status: "pass", details: `HTTP ${response.status}` });
    } else {
      checks.push({ name: "Site Accessible", status: "fail", error: `HTTP ${response.status}` });
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    checks.push({ name: "Site Accessible", status: "fail", error: errorMsg });
  }

  // Check 2: Find latest published posts
  let publishedPosts: Array<{ post_id: string; title: string; date: string }> = [];
  try {
    log("scanning for published posts");
    const postsDir = getPostsDir();
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
            try {
              const content = fs.readFileSync(indexPath, "utf-8");
              // Check if draft: false (published)
              if (/draft:\s*false/i.test(content)) {
                // Extract title from frontmatter
                const titleMatch = content.match(/title:\s*"([^"]+)"/);
                const title = titleMatch ? titleMatch[1] : slugDir.name;
                const postId = `${dateDir.name}-${slugDir.name}`;
                publishedPosts.push({ post_id: postId, title, date: dateDir.name });
              }
            } catch (e) {
              // Skip posts that can't be read
            }
          }
        }
      }
    }

    // Sort by date descending and take top 5
    publishedPosts = publishedPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

    checks.push({
      name: "Published Posts Found",
      status: publishedPosts.length > 0 ? "pass" : "warn",
      details: `${publishedPosts.length} published posts`,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    checks.push({ name: "Published Posts Found", status: "fail", error: errorMsg });
  }

  // Check 3: Verify recent posts are served
  if (publishedPosts.length > 0) {
    log("verifying deployed content");
    const recentPost = publishedPosts[0];
    const postSlug = recentPost.post_id.substring(11); // Remove date part

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const postUrl = `${siteUrl}/${recentPost.date}/${postSlug}/`;
      const response = await fetch(postUrl, { signal: controller.signal });

      clearTimeout(timeoutId);

      if (response.ok) {
        const html = await response.text();
        // Simple check: does the post title appear in the response?
        if (html.includes(recentPost.title)) {
          checks.push({
            name: "Recent Post Content",
            status: "pass",
            details: `Latest post "${recentPost.title}" is served`,
          });
        } else {
          checks.push({
            name: "Recent Post Content",
            status: "warn",
            details: `Post accessible but title not found in response`,
          });
        }
      } else {
        checks.push({
          name: "Recent Post Content",
          status: "fail",
          error: `HTTP ${response.status} for ${postSlug}`,
        });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      checks.push({ name: "Recent Post Content", status: "fail", error: errorMsg });
    }
  }

  // Summary
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const overallStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";

  log(`verification complete: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
  console.log(
    JSON.stringify(
      {
        success: overallStatus !== "fail",
        status: overallStatus,
        site_url: siteUrl,
        checks,
        summary: {
          passed: passCount,
          warnings: warnCount,
          failed: failCount,
        },
      },
      null,
      2
    )
  );

  process.exit(failCount > 0 ? 1 : 0);
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

  publish --id <post-id> [--force]
    Set draft: false and mark as published.
    Runs content-quality gate pre-flight; use --force to bypass.

  draft --id <post-id>
    Revert a post to draft status.

  schedule --id <post-id> --for <iso8601>
    Schedule post for future publication (2026-03-01T09:00:00Z).

  delete --id <post-id>
    Remove post directory and files.

  verify-deploy [--url <url>] [--timeout <seconds>]
    Verify that the blog is deployed and accessible. Checks site health,
    finds published posts, and verifies recent content is served.
    Default URL: https://arc0.me, default timeout: 10 seconds.

EXAMPLES
  arc skills run --name blog-publishing -- create --title "My First Post" --tags "stacks,bitcoin"
  arc skills run --name blog-publishing -- list
  arc skills run --name blog-publishing -- show --id 2026-02-28-my-first-post
  arc skills run --name blog-publishing -- publish --id 2026-02-28-my-first-post
  arc skills run --name blog-publishing -- schedule --id 2026-02-28-future --for 2026-03-01T09:00:00Z
  arc skills run --name blog-publishing -- verify-deploy
  arc skills run --name blog-publishing -- verify-deploy --url https://arc0.me --timeout 15
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
    case "verify-deploy":
      await cmdVerifyDeploy(args.slice(1));
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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
