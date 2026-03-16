// skills/arc-moltbook/cli.ts
// CLI for Moltbook integration: post, crosspost, feed, vote, mentions, status

import { getCredential } from "../../src/credentials.ts";

const API_BASE = "https://moltbook.com/api";

function log(message: string): void {
  console.log(`[arc-moltbook] ${message}`);
}

function logError(message: string): void {
  console.error(`[arc-moltbook] error: ${message}`);
}

function parseArgs(args: string[]): {
  command: string;
  params: Record<string, string | boolean>;
  help: boolean;
} {
  const command = (args[0] || "") as string;
  const params: Record<string, string | boolean> = {};
  let help = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--help") {
      help = true;
    } else if (args[i]?.startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
      }
    }
  }

  return { command, params, help };
}

function getToken(): string {
  try {
    const token = getCredential("moltbook", "session_token");
    if (!token) throw new Error("empty");
    return token;
  } catch {
    logError("No session token. Set with: arc creds set --service moltbook --key session_token --value <token>");
    process.exit(1);
  }
}

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = getToken();
  const url = `${API_BASE}${path}`;

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 401) {
    logError("Session token expired or invalid. Re-authenticate via X linking.");
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text();
    logError(`API ${method} ${path} failed (${response.status}): ${text}`);
    process.exit(1);
  }

  return (await response.json()) as Record<string, unknown>;
}

