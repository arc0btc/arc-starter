#!/usr/bin/env bun

// skills/whop-sales/lib/lead-source.ts
//
// The PRODUCTION non-member lead source for the acquisition lane (P10B).
//
// The paid-room relationship store (db/whop-relationships.json) tracks people
// who ALREADY PAID — zero acquisition prospects. This module tracks the people
// the acquisition target actually lives among: NON-members who engaged Arc on
// the FREE PUBLIC FORUM (exp_YRtS3kgMVeBGzu) — top-level posters and, more
// valuably, anyone who COMMENTED on one of Arc's posts (a reply to Arc = a warm
// Class-A signal). They land in a SEPARATE store (db/whop-leads.json) the lane
// consumes via the sensor's defaultLeadSource().
//
// Reuse rationale: a forum post and a chat message are structurally the same
// engagement record (author + content + a parent it threads to), and Arc's
// forum user id is the same user_cd5Q1fTcrgua1 — so we MAP forum posts onto
// ChatMessage and reuse the whop reactive lane's idempotent updateFromMessages()
// rather than re-deriving the (already battle-tested) classification + dedup.
//
// Two channels feed the one store: the FREE FORUM (channel "forum", increment 1)
// and X (channel "x", this increment) — @arc0btc mentions/replies, with a reply to
// one of Arc's tweets as the warm Class-A signal. Blog commenters were the third
// planned X-adjacent source but arc0.me exposes no comment data, so they're
// deferred (no source to wire), not silently dropped.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  updateFromMessages,
  ARC_USER_ID,
  type ChatMessage,
  type RelationshipStore,
} from "../../whop/lib/relationships.ts";
import { whopClient } from "../../whop/lib/whop-api.ts";
import {
  fetchArcMentions,
  ARC_X_USER_ID,
  type XCreds,
  type XMention,
  type XMentionsResult,
} from "../../social-x-posting/lib/x-api.ts";

export const FREE_FORUM_EXPERIENCE_ID = "exp_YRtS3kgMVeBGzu";

// Separate from the paid-room store: these are PROSPECTS, not members.
const LEAD_STORE_PATH = resolve(import.meta.dir, "../../../db/whop-leads.json");

// Advisors are free-forever collaborators (the operator's test/help accounts).
// They live in the room/forum but are NOT acquisition prospects and must never
// be pitched. Populated when the first advisor signs up (RESUME-P10B signal 1):
// add the user id HERE — the sensor unions this set into NON_PROSPECT_USER_IDS,
// and we also drop advisor posts before they ever enter the lead store (below).
export const ADVISOR_USER_IDS = new Set<string>([
  "user_ua7hpY3BdW19S", // milestesting (Miles) — first advisor, free-forever test account (2026-06-16)
]);

// X identities that must NEVER become leads: Arc's own account + the operator's.
// X handles/ids are a DIFFERENT namespace from the Whop NON_PROSPECT set, so the
// sensor's downstream Whop-id gate can't catch them — drop them HERE at fold time
// (the way advisors are dropped from the forum batch). Arc's own X id is excluded
// by comparison against the live /users/me id; this set covers handles we can name
// up front (matched case-insensitively). Advisors rarely @-mention on X and have
// no known X id, so they're covered only opportunistically (by handle if listed).
export const OPERATOR_X_USERNAMES = new Set<string>([
  "whoabuddydev", // the operator's X account (from @arc0btc's bio)
  "whoabuddy",
]);

// Re-export the (now exported) relationships store type so callers importing it
// from the lead source keep working — one shape, single source of truth.
export type { RelationshipStore };

// Subset of the SDK ForumPostListResponse we depend on.
export interface ForumPost {
  id: string;
  content: string | null;
  created_at: string;
  parent_id: string | null;
  comment_count?: number | null;
  user: { id: string; username?: string | null; name?: string | null };
}

export type ForumFetcher = (experienceId: string) => Promise<ForumPost[]>;

function emptyStore(): RelationshipStore {
  return { updated_at: new Date(0).toISOString(), users: {} };
}

