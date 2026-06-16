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
import { PAID_ROOM_AFFILIATE } from "../../src/constants.ts";

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
      "  create-product --title <t> --route <slug> [--price 9] [--description <d>] [--headline <h>]",
      "                                         mint a HIDDEN one-time product SKU (create-or-find by route;",
      "                                         30% global+member affiliate) → prints prod_/plan_ ids + PRODUCT_* constants",
      "  create-chapter --course cou_xxx --title <t>",
      "  create-lesson --chapter cha_xxx --title <t> [--type text|video|pdf|multi|quiz|knowledge_check]",
      "                [--content <md>] [--video-url <embed_id>] [--embed-type youtube|loom]",
      "  list-courses [--course cou_xxx]         list courses; with --course, that course's ordered chapters",
      "",
      "Affiliate / referral (Whop native program — % of revenue for referrers; reversible config, no sats):",
      "  get-affiliate-config --product prod_xxx  read a product's global/member affiliate percentage + status",
      "  set-affiliate-percentage --product prod_xxx --percent N [--member] [--disable]",
      "                                         enable (default) the affiliate program at N% (0-100). --member",
      "                                         targets the member-referral program; --disable turns it off (idempotent)",
      "  list-affiliates [--query <username>]    list the company's affiliates (optionally search by username)",
      "  create-affiliate --user <username|email|user_id> [--product prod_xxx]",
      "                                         create-or-find an affiliate (idempotent) and print attributable",
      "                                         ?a=<username> referral links (company + product page)",
      "  list-affiliate-overrides --affiliate aff_xxx",
      "                                         list an affiliate's per-plan overrides (carry checkout/product direct links)",
      "  create-affiliate-override --affiliate aff_xxx --plan plan_xxx --percent N",
      "                                         create-or-find a standard per-plan override (idempotent); prints the",
      "                                         SDK-canonical attributable checkout_direct_link / product_direct_link",
      "",
      "Audit:",
      "  tick-replies                           run pollWhopReplies() once, bypassing the 5min self-gate",
      "  tick-synthesis                         run pollWhopSynthesis() once, bypassing the 6h self-gate",
      "  tick-free-forum                        run pollWhopFreeForumDigest() once, bypassing the 24h self-gate",
      "  tick-events                            run pollWhopEvents() once (intake memberships/payments -> ledger)",
      "  revenue                                members / MRR / break-even + weekly net-new + MRR-ladder + leading indicators (captured Whop events)",
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
  // which returns {id, order, title} per chapter in display order (the `order`
  // field, verified live P10) — enough to confirm ">=3 ordered chapters" from the CLI.
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

// --- Product SKU creation (P10A — productize a research report as a one-time SKU) ---
// create-product mints ONE Whop product per report, each with a ONE-TIME plan (no
// subscription; the $49/mo membership stays the only recurring plan). Created HIDDEN
// (accessible by direct link, off the public store) so the report can be attached and
// a $0 test-purchase run before the operator flips it visible at go-live. The 30% global
// + member affiliate mirrors the membership product so a `?a=arc0btc` sale is attributable.

interface PlanSummary {
  id: string;
  plan_type: string;
  initial_price: number;
  visibility: string;
}

/** Find the product's plan (NEVER on the Product response — must be listed separately). */
async function findOneTimePlan(
  client: ReturnType<typeof whopClient>,
  companyId: string,
  productId: string,
): Promise<PlanSummary | null> {
  type PlanRow = PlanSummary & { product?: { id?: string | null } | null; product_id?: string | null };
  const pick = (rows: PlanRow[]): PlanRow | null =>
    rows.find((p) => p.plan_type === "one_time") ?? rows[0] ?? null;
  const norm = (p: PlanRow | null): PlanSummary | null =>
    p ? { id: p.id, plan_type: p.plan_type, initial_price: p.initial_price, visibility: p.visibility } : null;

  // The server-side product_ids filter has been observed to return empty even when a
  // plan exists, so try it first but fall back to a full scan matched on product id.
  const filtered = await client.plans.list({ company_id: companyId, product_ids: [productId], first: 25 });
  const fromFilter = pick(filtered.data as PlanRow[]);
  if (fromFilter) return norm(fromFilter);
  // CEILING (council/forge): the fallback scans only the first 100 plans (no cursor follow).
  // Since the filter is the unreliable path, this scan is the real idempotency net — past ~100
  // plans company-wide a freshly-created plan could fall off it and read as null, and a re-run
  // would then stack a duplicate plan. ~100 plans = ~100 one-time products away; paginate before then.
  const all = await client.plans.list({ company_id: companyId, first: 100 });
  const owned = (all.data as PlanRow[]).filter((p) => (p.product?.id ?? p.product_id) === productId);
  return norm(pick(owned));
}

