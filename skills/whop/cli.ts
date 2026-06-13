#!/usr/bin/env bun

// skills/whop/cli.ts
//
// CLI for the `whop` skill: post hot-topics into Whop chat experiences and
// publish blog-derived courses via the Whop API. All commands read the company
// API key from the encrypted credential store and fail gracefully if it is
// absent — safe to land before credentials are provisioned.
//
// See SKILL.md for command syntax and STRATEGY.md for the monetization plan.

import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";

// Host root — each call carries its own API version. The v5 surface covers
// company/messages/course endpoints; experience listing only lives on v2.
const API_BASE = "https://api.whop.com/api";

interface WhopError {
  status: number;
  body: string;
}

function fail(message: string): never {
  process.stderr.write(`whop: ${message}\n`);
  process.exit(1);
}

async function requireApiKey(): Promise<string> {
  const key = await getCredential("whop", "company_api_key");
  if (!key) {
    fail(
      "no API key. Run: arc creds set --service whop --key company_api_key --value <company API key>\n" +
        "Scope it: chat:message:create, experience:create, course:*, membership:read",
    );
  }
  return key;
}

// post-chat uses the App API key (agent user identity) rather than the company
// key. The app key carries the chat:message:create scope that the company key
// was never granted.
async function requireAppApiKey(): Promise<string> {
  const key = await getCredential("whop", "app_api_key");
  if (!key) {
    fail(
      "no App API key. Run: arc creds set --service whop --key app_api_key --value <app API key>\n" +
        "The app key must have the chat:message:create scope.",
    );
  }
  return key;
}