export function loadLeadStore(): RelationshipStore {
  if (!existsSync(LEAD_STORE_PATH)) return emptyStore();
  try {
    return JSON.parse(readFileSync(LEAD_STORE_PATH, "utf8")) as RelationshipStore;
  } catch {
    // A corrupt file is recoverable; next save overwrites it. Don't stall the lane.
    return emptyStore();
  }
}

export function saveLeadStore(store: RelationshipStore): void {
  store.updated_at = new Date().toISOString();
  mkdirSync(dirname(LEAD_STORE_PATH), { recursive: true });
  // Atomic write: serialize to a temp sibling then rename (atomic on the same fs)
  // so an overlapping refresh (12h tick vs the standalone CLI) or a crash mid-write
  // can never leave a torn/corrupt store (dev-council forge #1).
  const tmp = LEAD_STORE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  renameSync(tmp, LEAD_STORE_PATH);
}

/** Map a forum post onto the chat-message shape the relationship updater consumes. */
export function forumPostToMessage(p: ForumPost): ChatMessage {
  return {
    id: p.id,
    content: p.content ?? "",
    created_at: p.created_at,
    replying_to_message_id: p.parent_id ?? null,
    user: {
      id: p.user.id,
      username: p.user.username ?? undefined,
      name: p.user.name ?? undefined,
    },
  };
}

/**
 * Fold a batch of free-forum posts (top-level posts AND comments) into the lead
 * store. ADVISORS are dropped before mapping so they never enter the store. Arc
 * authorship MUST stay in the batch — updateFromMessages needs it to attribute
 * "replied to Arc" (Class A); Arc + operator are filtered downstream by the
 * sensor's NON_PROSPECT gate. Idempotent by post id. Returns user_ids touched.
 */
export function updateLeadsFromForum(
  store: RelationshipStore,
  posts: ForumPost[],
): string[] {
  const batch = posts
    .filter((p) => p.user?.id && !ADVISOR_USER_IDS.has(p.user.id))
    .map(forumPostToMessage);
  return updateFromMessages(store, batch);
}

// ---- X channel (@arc0btc mentions/replies) ----------------------------------

/**
 * Map an X mention onto the chat-message(s) the relationship updater consumes.
 *
 * A reply to ARC also yields a SYNTHETIC Arc-authored anchor (id = the replied-to
 * tweet) placed in the same batch, so updateFromMessages credits the reply as
 * "replied to Arc" (the warm Class-A signal) — exactly how the forum keeps Arc's
 * own posts in the batch for that attribution. The anchor has no parent, so
 * updateFromMessages records it ONLY in its per-tick arcAuthoredMessageIds scratch
 * (it never becomes a user/interaction — see relationships.ts: from-Arc messages
 * without a parent are skipped). A bare mention/quote threads to nothing → it
 * counts as engagement but earns no replied-to-Arc credit (so it classes B/C, and
 * live auto-post is Class-A-only — a one-off @-mention is never auto-pitched).
 */
export function xMentionToMessages(m: XMention, arcXUserId: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const isReplyToArc =
    !!m.in_reply_to_user_id && m.in_reply_to_user_id === arcXUserId && !!m.replied_to_tweet_id;
  if (isReplyToArc) {
    out.push({
      id: m.replied_to_tweet_id!,
      content: "",
      created_at: m.created_at,
      replying_to_message_id: null,
      user: { id: ARC_USER_ID },
    });
  }
  out.push({
    id: m.id,
    content: m.text,
    created_at: m.created_at,
    replying_to_message_id: isReplyToArc ? m.replied_to_tweet_id! : null,
    user: {
      id: m.author_id,
      username: m.author_username ?? undefined,
      name: m.author_name ?? undefined,
    },
  });
  return out;
}