async function cmdCreateProduct(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.title) fail("create-product requires --title <product title>");
  if (!flags.route) fail("create-product requires --route <url-slug> (the whop.com/<route> path)");
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("create-product requires creds key company_id (biz_xxx)");
  const price = flags.price ? Number(flags.price) : 9; // $9 opening (P10.0b), reversible
  if (!Number.isFinite(price) || price <= 0) fail("--price must be a positive number (USD); default 9");
  const client = whopClient(apiKey);

  // Create-OR-FIND by route (P8 idempotency): products.create is non-idempotent and a
  // route collision errors, so a re-run for an existing route returns the existing SKU
  // rather than stacking a duplicate. Route is the stable natural key for the catalog.
  // CEILING (council/forge): scans only the first 50 products (no cursor follow). Past 50 the
  // route-find can miss and fall through to products.create — which the server then rejects on
  // the duplicate route (a hard error, NOT a duplicate SKU), so it degrades safely; paginate before then.
  const existingPage = await client.products.list({ company_id: companyId, first: 50 });
  const existing = (
    existingPage.data as Array<{ id: string; route: string; title: string; visibility: string }>
  ).find((p) => p.route === flags.route);

  let productId: string;
  let route: string;
  let created: boolean;
  if (existing) {
    productId = existing.id;
    route = existing.route;
    created = false;
    process.stderr.write(
      `whop: product already exists for route "${flags.route}" (${existing.id}) — returning existing (idempotent)\n`,
    );
  } else {
    let product;
    try {
      product = await client.products.create({
        company_id: companyId,
        title: flags.title,
        ...(flags.description ? { description: flags.description } : {}),
        ...(flags.headline ? { headline: flags.headline } : {}),
        route: flags.route,
        visibility: "hidden",
        // NOTE: plan_options is NOT honored by the API for one-time plans (verified live —
        // the product is created but no plan attaches). The purchasable plan is therefore
        // created explicitly below via plans.create. Affiliate config DOES apply here.
        global_affiliate_status: "enabled",
        global_affiliate_percentage: 30,
        member_affiliate_status: "enabled",
        member_affiliate_percentage: 30,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/403|access_pass:create|permission|forbidden/i.test(msg)) {
        fail(
          `products.create rejected (likely missing access_pass:create scope): ${msg}\n` +
            `Fallback: create it in the Whop dashboard — HIDDEN, one-time plan, $${price}, 30% global+member ` +
            `affiliate, route "${flags.route}" — then wire its prod_/plan_ ids into src/constants.ts PRODUCT_* by hand.`,
        );
      }
      throw error;
    }
    productId = product.id;
    route = product.route;
    created = true;
  }

  // Create-OR-FIND the one-time plan (the product has none until we make it — plan_options
  // is ignored by the API). Idempotent: only create when the product carries no plan yet,
  // so a re-run never stacks duplicate plans on the same SKU.
  let plan = await findOneTimePlan(client, companyId, productId);
  if (!plan) {
    const createdPlan = (await client.plans.create({
      company_id: companyId,
      product_id: productId,
      title: "Full report — one-time",
      currency: "usd",
      plan_type: "one_time",
      initial_price: price,
      release_method: "buy_now",
      unlimited_stock: true,
      visibility: "hidden",
    })) as { id: string; plan_type?: string; initial_price?: number; visibility?: string };
    plan = {
      id: createdPlan.id,
      plan_type: createdPlan.plan_type ?? "one_time",
      initial_price: createdPlan.initial_price ?? price,
      visibility: createdPlan.visibility ?? "hidden",
    };
    process.stderr.write(`whop: created one-time plan ${plan.id} for ${productId} ($${price})\n`);
  }
  // `plan` is provably non-null here (found or just created), so no optional chaining / fallbacks.
  const planId = plan.id;
  const productPageUrl = `https://whop.com/${route}/?a=${PAID_ROOM_AFFILIATE}`;
  const checkoutUrl = `https://whop.com/checkout/${planId}?a=${PAID_ROOM_AFFILIATE}`;

  process.stdout.write(
    JSON.stringify(
      {
        created,
        product_id: productId,
        plan_id: planId,
        route,
        visibility: "hidden",
        price_usd: plan.initial_price,
        plan_type: plan.plan_type,
        affiliate: PAID_ROOM_AFFILIATE,
        // Paste-ready values for the src/constants.ts PRODUCT_* block (mirror PAID_ROOM_*).
        constants: {
          PRODUCT_ID: productId,
          PRODUCT_PLAN_ID: planId,
          PRODUCT_PAGE_URL: productPageUrl,
          PRODUCT_CHECKOUT_URL: checkoutUrl,
        },
        note: "wire `constants` into src/constants.ts PRODUCT_*; product is HIDDEN until the operator flips it visible at go-live",
      },
      null,
      2,
    ) + "\n",
  );
}

