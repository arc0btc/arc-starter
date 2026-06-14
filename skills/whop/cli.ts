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
import { whopClient } from "./lib/whop-api.ts";

// Every Whop call routes through @whop/sdk (version-pinned in package.json) via
// whopClient(); there is no hand-rolled REST left. Keys are still resolved from
// the encrypted store per command (requireApiKey / requireAppApiKey below).

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

// SDK list calls return a CursorPage; callers expect the legacy
// { data, page_info } JSON shape. One place keeps every read command consistent.
function printPage(page: { data: unknown; page_info: unknown }): void {
  process.stdout.write(
    JSON.stringify({ data: page.data, page_info: page.page_info }, null, 2) + "\n",
  );
}

// --- Source-dedup for the non-idempotent POST /messages write path. ---
// post-chat/reply-chat hit `messages.create`, which is non-idempotent. An
// optional --source key gives replay protection via a LOCAL ledger
// (whop_post_log): a recorded source short-circuits BEFORE any API call, so a
// sequential re-run (a dispatch retry or next-cycle re-fire — the actual
// operational profile, since each agent dispatches one task at a time) never
// double-posts. Proven live 2026-06-14 (fire twice → one message).
//
// We ALSO pass source as the SDK `idempotencyKey` — the correct header to send
// for a non-idempotent write — but Whop does NOT currently honor it on
// POST /messages: verified live (clear the ledger, re-fire the same key → a
// DUPLICATE posted). So the local ledger is the SOLE guarantee today; the key is
// harmless forward-compat that auto-upgrades if Whop adds server-side support.
//
// Known, accepted limitations (the server ignores the key, so these stay open):
// concurrent same-source posts could both pass the check-then-act ledger, and a
// post-succeeds-then-recordPost-throws window leaves the source unrecorded. Both
// are practically unreachable under single-threaded per-agent dispatch + local
// WAL sqlite; revisit if post-chat ever runs concurrently for one source.
//
// No --source = legacy raw post (callers that dedup at the dispatch-task layer
// are unaffected). Table is lazily created in the shared db/arc.sqlite.
async function whopPostLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS whop_post_log (
       source TEXT PRIMARY KEY,
       channel_id TEXT NOT NULL,
       message_id TEXT,
       posted_at TEXT NOT NULL
     )`,
  );
  return db;
}

// True if this source already posted (prints a skip line so the caller returns
// early without touching the API). A no-op when no --source is given.
async function dedupSkip(source: string | undefined): Promise<boolean> {
  if (!source) return false;
  const db = await whopPostLog();
  const prior = db.query("SELECT message_id FROM whop_post_log WHERE source = ?").get(source) as
    | { message_id: string | null }
    | null;
  if (!prior) return false;
  process.stdout.write(`already posted: ${source} (message ${prior.message_id ?? "?"}) — skipping\n`);
  return true;
}

async function recordPost(source: string, channelId: string, messageId: string | null): Promise<void> {
  const db = await whopPostLog();
  db.query(
    "INSERT OR IGNORE INTO whop_post_log (source, channel_id, message_id, posted_at) VALUES (?, ?, ?, ?)",
  ).run(source, channelId, messageId, new Date().toISOString());
}

// The created message/forum-post id for the ledger. SDK create() return types
// don't surface `.id` uniformly, so this localizes the one narrow cast.
const createdId = (x: unknown): string | null => (x as { id?: string }).id ?? null;

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
      "  post-chat --content <md> [--channel exp_xxx] [--source <key>]",
      "                                         post a hot-topic into a chat experience",
      "                                         (--source: a re-run with the same key is suppressed by the",
      "                                          local ledger — sequential-safe; idempotent retries never double-post)",
      "  reply-chat --to <message_id> --content <md> [--channel exp_xxx] [--source <key>]",
      "                                         post a threaded reply to a specific message",
      "  list-forums [--company biz_xxx]        list forum feeds (find the forum_feed_xxx id)",
      "  list-forum-posts --experience exp_xxx [--limit N]",
      "                                         read recent forum posts in an experience",
      "  post-forum --experience exp_xxx --content <md> [--title <t>] [--parent post_xxx] [--source <key>]",
      "                                         publish a forum post (e.g. digest into Public forum)",
      "                                         (--source: idempotent re-run, like post-chat)",
      "  edit-forum-post --id post_xxx --content <md> [--title <t>]",
      "                                         edit a forum post (no DELETE endpoint exists; PATCH to blank)",
      "  rename-experience --id exp_xxx --title <new title>",
      "  create-course --experience exp_xxx --title <t>",
      "  create-chapter --course cou_xxx --title <t>",
      "  create-lesson --chapter cha_xxx --title <t> [--type text|video|pdf|multi|quiz|knowledge_check]",
      "                [--content <md>] [--video-url <embed_id>] [--embed-type youtube|loom]",
      "  list-courses [--course cou_xxx]         list courses; with --course, that course's ordered chapters",
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
  // SDK companies.retrieve takes the company id explicitly (the legacy
  // /v5/company inferred it from the key). company_id lives in the cred store.
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("whoami requires creds key company_id (biz_xxx)");
  const company = await whopClient(apiKey).companies.retrieve(companyId);
  process.stdout.write(JSON.stringify(company, null, 2) + "\n");
}

async function cmdListExperiences(apiKey: string): Promise<void> {
  // SDK experiences.list requires company_id (the legacy v2 listing inferred it
  // from the key). The v1/v2/v5 routing is gone — the SDK abstracts it.
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("list-experiences requires creds key company_id (biz_xxx)");
  const page = await whopClient(apiKey).experiences.list({ company_id: companyId, first: 50 });
  printPage(page);
}

async function cmdListCourses(apiKey: string, flags: Record<string, string>): Promise<void> {
  // Verify the course write path (P4/P10): courses.list needs company_id (like
  // list-experiences); --course switches to courseChapters.list for that course,
  // returned ordered by position with each chapter's lessons inlined — enough to
  // confirm "draft course with >=3 ordered chapters" from the CLI.
  const client = whopClient(apiKey);
  if (flags.course) {
    const page = await client.courseChapters.list({ course_id: flags.course, first: 50 });
    printPage(page);
    return;
  }
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("list-courses requires creds key company_id (biz_xxx), or pass --course cou_xxx");
  const page = await client.courses.list({ company_id: companyId, first: 50 });
  printPage(page);
}

async function cmdListChannels(apiKey: string, flags: Record<string, string>): Promise<void> {
  // Chat feeds carry the canonical channel_id (chat_feed_xxx) and the experience
  // they back. company_id defaults to the stored credential.
  const companyId = flags.company ?? (await getCredential("whop", "company_id"));
  if (!companyId) fail("list-channels requires --company biz_xxx (or set creds key company_id)");
  const page = await whopClient(apiKey).chatChannels.list({ company_id: companyId, first: 50 });
  printPage(page);
}

async function cmdListMessages(apiKey: string, flags: Record<string, string>): Promise<void> {
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) fail("list-messages requires --channel (or set creds key chat_channel_id)");
  const limit = flags.limit ? Number(flags.limit) : 20;
  // SDK pagination: first:N preserves the legacy newest-first order; the opaque
  // --cursor maps to the SDK `after` param (forward page past page_info.end_cursor).
  // Two typed call sites keep inference instead of casting the query object.
  const messages = whopClient(apiKey).messages;
  const page = flags.cursor
    ? await messages.list({ channel_id: channel, first: limit, after: flags.cursor })
    : await messages.list({ channel_id: channel, first: limit });
  printPage(page);
}

async function cmdPostChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  const content = flags.content;
  if (!content) fail("post-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) {
    fail("post-chat requires --channel (or set creds key chat_channel_id)");
  }
  // Local ledger short-circuit BEFORE any API call — the operative exactly-once
  // guarantee for sequential re-runs. channel_id accepts an exp_xxx experience id
  // or a chat_feed_xxx feed id. source is also sent as the SDK idempotencyKey
  // (correct header, but currently ignored by Whop — see whopPostLog note).
  if (await dedupSkip(flags.source)) return;
  const message = await whopClient(apiKey).messages.create(
    { channel_id: channel, content },
    flags.source ? { idempotencyKey: flags.source } : undefined,
  );
  if (flags.source) await recordPost(flags.source, channel, createdId(message));
  process.stdout.write(`posted to ${channel}\n` + JSON.stringify(message, null, 2) + "\n");
}

async function cmdReplyChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.to) fail("reply-chat requires --to <message_id>");
  const content = flags.content;
  if (!content) fail("reply-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) fail("reply-chat requires --channel (or set creds key chat_channel_id)");
  if (await dedupSkip(flags.source)) return;
  const message = await whopClient(apiKey).messages.create(
    { channel_id: channel, content, replying_to_message_id: flags.to },
    flags.source ? { idempotencyKey: flags.source } : undefined,
  );
  if (flags.source) await recordPost(flags.source, channel, createdId(message));
  process.stdout.write(`reply posted to ${channel} (thread: ${flags.to})\n` + JSON.stringify(message, null, 2) + "\n");
}

async function cmdListForums(apiKey: string, flags: Record<string, string>): Promise<void> {
  const companyId = flags.company ?? (await getCredential("whop", "company_id"));
  if (!companyId) fail("list-forums requires --company biz_xxx (or set creds key company_id)");
  const page = await whopClient(apiKey).forums.list({ company_id: companyId, first: 50 });
  printPage(page);
}

async function cmdListForumPosts(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience) fail("list-forum-posts requires --experience exp_xxx");
  const limit = flags.limit ? Number(flags.limit) : 20;
  // Forum posts are keyed by experience_id (NOT forum_feed_id) — the SDK enforces
  // this; the empirical v1 quirk is now the documented param.
  const page = await whopClient(apiKey).forumPosts.list({
    experience_id: flags.experience,
    first: limit,
  });
  printPage(page);
}

async function cmdPostForum(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience) fail("post-forum requires --experience exp_xxx");
  if (!flags.content) fail("post-forum requires --content <markdown>");
  // Forum posts key on experience_id (NOT forum_feed_id). Title is optional; the
  // app key with forum:post:create scope succeeds even when who_can_post=admins.
  // post-forum is the recurring fan-out hop (P9) and non-idempotent, so it takes
  // the same --source dedup as post-chat (local-ledger short-circuit before any
  // API call; see whopPostLog note for the guarantee's exact scope).
  if (await dedupSkip(flags.source)) return;
  const post = await whopClient(apiKey).forumPosts.create({
    experience_id: flags.experience,
    content: flags.content,
    ...(flags.title ? { title: flags.title } : {}),
    ...(flags.parent ? { parent_id: flags.parent } : {}),
  });
  if (flags.source) await recordPost(flags.source, flags.experience, createdId(post));
  process.stdout.write(
    `posted to forum (experience: ${flags.experience})\n` + JSON.stringify(post, null, 2) + "\n",
  );
}

async function cmdEditForumPost(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.id) fail("edit-forum-post requires --id post_xxx");
  if (!flags.content) fail("edit-forum-post requires --content <markdown>");
  // forumPosts.update — the soft-delete path: forum posts have NO delete method on
  // the SDK (confirmed P1), so blanking content via PATCH stays the withdrawal path.
  const post = await whopClient(apiKey).forumPosts.update(flags.id, {
    content: flags.content,
    ...(flags.title ? { title: flags.title } : {}),
  });
  process.stdout.write(JSON.stringify(post, null, 2) + "\n");
}

async function cmdRenameExperience(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.title) fail("rename-experience requires --id exp_xxx and --title <new title>");
  // SDK field is `name`, not `title` (the legacy v2 PATCH used `title`). CLI flag stays --title.
  const experience = await whopClient(apiKey).experiences.update(flags.id, { name: flags.title });
  process.stdout.write(JSON.stringify(experience, null, 2) + "\n");
}

async function cmdCreateCourse(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience || !flags.title) fail("create-course requires --experience and --title");
  const course = await whopClient(apiKey).courses.create({
    experience_id: flags.experience,
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(course, null, 2) + "\n");
}

async function cmdCreateChapter(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.course || !flags.title) fail("create-chapter requires --course and --title");
  // SDK courseChapters.create takes only {course_id, title}; `order` is not a create
  // param (ordering is managed elsewhere). Warn rather than silently drop --order.
  if (flags.order) process.stderr.write("whop: note: --order is ignored by create-chapter (not an SDK create param)\n");
  const chapter = await whopClient(apiKey).courseChapters.create({
    course_id: flags.course,
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(chapter, null, 2) + "\n");
}

const LESSON_TYPES = ["text", "video", "pdf", "multi", "quiz", "knowledge_check"] as const;
const EMBED_TYPES = ["youtube", "loom"] as const;

async function cmdCreateLesson(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.chapter || !flags.title) fail("create-lesson requires --chapter and --title");
  // --order is no longer an SDK create param (same as create-chapter) — warn, don't drop silently.
  if (flags.order) process.stderr.write("whop: note: --order is ignored by create-lesson (not an SDK create param)\n");
  // Param diffs vs legacy: --type -> lesson_type (enum; the old 'assignment' value is gone);
  // --video-url -> embed_id (a provider video ID, NOT a full URL) + --embed-type. Validate the
  // user-supplied enums up front so a bad value fails with a clear CLI message, not an opaque 4xx.
  const lessonType = flags.type ?? "text";
  if (!(LESSON_TYPES as readonly string[]).includes(lessonType)) {
    fail(`--type must be one of: ${LESSON_TYPES.join(", ")}`);
  }
  const embedType = flags["embed-type"] ?? "youtube";
  if (flags["video-url"]) {
    if (flags["video-url"].includes("://")) {
      process.stderr.write("whop: note: --video-url is an embed id (a provider video id), not a full URL\n");
    }
    if (!(EMBED_TYPES as readonly string[]).includes(embedType)) {
      fail(`--embed-type must be one of: ${EMBED_TYPES.join(", ")}`);
    }
  }
  const lesson = await whopClient(apiKey).courseLessons.create({
    chapter_id: flags.chapter,
    title: flags.title,
    lesson_type: lessonType as (typeof LESSON_TYPES)[number],
    ...(flags.content ? { content: flags.content } : {}),
    ...(flags["video-url"]
      ? { embed_id: flags["video-url"], embed_type: embedType as (typeof EMBED_TYPES)[number] }
      : {}),
  });
  process.stdout.write(JSON.stringify(lesson, null, 2) + "\n");
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
    case "list-courses": {
      const apiKey = await requireApiKey();
      await cmdListCourses(apiKey, flags);
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