/**
 * Fold a batch of @arc0btc mentions into the lead store, tagging each touched user
 * `channel: "x"` so surfaceLeads routes them to the X warm-reply-assist venue.
 * Arc's own account and the operator's handle(s) are dropped before mapping (X is a
 * separate id namespace from the Whop NON_PROSPECT gate). Idempotent by tweet id.
 * Returns the user_ids touched.
 *
 * GIVE-3X OBSERVABILITY GAP (known, documented for dev-council): value_touches =
 * arc_replies_to_them, and the mentions feed is INBOUND-only — Arc's outbound X
 * replies never appear here, so X leads accrue value_touches=0 and the BLOCKING
 * give-3x gate (≥3 gives before an ask) correctly holds them back from AUTO-posting.
 * That makes X a SURFACING channel today: warm X repliers show up in the lane's
 * blocked list (operator-visible for manual engagement), and auto-assist activates
 * only once Arc's give-history is observable. Closing the gap (fold Arc's own
 * outbound replies via /users/{id}/tweets, OR a council decision on a warm-reply-
 * assist give-3x exception since the assist itself leads with value) is a tracked
 * follow-up — NOT weakened here, because give-3x is a hardened safety rail.
 *
 * IMPORTANT (council lumen #1): the Class-A-only auto-post gate (sensor.ts:
 * autoPostEligible) is the SECOND, INDEPENDENT rail that keeps noisy multi-tag
 * community-thread mentions (where @arc0btc is one of many tags → class B/C) out of
 * auto-posting. Do NOT relax it when closing the give-3x gap, or B/C thread noise
 * becomes auto-pitchable.
 */
export function updateLeadsFromX(
  store: RelationshipStore,
  mentions: XMention[],
  arcXUserId: string,
): string[] {
  const batch: ChatMessage[] = [];
  for (const m of mentions) {
    if (!m.author_id) continue;
    if (m.author_id === arcXUserId) continue; // Arc's own account
    if (m.author_username && OPERATOR_X_USERNAMES.has(m.author_username.toLowerCase())) continue;
    batch.push(...xMentionToMessages(m, arcXUserId));
  }
  const touched = updateFromMessages(store, batch);
  for (const id of touched) {
    const rel = store.users[id];
    if (rel) rel.channel = "x";
  }
  return touched;
}

/** Live X fetch wrapper (injectable for fixtures via refreshLeads' xFetcher). */
export type XFetcher = () => Promise<XMentionsResult>;

/**
 * Live forum fetch: top-level posts + their comments (the company API key
 * carries forum:read). We pull comments on EVERY top-level post that has them —
 * a commenter on an Arc-AMA is a non-member engager (a lead) even when the
 * thread's anchor was authored by the operator, not Arc; the replied-to-ARC
 * (Class A) credit is then assigned correctly by updateFromMessages (only when
 * the parent is an Arc-authored post in the batch). Best-effort per post: one
 * comment-page failure never drops the top-level leads.
 *
 * SCALING CEILING (known, like P10A's pagination ceilings): fan-out is bounded
 * by `topLimit` top-level posts × one 50-comment page each — no deep comment
 * pagination yet. Class-A (replied-to-Arc) attribution shares this ceiling: a
 * reply whose Arc parent has aged past the top-`topLimit` window can't be
 * credited as a reply-to-Arc and downgrades to B/C (dev-council cairn #5). Fine
 * for the current free forum; revisit when posts exceed `topLimit` or a thread
 * exceeds 50 comments — the fetch logs when it touches either ceiling.
 */
export async function fetchFreeForumEngagement(
  apiKey: string,
  experienceId = FREE_FORUM_EXPERIENCE_ID,
  topLimit = 50,
  log: (m: string) => void = () => {},
): Promise<ForumPost[]> {
  const client = whopClient(apiKey);
  const top = await client.forumPosts.list({ experience_id: experienceId, first: topLimit });
  const topPosts = ((top.data ?? []) as unknown) as ForumPost[];
  if (topPosts.length >= topLimit) {
    log(`forum fetch: hit top-level page ceiling (${topPosts.length} >= ${topLimit}) — older posts not paged (forge #3)`);
  }
  const out: ForumPost[] = [...topPosts];
  for (const p of topPosts) {
    if (p.parent_id) continue; // already a comment
    if (p.comment_count === 0) continue; // nothing to fetch
    try {
      const comments = await client.forumPosts.list({
        experience_id: experienceId,
        parent_id: p.id,
        first: 50,
      });
      const cs = ((comments.data ?? []) as unknown) as ForumPost[];
      if (cs.length >= 50) log(`forum fetch: hit 50-comment ceiling on ${p.id} — deeper comments not paged (forge #3)`);
      out.push(...cs);
    } catch (e) {
      // best-effort: keep the top-level leads even if one comment page fails
      log(`forum fetch: comments failed for ${p.id} (${e instanceof Error ? e.message : String(e)}) — skipped (forge #6)`);
    }
  }
  return out;
}