// --- Affiliate / referral program (Whop native: % of revenue for referrers) ---
// All of these are reversible company/product CONFIG writes — no sats. The paid
// product carries the global program (`global_affiliate_percentage` +
// `global_affiliate_status`, which the SDK enum spells 'enabled'/'disabled').
// Per-affiliate per-plan standard overrides carry the SDK-canonical attributable
// links (`checkout_direct_link`/`product_direct_link`); the global program also
// makes a `?a=<username>` referral link work for any affiliate.

// Flatten the affiliate-relevant fields of a product into a stable summary. Typed
// structurally so the SDK Product (whose status is the 'enabled'|'disabled' enum)
// passes without a cast.
function affiliateConfig(p: {
  id: string;
  route: string;
  title: string;
  global_affiliate_percentage: number | null;
  global_affiliate_status: string;
  member_affiliate_percentage: number | null;
  member_affiliate_status: string;
}) {
  return {
    product_id: p.id,
    route: p.route,
    title: p.title,
    global_affiliate_percentage: p.global_affiliate_percentage,
    global_affiliate_status: p.global_affiliate_status,
    member_affiliate_percentage: p.member_affiliate_percentage,
    member_affiliate_status: p.member_affiliate_status,
  };
}

async function cmdGetAffiliateConfig(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.product) fail("get-affiliate-config requires --product prod_xxx");
  const product = await whopClient(apiKey).products.retrieve(flags.product);
  process.stdout.write(JSON.stringify(affiliateConfig(product), null, 2) + "\n");
}

async function cmdSetAffiliatePercentage(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.product) fail("set-affiliate-percentage requires --product prod_xxx");
  const disable = flags.disable === "true";
  const status: "enabled" | "disabled" = disable ? "disabled" : "enabled";
  let percent: number | undefined;
  if (!disable) {
    if (!flags.percent) fail("set-affiliate-percentage requires --percent N (0-100), or pass --disable");
    percent = Number(flags.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail("--percent must be a number 0-100");
  }
  // --member targets the member-referral program (members refer members); default
  // is the global marketplace program. products.update is idempotent — re-applying
  // the same %/status is a no-op write, so no --source ledger is needed.
  const member = flags.member === "true";
  const body = member
    ? { member_affiliate_status: status, ...(percent !== undefined ? { member_affiliate_percentage: percent } : {}) }
    : { global_affiliate_status: status, ...(percent !== undefined ? { global_affiliate_percentage: percent } : {}) };
  const product = await whopClient(apiKey).products.update(flags.product, body);
  process.stdout.write(JSON.stringify(affiliateConfig(product), null, 2) + "\n");
}

async function cmdListAffiliates(apiKey: string, flags: Record<string, string>): Promise<void> {
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("list-affiliates requires creds key company_id (biz_xxx)");
  const page = await whopClient(apiKey).affiliates.list({
    company_id: companyId,
    first: 50,
    ...(flags.query ? { query: flags.query } : {}),
  });
  printPage(page);
}

async function cmdCreateAffiliate(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.user) fail("create-affiliate requires --user <username|email|user_id>");
  const companyId = await getCredential("whop", "company_id");
  if (!companyId) fail("create-affiliate requires creds key company_id (biz_xxx)");
  const client = whopClient(apiKey);
  // affiliates.create is create-OR-FIND per the SDK: re-running for the same user
  // returns the existing affiliate, so it is idempotent with no --source ledger.
  const affiliate = await client.affiliates.create({ company_id: companyId, user_identifier: flags.user });
  const username = affiliate.user.username;
  // Attributable referral links use Whop's `?a=<username>` param: the company-page
  // form always works; the product-page form needs the product route (--product).
  const links: Record<string, string> = {};
  if (username) {
    const company = await client.companies.retrieve(companyId);
    links.company_referral_link = `https://whop.com/${company.route}/?a=${username}`;
    if (flags.product) {
      const product = await client.products.retrieve(flags.product);
      // Guard cross-company misattribution: a --product from another company would
      // mint a link to THAT product carrying THIS company's affiliate username.
      if (product.company.id !== companyId) {
        fail(`--product ${flags.product} belongs to company ${product.company.id}, not ${companyId}`);
      }
      links.product_referral_link = `https://whop.com/${product.route}/?a=${username}`;
    }
  }
  process.stdout.write(
    JSON.stringify(
      {
        affiliate_id: affiliate.id,
        user: affiliate.user,
        status: affiliate.status,
        total_referrals_count: affiliate.total_referrals_count,
        attributable_links: links,
        note: username
          ? undefined
          : "user has no Whop username set — ?a= links unavailable; use create-affiliate-override for SDK direct links",
      },
      null,
      2,
    ) + "\n",
  );
}