async function cmdPost(params: Record<string, string | boolean>): Promise<void> {
  const title = params.title as string;
  const content = params.content as string;
  const tags = params.tags as string | undefined;

  if (!title || !content) {
    logError("Missing required flags: --title, --content");
    console.log("Usage: arc skills run --name arc-moltbook -- post --title 'Title' --content 'Body' [--tags tag1,tag2]");
    process.exit(1);
  }

  const body: Record<string, unknown> = { title, content };
  if (tags) {
    body.tags = (tags as string).split(",").map((t) => t.trim());
  }

  log(`Posting: ${title}`);
  const result = await apiRequest("POST", "/posts", body);
  log(`Posted successfully. ID: ${result.id || "(unknown)"}`);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdCrosspost(params: Record<string, string | boolean>): Promise<void> {
  const postId = params["post-id"] as string;

  if (!postId) {
    logError("Missing required flag: --post-id (blog post ID, e.g. 2026-03-16-my-post)");
    process.exit(1);
  }

  // Find the blog post on disk
  const parts = postId.split("-");
  if (parts.length < 4) {
    logError("Invalid post-id format. Expected: YYYY-MM-DD-slug");
    process.exit(1);
  }

  const year = parts[0];
  const date = parts.slice(0, 3).join("-");
  const slug = parts.slice(3).join("-");
  const postPath = `content/${year}/${date}/${slug}/index.md`;

  let fileContent: string;
  try {
    fileContent = await Bun.file(postPath).text();
  } catch {
    // Try alternate path patterns
    const altPath = `github/arc0btc/arc0me-site/content/${year}/${date}/${slug}/index.md`;
    try {
      fileContent = await Bun.file(altPath).text();
    } catch {
      logError(`Blog post not found at ${postPath} or ${altPath}`);
      process.exit(1);
    }
  }

  // Extract frontmatter and content
  const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    logError("Could not parse blog post frontmatter");
    process.exit(1);
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Extract title from frontmatter
  const titleMatch = frontmatter.match(/title:\s*"?([^"\n]+)"?/);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  // Extract tags
  const tagsSection = frontmatter.match(/tags:\n((?:\s+-\s+.+\n?)*)/);
  const tags: string[] = [];
  if (tagsSection) {
    const tagLines = tagsSection[1].matchAll(/\s+-\s+(.+)/g);
    for (const m of tagLines) {
      tags.push(m[1].trim());
    }
  }

  // Create summary: first 2-3 paragraphs, max 400 words
  const paragraphs = body
    .split(/\n\n+/)
    .filter((p) => p.trim() && !p.startsWith("#") && !p.startsWith("```"))
    .slice(0, 3);

  const summary = paragraphs.join("\n\n").split(/\s+/).slice(0, 400).join(" ");
  const moltContent = `${summary}\n\nRead more: https://arc0.me/${slug}`;

  log(`Cross-posting: ${title}`);
  log(`Summary: ${summary.split(/\s+/).length} words + link`);

  const postBody: Record<string, unknown> = {
    title,
    content: moltContent,
  };
  if (tags.length > 0) {
    postBody.tags = tags;
  }

  const result = await apiRequest("POST", "/posts", postBody);
  log(`Cross-posted successfully. Moltbook ID: ${result.id || "(unknown)"}`);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdFeed(params: Record<string, string | boolean>): Promise<void> {
  const limit = params.limit ? parseInt(params.limit as string, 10) : 20;
  log(`Fetching feed (limit: ${limit})...`);

  const result = await apiRequest("GET", `/feed?limit=${limit}`);
  const posts = (result.posts || result.data || []) as Array<Record<string, unknown>>;

  if (posts.length === 0) {
    log("Feed is empty.");
    return;
  }

  for (const post of posts) {
    const author = post.author || post.username || "unknown";
    const title = post.title || "(untitled)";
    const id = post.id || "?";
    const votes = post.votes || post.submolts || 0;
    console.log(`  [${id}] ${author}: ${title} (${votes} votes)`);
  }

  log(`Showing ${posts.length} posts`);
}

async function cmdVote(params: Record<string, string | boolean>): Promise<void> {
  const postId = params["post-id"] as string;

  if (!postId) {
    logError("Missing required flag: --post-id");
    process.exit(1);
  }

  log(`Voting on post ${postId}...`);
  const result = await apiRequest("POST", `/posts/${postId}/vote`, {});
  log(`Vote registered on post ${postId}`);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdMentions(params: Record<string, string | boolean>): Promise<void> {
  const limit = params.limit ? parseInt(params.limit as string, 10) : 20;
  log(`Checking mentions (limit: ${limit})...`);

  const result = await apiRequest("GET", `/notifications?limit=${limit}`);
  const notifications = (result.notifications || []) as Array<Record<string, unknown>>;

  if (notifications.length === 0) {
    log("No mentions or notifications.");
    return;
  }

  for (const n of notifications) {
    const type = n.type || "notification";
    const from = n.from_user || "unknown";
    const preview = ((n.content || "") as string).slice(0, 80);
    console.log(`  [${type}] ${from}: ${preview}`);
  }

  log(`${notifications.length} notifications`);
}

async function cmdStatus(): Promise<void> {
  log("Checking Moltbook integration status...");

  let hasToken = false;
  try {
    const token = getCredential("moltbook", "session_token");
    hasToken = !!token;
  } catch {
    hasToken = false;
  }

  let username = "(not set)";
  try {
    const u = getCredential("moltbook", "username");
    if (u) username = u;
  } catch {
    // ignore
  }

  console.log(`  Token:    ${hasToken ? "configured" : "NOT SET"}`);
  console.log(`  Username: ${username}`);
  console.log(`  API Base: ${API_BASE}`);

  if (!hasToken) {
    console.log("\n  Account not yet configured. Steps:");
    console.log("  1. Recover account (task #6068) or create new one");
    console.log("  2. arc creds set --service moltbook --key session_token --value <token>");
    console.log("  3. arc creds set --service moltbook --key username --value arc0btc");
  } else {
    // Try a simple API call to verify
    try {
      const response = await fetch(`${API_BASE}/users/${username}`, {
        headers: { Authorization: `Bearer ${getCredential("moltbook", "session_token")}` },
      });
      console.log(`  API Check: ${response.ok ? "OK" : `Failed (${response.status})`}`);
    } catch (e) {
      console.log(`  API Check: Unreachable (${(e as Error).message})`);
    }
  }
}

async function main(): Promise<void> {
  const { command, params, help } = parseArgs(process.argv.slice(2));

  if (help || !command) {
    console.log(`
Moltbook Integration CLI

Commands:
  post          Create a new post on Moltbook
  crosspost     Cross-post a blog entry from arc0.me
  feed          View the Moltbook feed
  vote          Vote (submolt) on a post
  mentions      Check mentions and notifications
  status        Check integration status

post flags:
  --title <text>         Post title (required)
  --content <text>       Post body (required)
  --tags <tag1,tag2>     Comma-separated tags

crosspost flags:
  --post-id <id>         Blog post ID, e.g. 2026-03-16-my-post (required)

feed flags:
  --limit <N>            Number of posts to show (default: 20)

vote flags:
  --post-id <id>         Moltbook post ID to vote on (required)

mentions flags:
  --limit <N>            Number of notifications (default: 20)

Examples:
  arc skills run --name arc-moltbook -- status
  arc skills run --name arc-moltbook -- post --title "Hello Moltbook" --content "Arc here."
  arc skills run --name arc-moltbook -- crosspost --post-id 2026-03-16-bitcoin-agents
  arc skills run --name arc-moltbook -- feed --limit 10
  arc skills run --name arc-moltbook -- vote --post-id abc123
  arc skills run --name arc-moltbook -- mentions
    `);
    return;
  }

  switch (command) {
    case "post":
      await cmdPost(params);
      break;
    case "crosspost":
      await cmdCrosspost(params);
      break;
    case "feed":
      await cmdFeed(params);
      break;
    case "vote":
      await cmdVote(params);
      break;
    case "mentions":
      await cmdMentions(params);
      break;
    case "status":
      await cmdStatus();
      break;
    default:
      logError(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((e) => {
  logError(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
