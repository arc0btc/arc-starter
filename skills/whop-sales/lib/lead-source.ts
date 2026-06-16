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
// X repliers/mentions are a planned 2nd channel increment (channel "x"); this
// increment wires the free forum (channel "forum").

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  updateFromMessages,
  type ChatMessage,
  type RelationshipStore,
} from "../../whop/lib/relationships.ts";
import { whopClient } from "../../whop/lib/whop-api.ts";

export const FREE_FORUM_EXPERIENCE_ID = "exp_YRtS3kgMVeBGzu";

// Separate from the paid-room store: these are PROSPECTS, not members.
const LEAD_STORE_PATH = resolve(import.meta.dir, "../../../db/whop-leads.json");

// Advisors are free-forever collaborators (the operator's test/help accounts).
// They live in the room/forum but are NOT acquisition prospects and must never
// be pitched. Populated when the first advisor signs up (RESUME-P10B signal 1):
// add the user id HERE — the sensor unions this set into NON_PROSPECT_USER_IDS,
// and we also drop advisor posts before they ever enter the lead store (below).
export const ADVISOR_USER_IDS = new Set<string>([
  // "user_xxxxxxxxxxxx", // <advisor handle> — added when signal 1 lands
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

export interface RefreshResult {
  // Distinguishes the actionable failure (no/forum-misscoped key) from a benign
  // quiet forum, so the surfacing layer / end-of-quest monitor can alert (forge #5).
  status: RefreshStatus;
  touched: number;
  total_leads: number;
  fetched_posts: number;
}

/**
 * Refresh the lead store from the live free forum. Best-effort: a missing key or
 * a fetch failure logs and leaves the existing store intact (the lane then runs
 * on whatever leads are already known — a correct degrade, never a throw). The
 * fetcher is injectable for fixtures.
 */
export async function refreshLeads(opts: {
  apiKey: string | null;
  fetcher?: ForumFetcher;
  log?: (m: string) => void;
}): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const store = loadLeadStore();
  let posts: ForumPost[] = [];
  try {
    if (opts.fetcher) {
      posts = await opts.fetcher(FREE_FORUM_EXPERIENCE_ID);
    } else if (opts.apiKey) {
      posts = await fetchFreeForumEngagement(opts.apiKey, FREE_FORUM_EXPERIENCE_ID, 50, log);
    } else {
      log("refresh-leads: no whop company_api_key — skipping forum fetch (store unchanged)");
      return { status: "no-key", touched: 0, total_leads: Object.keys(store.users).length, fetched_posts: 0 };
    }
  } catch (e) {
    log(`refresh-leads: forum fetch failed (${e instanceof Error ? e.message : String(e)}) — store unchanged`);
    return { status: "fetch-failed", touched: 0, total_leads: Object.keys(store.users).length, fetched_posts: 0 };
  }
  const touched = updateLeadsFromForum(store, posts);
  saveLeadStore(store);
  return {
    status: "ok",
    touched: touched.length,
    total_leads: Object.keys(store.users).length,
    fetched_posts: posts.length,
  };
}