async function cmdListAffiliateOverrides(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.affiliate) fail("list-affiliate-overrides requires --affiliate aff_xxx");
  const page = await whopClient(apiKey).affiliates.overrides.list(flags.affiliate, { first: 50 });
  printPage(page);
}

async function cmdCreateAffiliateOverride(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.affiliate) fail("create-affiliate-override requires --affiliate aff_xxx");
  if (!flags.plan) fail("create-affiliate-override requires --plan plan_xxx");
  if (!flags.percent) fail("create-affiliate-override requires --percent N (1-100)");
  const percent = Number(flags.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) fail("--percent must be a number 1-100");
  const overrides = whopClient(apiKey).affiliates.overrides;
  // overrides.create is a non-idempotent POST, so check-then-act: if a standard
  // override already exists for this plan, return it rather than stacking a
  // duplicate (total_overrides_count would otherwise climb on every re-run). This
  // covers the operative profile — sequential, operator-driven CLI invocation.
  // Accepted limits, same class as post-chat's local ledger: the dedup scan reads
  // only the first page (first:50 standard overrides — one per plan, far above the
  // few plans in play), and two truly-concurrent runs could both pass the check.
  // Both are practically unreachable here; revisit if overrides are minted at scale.
  const existingPage = await overrides.list(flags.affiliate, { first: 50, override_type: "standard" });
  const existing = existingPage.data.find((o) => o.plan_id === flags.plan && o.override_type === "standard");
  if (existing) {
    // Keep stdout a pure-JSON contract on BOTH paths (first-run and re-run) so a
    // machine consumer parses them identically; the human note goes to stderr.
    process.stderr.write("whop: override already exists for this affiliate+plan — returning existing\n");
    process.stdout.write(JSON.stringify(existing, null, 2) + "\n");
    return;
  }
  // The SDK puts the affiliate id in BOTH the path and the body (Stainless quirk).
  const override = await overrides.create(flags.affiliate, {
    id: flags.affiliate,
    override_type: "standard",
    plan_id: flags.plan,
    commission_value: percent,
  });
  process.stdout.write(JSON.stringify(override, null, 2) + "\n");
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
    case "create-product": {
      const apiKey = await requireApiKey();
      await cmdCreateProduct(apiKey, flags);
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
    case "get-affiliate-config": {
      const apiKey = await requireApiKey();
      await cmdGetAffiliateConfig(apiKey, flags);
      break;
    }
    case "set-affiliate-percentage": {
      const apiKey = await requireApiKey();
      await cmdSetAffiliatePercentage(apiKey, flags);
      break;
    }
    case "list-affiliates": {
      const apiKey = await requireApiKey();
      await cmdListAffiliates(apiKey, flags);
      break;
    }
    case "create-affiliate": {
      const apiKey = await requireApiKey();
      await cmdCreateAffiliate(apiKey, flags);
      break;
    }
    case "list-affiliate-overrides": {
      const apiKey = await requireApiKey();
      await cmdListAffiliateOverrides(apiKey, flags);
      break;
    }
    case "create-affiliate-override": {
      const apiKey = await requireApiKey();
      await cmdCreateAffiliateOverride(apiKey, flags);
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
    case "tick-events": {
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { pollWhopEvents } = await import("./sensor.ts");
      await pollWhopEvents();
      break;
    }
    case "tick-free-forum": {
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { pollWhopFreeForumDigest } = await import("./sensor.ts");
      await pollWhopFreeForumDigest();
      break;
    }
    case "revenue": {
      // P22 + P7: revenue + weekly net-new + MRR-ladder + leading indicators, from the
      // captured Whop events (no separate sensor). DB read only.
      const { initDatabase } = await import("../../src/db.ts");
      initDatabase();
      const { formatReadout } = await import("./lib/events.ts");
      console.log(formatReadout());
      break;
    }
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