export type RefreshStatus = "ok" | "no-key" | "fetch-failed";

// Per-channel result so the surfacing layer / end-of-quest monitor can tell a
// benign quiet channel ("ok", 0 fetched) from an actionable failure ("no-key" =
// misconfigured creds, "fetch-failed" = API error) — independently per channel
// (forge #5). `fetched` = engagement records pulled; `touched` = lead users updated.
export interface ChannelRefresh {
  status: RefreshStatus;
  touched: number;
  fetched: number;
}

export interface RefreshResult {
  forum: ChannelRefresh;
  x: ChannelRefresh;
  total_leads: number;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Refresh the lead store from BOTH live channels — the free forum (Whop company
 * key) and X (@arc0btc mentions, X OAuth creds) — into the one db/whop-leads.json
 * store. Each channel is independently best-effort: a missing key / fetch failure
 * logs, leaves that channel's existing leads intact, and never throws (the lane
 * then runs on whatever leads are already known — a correct degrade). Fetchers are
 * injectable for fixtures. The store is saved only if a channel actually fetched
 * (so a both-channels-no-key run leaves the file — and its updated_at — untouched).
 */
export async function refreshLeads(opts: {
  apiKey: string | null; // whop company key — forum:read
  fetcher?: ForumFetcher; // inject the forum fetch (fixtures)
  xCreds?: XCreds | null; // X OAuth creds
  xFetcher?: XFetcher; // inject the X fetch (fixtures)
  skipX?: boolean; // refresh forum only (e.g. a forum-only fixture)
  log?: (m: string) => void;
}): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const store = loadLeadStore();

  // --- Forum channel ---
  const forum: ChannelRefresh = { status: "no-key", touched: 0, fetched: 0 };
  try {
    let posts: ForumPost[] | null = null;
    if (opts.fetcher) posts = await opts.fetcher(FREE_FORUM_EXPERIENCE_ID);
    else if (opts.apiKey) posts = await fetchFreeForumEngagement(opts.apiKey, FREE_FORUM_EXPERIENCE_ID, 50, log);
    else log("refresh-leads: no whop company_api_key — skipping forum fetch (forum leads unchanged)");
    if (posts) {
      forum.fetched = posts.length;
      forum.touched = updateLeadsFromForum(store, posts).length;
      forum.status = "ok";
    }
  } catch (e) {
    forum.status = "fetch-failed";
    log(`refresh-leads: forum fetch failed (${errMsg(e)}) — forum leads unchanged`);
  }

  // --- X channel ---
  const x: ChannelRefresh = { status: "no-key", touched: 0, fetched: 0 };
  if (!opts.skipX) {
    try {
      let result: XMentionsResult | null = null;
      if (opts.xFetcher) result = await opts.xFetcher();
      else if (opts.xCreds) result = await fetchArcMentions({ creds: opts.xCreds, arcUserId: ARC_X_USER_ID, log });
      else log("refresh-leads: no X creds — skipping mentions fetch (X leads unchanged)");
      if (result) {
        x.fetched = result.mentions.length;
        x.touched = updateLeadsFromX(store, result.mentions, result.arc_user_id).length;
        x.status = "ok";
      }
    } catch (e) {
      x.status = "fetch-failed";
      log(`refresh-leads: X mentions fetch failed (${errMsg(e)}) — X leads unchanged`);
    }
  }

  if (forum.status === "ok" || x.status === "ok") saveLeadStore(store);
  return { forum, x, total_leads: Object.keys(store.users).length };
}