async function whopRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const error: WhopError = { status: response.status, body: text };
    fail(`HTTP ${error.status} on ${method} ${path}: ${error.body.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function printHelp(): void {
  process.stdout.write(
    [
      "whop CLI — monetize Arc's output via whop.com",
      "",
      "  whoami                                 verify the API key and show the company",
      "  list-experiences                       list experiences (find chat/course ids)",
      "  list-channels [--company biz_xxx]      list chat feeds (find the chat_feed_xxx channel id)",
      "  list-messages --channel chat_feed_xxx [--limit N] [--cursor <opaque>]",
      "                                         read recent messages (newest-first; use page_info cursors)",
      "  post-chat --content <md> [--channel exp_xxx]",
      "                                         post a hot-topic into a chat experience",
      "  reply-chat --to <message_id> --content <md> [--channel exp_xxx]",
      "                                         post a threaded reply to a specific message",
      "  list-forums [--company biz_xxx]        list forum feeds (find the forum_feed_xxx id)",
      "  list-forum-posts --experience exp_xxx [--limit N]",
      "                                         read recent forum posts in an experience",
      "  post-forum --experience exp_xxx --content <md> [--title <t>] [--parent post_xxx]",
      "                                         publish a forum post (e.g. digest into Public forum)",
      "  edit-forum-post --id post_xxx --content <md> [--title <t>]",
      "                                         edit a forum post (no DELETE endpoint exists; PATCH to blank)",
      "  rename-experience --id exp_xxx --title <new title>",
      "  create-course --experience exp_xxx --title <t>",
      "  create-chapter --course cou_xxx --title <t> [--order N]",
      "  create-lesson --chapter cha_xxx --title <t> [--type text|video|quiz|assignment]",
      "                [--content <md>] [--video-url <url>] [--order N]",
      "",
      "Audit:",
      "  tick-replies                           run pollWhopReplies() once, bypassing the 5min self-gate",
      "  tick-synthesis                         run pollWhopSynthesis() once, bypassing the 6h self-gate",
      "  tick-free-forum                        run pollWhopFreeForumDigest() once, bypassing the 24h self-gate",
      "",
    ].join("\n"),
  );
}

async function cmdWhoami(apiKey: string): Promise<void> {
  // Company API keys authenticate against /v5/company, not /v5/me (the latter
  // requires a user token and returns 403 for a company key).
  const company = await whopRequest("GET", "/v5/company", apiKey);
  process.stdout.write(JSON.stringify(company, null, 2) + "\n");
}

async function cmdListExperiences(apiKey: string): Promise<void> {
  // Experience listing only exists on v2; /v5/experiences 404s.
  const experiences = await whopRequest("GET", "/v2/experiences", apiKey);
  process.stdout.write(JSON.stringify(experiences, null, 2) + "\n");
}

async function cmdListChannels(apiKey: string, flags: Record<string, string>): Promise<void> {
  // Chat feeds live on v1; each carries the canonical channel_id (chat_feed_xxx)
  // and the experience it backs. company_id defaults to the stored credential.
  const companyId = flags.company ?? (await getCredential("whop", "company_id"));
  if (!companyId) fail("list-channels requires --company biz_xxx (or set creds key company_id)");
  const channels = await whopRequest(
    "GET",
    `/v1/chat_channels?company_id=${encodeURIComponent(companyId)}`,
    apiKey,
  );
  process.stdout.write(JSON.stringify(channels, null, 2) + "\n");
}

async function cmdListMessages(apiKey: string, flags: Record<string, string>): Promise<void> {
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) fail("list-messages requires --channel (or set creds key chat_channel_id)");
  const limit = flags.limit ? Number(flags.limit) : 20;
  let path = `/v1/messages?channel_id=${encodeURIComponent(channel)}&limit=${limit}`;
  // Pagination uses opaque cursor strings from page_info.end_cursor / start_cursor.
  // Raw post IDs as before/after params return 400.
  if (flags.cursor) path += `&cursor=${encodeURIComponent(flags.cursor)}`;
  const result = await whopRequest("GET", path, apiKey);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdPostChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  const content = flags.content;
  if (!content) fail("post-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) {
    fail("post-chat requires --channel (or set creds key chat_channel_id)");
  }
  // Messages live on v1, not v5 (/api/v5/messages 404s). channel_id accepts an
  // exp_xxx experience id or a chat_feed_xxx feed id — list feeds via
  // GET /api/v1/chat_channels?company_id=biz_xxx.
  const result = await whopRequest("POST", "/v1/messages", apiKey, {
    channel_id: channel,
    content,
  });
  process.stdout.write(`posted to ${channel}\n` + JSON.stringify(result, null, 2) + "\n");
}

async function cmdReplyChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.to) fail("reply-chat requires --to <message_id>");
  const content = flags.content;
  if (!content) fail("reply-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) fail("reply-chat requires --channel (or set creds key chat_channel_id)");
  const result = await whopRequest("POST", "/v1/messages", apiKey, {
    channel_id: channel,
    content,
    replying_to_message_id: flags.to,
  });
  process.stdout.write(`reply posted to ${channel} (thread: ${flags.to})\n` + JSON.stringify(result, null, 2) + "\n");
}

async function cmdListForums(apiKey: string, flags: Record<string, string>): Promise<void> {
  const companyId = flags.company ?? (await getCredential("whop", "company_id"));
  if (!companyId) fail("list-forums requires --company biz_xxx (or set creds key company_id)");
  const forums = await whopRequest(
    "GET",
    `/v1/forums?company_id=${encodeURIComponent(companyId)}`,
    apiKey,
  );
  process.stdout.write(JSON.stringify(forums, null, 2) + "\n");
}

async function cmdListForumPosts(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience) fail("list-forum-posts requires --experience exp_xxx");
  const limit = flags.limit ? Number(flags.limit) : 20;
  // Forum posts live on /v1/forum_posts keyed by experience_id (NOT forum_feed_id).
  // Empirically verified: forum_feed_id and channel_id are both rejected; experience_id works.
  const result = await whopRequest(
    "GET",
    `/v1/forum_posts?experience_id=${encodeURIComponent(flags.experience)}&limit=${limit}`,
    apiKey,
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdPostForum(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience) fail("post-forum requires --experience exp_xxx");
  if (!flags.content) fail("post-forum requires --content <markdown>");
  // POST /v1/forum_posts with {experience_id, content, title?}. Title is optional;
  // app key with forum:post:create scope succeeds even when forum's who_can_post=admins.
  const body: Record<string, unknown> = {
    experience_id: flags.experience,
    content: flags.content,
  };
  if (flags.title) body.title = flags.title;
  if (flags.parent) body.parent_id = flags.parent;
  const result = await whopRequest("POST", "/v1/forum_posts", apiKey, body);
  process.stdout.write(
    `posted to forum (experience: ${flags.experience})\n` + JSON.stringify(result, null, 2) + "\n",
  );
}

async function cmdEditForumPost(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.id) fail("edit-forum-post requires --id post_xxx");
  if (!flags.content) fail("edit-forum-post requires --content <markdown>");
  // PATCH /v1/forum_posts/<id> — the soft-delete path (Whop v1 has no DELETE for forum posts).
  // Patch sets is_edited: true; the original post slot stays in the timeline.
  const body: Record<string, unknown> = { content: flags.content };
  if (flags.title) body.title = flags.title;
  const result = await whopRequest(
    "PATCH",
    `/v1/forum_posts/${encodeURIComponent(flags.id)}`,
    apiKey,
    body,
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdRenameExperience(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.title) fail("rename-experience requires --id exp_xxx and --title <new title>");
  const result = await whopRequest("PATCH", `/v2/experiences/${encodeURIComponent(flags.id)}`, apiKey, {
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateCourse(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience || !flags.title) fail("create-course requires --experience and --title");
  const result = await whopRequest("POST", "/v5/courses", apiKey, {
    experience_id: flags.experience,
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateChapter(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.course || !flags.title) fail("create-chapter requires --course and --title");
  const result = await whopRequest("POST", "/v5/course-chapters", apiKey, {
    course_id: flags.course,
    title: flags.title,
    order: flags.order ? Number(flags.order) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateLesson(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.chapter || !flags.title) fail("create-lesson requires --chapter and --title");
  const result = await whopRequest("POST", "/v5/course-lessons", apiKey, {
    chapter_id: flags.chapter,
    title: flags.title,
    type: flags.type ?? "text",
    content: flags.content,
    video_url: flags["video-url"],
    order: flags.order ? Number(flags.order) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1)).flags;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "whoami": {
      const apiKey = await requireApiKey();
      await cmdWhoami(apiKey);
      break;
    }
    case "list-experiences": {
      const apiKey = await requireApiKey();
      await cmdListExperiences(apiKey);
      break;
    }
    case "list-channels": {
      const apiKey = await requireApiKey();
      await cmdListChannels(apiKey, flags);
      break;
    }
    case "list-messages": {
      const apiKey = await requireAppApiKey();
      await cmdListMessages(apiKey, flags);
      break;
    }
    case "post-chat": {
      // App key carries chat:message:create; company key never had that scope.
      const apiKey = await requireAppApiKey();
      await cmdPostChat(apiKey, flags);
      break;
    }
    case "reply-chat": {
      const apiKey = await requireAppApiKey();
      await cmdReplyChat(apiKey, flags);
      break;
    }
    case "list-forums": {
      const apiKey = await requireApiKey();
      await cmdListForums(apiKey, flags);
      break;
    }
    case "list-forum-posts": {
      const apiKey = await requireApiKey();
      await cmdListForumPosts(apiKey, flags);
      break;
    }
    case "post-forum": {
      // App key carries forum:post:create; required even when forum allows everyone.
      const apiKey = await requireAppApiKey();
      await cmdPostForum(apiKey, flags);
      break;
    }
    case "edit-forum-post": {
      const apiKey = await requireAppApiKey();
      await cmdEditForumPost(apiKey, flags);
      break;
    }
    case "rename-experience": {
      const apiKey = await requireApiKey();
      await cmdRenameExperience(apiKey, flags);
      break;
    }
    case "create-course": {
      const apiKey = await requireApiKey();
      await cmdCreateCourse(apiKey, flags);
      break;
    }
    case "create-chapter": {
      const apiKey = await requireApiKey();
      await cmdCreateChapter(apiKey, flags);
      break;
    }
    case "create-lesson": {
      const apiKey = await requireApiKey();
      await cmdCreateLesson(apiKey, flags);
      break;
    }
    case "tick-replies": {
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { pollWhopReplies } = await import("./sensor.ts");
      await pollWhopReplies();
      break;
    }
    case "tick-synthesis": {
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { pollWhopSynthesis } = await import("./sensor.ts");
      await pollWhopSynthesis();
      break;
    }
    case "tick-free-forum": {
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { pollWhopFreeForumDigest } = await import("./sensor.ts");
      await pollWhopFreeForumDigest();
      break;
    }
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
