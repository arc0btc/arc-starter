#!/usr/bin/env bun
// skills/social-x-posting/cli.ts
// CLI for posting tweets and managing X (Twitter) presence via API v2

import { getCredential } from "../../src/credentials.ts";
import { join } from "path";
import { createHash } from "crypto";
// P2 arc-posting-scheduler (2026-07-05): the shared atomic-admission engine. See
// skills/social-engine/admission.ts's module header for the admission-vs-publication
// distinction. cli.ts routes pre-admitted groups (via `reserve-group`) through this
// engine; unmigrated lanes (daily-read, content-calendar, cadence beat — P3 territory)
// keep using the guard stack below unchanged, with one addition: every legacy send now
// also writes budget_ledger (see cmdPost) so guard #3's arbiter-fix read (below) has a
// complete, single counter of truth from day one, not just once P3 migrates real traffic.
import {
  admitGroup, claimForSend, markSent as engineMarkSent, releaseGroupRemainder,
  releaseSingleReservation, releaseAbandonedReservations,
  type Lane as EngineLane,
} from "../social-engine/admission.ts";
// arc-x-research-channel Phase 4 (2026-07-13): username->id resolution for List-membership
// sync and the follow-policy hook needs to be READ-BUDGET METERED (the confirmed $0.010/
// resource "user reads" rate — Phase 1 console reconciliation). cmdFollow's own internal
// username lookup below still uses the unmetered `apiRequest` (a pre-existing gap, out of
// this phase's scope to refactor) — `resolveUserId` is a NEW call site that does it right
// from day one instead of perpetuating the gap.
import { xApiGet, loadXCreds as loadMeteredXCreds } from "./lib/x-api.ts";
import { scanForSkillLeak } from "../social-engine/leak-canary.ts";

const API_BASE = "https://api.x.com/2";
const CACHE_PATH = join(import.meta.dir, "../../db/x-cache.json");
const BUDGET_PATH = join(import.meta.dir, "../../db/x-budget.json");
const BUDGET_HISTORY_PATH = join(import.meta.dir, "../../db/x-budget-history.json"); // AI-005: trailing cadence history
const CREDITS_DEPLETED_PATH = join(import.meta.dir, "../../db/x-credits-depleted.json");

const CREDITS_DEPLETED_TTL_DAYS = 30;

// ---- Credits Depleted Gate ----

interface CreditsDepleted {
  depleted_at: string;
  reason: string;
}

async function checkCreditsDepleted(): Promise<void> {
  try {
    const file = Bun.file(CREDITS_DEPLETED_PATH);
    if (!(await file.exists())) return;
    const data = (await file.json()) as CreditsDepleted;
    const depletedAt = new Date(data.depleted_at);
    const expiresAt = new Date(depletedAt.getTime() + CREDITS_DEPLETED_TTL_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < expiresAt) {
      throw new Error(
        `X API credits depleted (since ${data.depleted_at}). ` +
          `Auto-clears ${expiresAt.toISOString()}. ` +
          `To clear manually: rm db/x-credits-depleted.json`
      );
    }
    // Expired — auto-clear
    await Bun.write(CREDITS_DEPLETED_PATH, "");
    log("Credits depleted flag expired and cleared (30 days passed)");
  } catch (e) {
    // Re-throw our own error; swallow JSON parse issues
    if (e instanceof Error && e.message.includes("credits depleted")) throw e;
  }
}

async function setCreditsDepleted(reason: string): Promise<void> {
  const data: CreditsDepleted = { depleted_at: new Date().toISOString(), reason };
  await Bun.write(CREDITS_DEPLETED_PATH, JSON.stringify(data, null, 2));
  log(`Credits depleted flag written: ${reason}`);
}

// ---- Source-dedup for the non-idempotent POST /tweets write path. ----
// `post`/`reply` hit POST /tweets, which is non-idempotent and has NO idempotency
// header (unlike Whop's `idempotencyKey`). An optional --source key gives replay
// protection via a LOCAL ledger (x_post_log): a recorded source short-circuits
// BEFORE any API/budget call, so a sequential re-run (a dispatch retry or a
// next-cycle fan-out re-fire — the real operational profile, since each agent
// dispatches one task at a time) never double-posts. This mirrors the proven
// whop_post_log ledger (skills/whop/cli.ts); the local ledger is the SOLE
// exactly-once guarantee. Same accepted, practically-unreachable limits as whop:
// concurrent same-source posts could both pass the check-then-act gate, and a
// post-succeeds-then-record-throws window leaves a source unrecorded — both
// unreachable under single-threaded per-agent dispatch + local WAL sqlite.
// No --source = legacy raw post (callers that dedup at the dispatch-task layer
// are unaffected). Table is lazily created in the shared db/arc.sqlite.
async function xPostLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS x_post_log (
       source TEXT PRIMARY KEY,
       tweet_id TEXT,
       posted_at TEXT NOT NULL,
       is_root INTEGER NOT NULL DEFAULT 0
     )`,
  );
  // P2 arc-funnel-hardening: add is_root column to existing installs (idempotent).
  try { db.run("ALTER TABLE x_post_log ADD COLUMN is_root INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
  return db;
}

// True if this source already posted (prints a skip line so the caller returns
// early without touching the budget or the API). A no-op when no --source given.
async function dedupSkip(source: string | undefined): Promise<boolean> {
  if (!source) return false;
  const db = await xPostLog();
  const prior = db.query("SELECT tweet_id FROM x_post_log WHERE source = ?").get(source) as
    | { tweet_id: string | null }
    | null;
  if (!prior) return false;
  console.log(`already posted: ${source} (tweet ${prior.tweet_id ?? "?"}) — skipping`);
  return true;
}

async function recordPost(source: string, tweetId: string | null, isRoot: boolean = false): Promise<void> {
  const db = await xPostLog();
  db.query(
    "INSERT OR IGNORE INTO x_post_log (source, tweet_id, posted_at, is_root) VALUES (?, ?, ?, ?)",
  ).run(source, tweetId, new Date().toISOString(), isRoot ? 1 : 0);
}
// ---- X reply log (AI-018/031: give-3x gap for X channel) -------------------
//
// When Arc replies to a mention, we log the original author's X id so
// refreshLeads (lead-source.ts) can increment arc_replies_to_them for that lead.
// The author id comes from the sensor task description via --x-lead-id.
// This closes the give-3x observability gap: X leads now accrue value_touches
// from outbound replies (each reply = one give), enabling the enforcement gate
// to unblock auto-assist once ≥3 gives are on record.
async function xReplyLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS x_reply_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       replied_to_tweet_id TEXT NOT NULL,
       reply_tweet_id TEXT,
       x_lead_author_id TEXT,
       replied_at TEXT NOT NULL
     )`,
  );
  return db;
}

/**
 * Record an outbound X reply so lead-source.ts can fold it into arc_replies_to_them.
 * xLeadAuthorId = the X author_id of the tweet Arc replied to (from --x-lead-id flag).
 * No-op when xLeadAuthorId is absent (legacy callers without the flag are unaffected).
 */
async function recordXReply(
  repliedToTweetId: string,
  replyTweetId: string | null,
  xLeadAuthorId: string | undefined,
): Promise<void> {
  if (!xLeadAuthorId) return;
  const db = await xReplyLog();
  db.query(
    "INSERT INTO x_reply_log (replied_to_tweet_id, reply_tweet_id, x_lead_author_id, replied_at) VALUES (?, ?, ?, ?)",
  ).run(repliedToTweetId, replyTweetId, xLeadAuthorId, new Date().toISOString());
}

// ---- Cache ----

interface CacheEntry {
  id: string;
  type: "tweet" | "user";
  fetched_at: string;
  data: Record<string, unknown>;
}

interface Cache {
  tweets: Record<string, CacheEntry>;
  users: Record<string, CacheEntry>;
}

async function loadCache(): Promise<Cache> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (await file.exists()) {
      return (await file.json()) as Cache;
    }
  } catch {
    // corrupt cache, start fresh
  }
  return { tweets: {}, users: {} };
}

async function saveCache(cache: Cache): Promise<void> {
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ---- Daily Budget ----

interface DailyBudget {
  date: string; // YYYY-MM-DD
  posts: number;
  replies: number;
  likes: number;
  retweets: number;
  follows: number;
  // Pay-per-use dollar tracking (2026-07-06, task #21463). X billing is pay-per-use:
  // a plain post costs $0.015, a post containing a LINK costs $0.20 (= the price of
  // 40 reads — the single largest X line item). These fields log write spend and
  // count link posts for the soft daily LINK_POST_DAILY_CAP. Optional so pre-existing
  // on-disk budget files (which lack them) still parse.
  link_posts?: number;      // count of link-bearing posts today ($0.20 tier)
  write_spend_usd?: number; // dollars spent on writes today
  // Split-brain reconciliation (control-plane-remediation Phase 2, defect row 56, 2026-07-16/17):
  // `posts` above is INTENTIONALLY legacy-lane-only (it gates checkBudget's 3/day cap, and
  // coupling reserved-group volume into that cap would let daily-read/content-calendar traffic
  // lock out the unrelated legacy lane). But that means `posts` undercounts real X output on any
  // day with reserved-group activity — a reader of this file alone gets a false picture. This
  // field is DERIVED (never independently written) straight from budget_ledger — the table both
  // paths already feed — so it can never drift from it. See reconcileFromLedger().
  budget_ledger_posts_today?: number;
}

// Pay-per-use write rates (2026 X API). See research/2026-07-06_x-api-budget-ground-truth.md.
const WRITE_COST_PLAIN_USD = 0.015;
const WRITE_COST_LINK_USD = 0.2;
// Link posts are the dominant X cost line. Soft daily cap so an automated burst
// (e.g. blog→X announcements) can't silently run up the bill. Enforced on ROOT
// legacy posts only — thread CTAs and pre-admitted reserved-group sends are logged
// but never blocked mid-chain (the "never truncate a thread" invariant).
const LINK_POST_DAILY_CAP = 3;

/** True when a tweet's text carries a URL — X bills these at the $0.20 link tier.
 * Matches explicit http(s):// links and bare t.co short links (the real cases:
 * blog posts, whop links). Bare auto-linked domains are not detected to avoid
 * false positives that would wrongly bill a plain post at the link rate. */
function postContainsLink(text: string): boolean {
  return /https?:\/\/\S+/i.test(text) || /(^|\s)t\.co\/\S+/i.test(text);
}

// P2 arc-funnel-hardening (2026-06-27): primary daily cap covering ALL tweet types
// (roots + thread continuations + CTA tweets). Panel target: 6/day. This cap is a
// quality/cadence control, not a cost ceiling — X billing is pay-per-use, so cost is
// governed by the per-post dollar rates ($0.015 plain / $0.20 link) and the
// LINK_POST_DAILY_CAP, not a tweet count. BUDGET_LIMITS.posts=3 remains a secondary
// root-only guard.
const DAILY_TWEET_CAP = 6;

// Content-calendar x_thread backlog throttle (task #21169, root cause: task #21165).
// cadenceGateOpen() in state-machine.ts only checks elapsed time since cadence_anchor, with no
// memory of prior cap-exhaustion deferrals — once a backlog of anchors builds up (e.g. deferred
// across several days by DAILY_TWEET_CAP exhaustion), every eligible hop fires in the same burst
// the moment the shared cap resets at UTC midnight. state-machine.ts enforces its own
// CONTENT_CALENDAR_X_THREAD_DAILY_CAP at task-creation-time; the post-time enforcement that used
// to live here (this constant) became dead code once content-calendar fully migrated onto
// reserve-group (branch 1 of cmdPost intercepts every content-calendar: source before reaching
// this legacy guard stack) — removed 2026-07-07 (task #21524).

// Daily-read scheduling fix (arc-demand-gen P1). arc-daily-read's sensor needs 4 of the shared
// 6 slots free at its UTC 13:00 window, but content-calendar threads and the proactive cadence
// beat both converge on THIS post-time guard and were front-loading the shared cap near UTC
// midnight — silently starving daily-read for days (hook state showed last_ran ticking every
// 30 min while last_queued_date stayed stuck). Mention replies do NOT go through this guard —
// they call providerReplySend() directly (below) against a separate budget_ledger table, never
// x_post_log — so they cannot consume this reservation and are not a lane this fix needs to
// gate; dev-council flagged this as worth confirming explicitly rather than assuming from the
// `--reply-to` flag shape alone (verified 2026-07-05: skills/social-engine/reply-send.ts calls
// providerReplySend, not cmdPost).
//
// arc-strategy-panel (7-lens, docs/specs/2026-07-05-daily-read-scheduling-fix-decision.md, this
// quest's control-plane repo) confirmed a reservation at this single shared enforcement point
// survives lane rotation — unlike retiming any one lane — and UNANIMOUSLY required it gate NEW
// thread starts (root posts) only, never truncate an in-progress thread mid-chain.
// DAILY_TWEET_CAP=6 above is UNCHANGED — this is a reservation layered on top, lifted the moment
// arc-daily-read posts today or its window has closed for the day.
//
// HONEST LIMIT (dev-council/Lamport, 2026-07-05): "never truncate" and "guarantee 4 free slots"
// are in real tension once a permitted thread's OWN continuations are exempt from this cap (they
// must be, or the no-truncation mandate breaks) — a single permitted thread can still run to
// 4-5 tweets and eat into the reserved 4, same as it could pre-fix. What this fix DOES guarantee:
// at most ONE non-daily-read thread gets to start before daily-read's window resolves, not an
// unbounded pile-up of several. That's why the gate below is "any non-daily-read post already
// today blocks a NEW one from starting" (todayCount > 0), not merely "fewer than 2 have posted" —
// the original 2-slot threshold would let a SECOND lane's root start too, compounding the exact
// overrun risk this paragraph describes. Residual risk (one thread overrunning) is accepted by
// the panel as strictly better than truncating a thread mid-chain.
function isDailyReadSource(source: string): boolean {
  return /^daily-read:/.test(source);
}

// Sensor's window is 13:00-13:29 UTC; by 14:00 the day's window has fully resolved (posted or
// not) so holding other lanes back any longer would waste capacity for no remaining benefit.
const DAILY_READ_WINDOW_CLOSE_UTC_HOUR = 14;

/** True if arc-daily-read already logged an edition today (readonly check, table may not exist yet). */
function dailyReadPostedToday(db: { query: (sql: string) => { get: () => unknown } }): boolean {
  try {
    const row = db.query(
      "SELECT COUNT(*) as n FROM daily_read_log WHERE date(posted_at) = date('now')",
    ).get() as { n: number } | null;
    return (row?.n ?? 0) > 0;
  } catch (error) {
    // daily_read_log doesn't exist yet on a fresh install — nothing posted today by definition,
    // keep reserving (safe default). Logged (dev-council/Kleppmann) so a DIFFERENT, transient
    // failure (lock contention, corruption) isn't silently indistinguishable from that case.
    log(`dailyReadPostedToday query failed, defaulting to "not posted" (keeps reservation active): ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const BUDGET_LIMITS: Record<string, number> = {
  // GTM cadence dial-down (2026-06-15): hard daily X-post ceiling lowered 10 → 3 so the
  // account reads as lean/high-signal (~1-2 substantive items/day), reserving posts for
  // content-calendar proof-of-work threads (the proactive snippet-drip cadence is paused via
  // X_CADENCE_ENABLED=false in .env). Revert: restore `posts: 10` (or the .bak-gtm copy).
  posts: 3,
  replies: 40,
  likes: 50,
  retweets: 15,
  follows: 20,
};

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Split-brain reconciliation (defect row 56): budget_ledger is fed by BOTH the legacy path
// (dual-write, see cmdPost's "legacy budget_ledger dual-write" comment) and the reserved-group
// fast path (engineMarkSent) — it is already the complete picture. x-budget.json's own `posts`
// field only ever sees the legacy path (by design — see budget_ledger_posts_today's doc comment
// on DailyBudget). This computes the TRUE total straight from budget_ledger so a reader of the
// JSON file alone gets an accurate number without touching the cap-coupled `posts` field. Never
// throws — a reconciliation failure must not block a real budget save.
export async function reconcileFromLedger(dateStr: string): Promise<number> {
  try {
    const { initDatabase, getDatabase } = await import("../../src/db.ts");
    initDatabase();
    const db = getDatabase();
    const row = db
      .query(`SELECT COALESCE(SUM(sent_count), 0) as n FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane != 'reply'`)
      .get(dateStr) as { n: number } | null;
    return row?.n ?? 0;
  } catch (e) {
    log(`reconcileFromLedger failed (non-fatal, budget_ledger_posts_today left stale): ${e instanceof Error ? e.message : String(e)}`);
    return -1; // sentinel: reconciliation unavailable this call, not "zero posts"
  }
}

export async function loadBudget(): Promise<DailyBudget> {
  const today = todayDateStr();
  try {
    const file = Bun.file(BUDGET_PATH);
    if (await file.exists()) {
      const data = (await file.json()) as DailyBudget;
      if (data.date === today) return data;
      // AI-005: Day rolled over — archive yesterday's budget to the history file before resetting.
      // x-budget-history.json is a JSON array, capped at 30 entries (trailing ~1 month).
      //
      // Row 57 fix (2026-07-16/17): `loadBudget()` is called on EVERY action attempt (via
      // checkBudget), not just once per rollover. The old code appended to history here but
      // never persisted the reset — so every call between midnight UTC and the FIRST successful
      // saveBudget() that day re-read this same stale file and appended ANOTHER duplicate history
      // row (live evidence: 9 duplicate dates, up to 6x on 07-05/07-10). Two independent fixes,
      // both idempotent so either alone would close the gap:
      try {
        const histFile = Bun.file(BUDGET_HISTORY_PATH);
        const existing = histFile.size > 0 ? ((await histFile.json()) as DailyBudget[]) : [];
        const existingArr = Array.isArray(existing) ? existing : [];
        // (a) dedup-by-date guard — never append a date already archived, regardless of races.
        const alreadyArchived = existingArr.some((e) => e?.date === data.date);
        if (!alreadyArchived) {
          const trimmed = existingArr.slice(-29); // keep last 29 + new = 30
          trimmed.push(data);
          await Bun.write(BUDGET_HISTORY_PATH, JSON.stringify(trimmed, null, 2));
        }
      } catch {
        // History write is best-effort — never block the budget reset
      }
      // (b) persist the reset immediately — a second loadBudget() call the same day now sees
      // the already-rolled-over file instead of the stale one, closing the window fast even
      // without the dedup guard.
      const fresh: DailyBudget = { date: today, posts: 0, replies: 0, likes: 0, retweets: 0, follows: 0, link_posts: 0, write_spend_usd: 0 };
      await saveBudget(fresh);
      return fresh;
    }
  } catch {
    // corrupt file, start fresh
  }
  return { date: today, posts: 0, replies: 0, likes: 0, retweets: 0, follows: 0, link_posts: 0, write_spend_usd: 0 };
}

export async function saveBudget(budget: DailyBudget): Promise<void> {
  // Row 56 fix: stamp the ledger-derived reconciliation field on every save so it's always
  // current for whatever action just mutated the budget (legacy increment, reserved-group
  // recordWriteSpend, or this rollover reset). -1 sentinel (reconciliation unavailable) is
  // written as-is rather than silently coerced to 0 — a reader can tell "no posts today" from
  // "couldn't reconcile" apart.
  budget.budget_ledger_posts_today = await reconcileFromLedger(budget.date);
  // P2 arc-funnel-hardening: atomic temp-and-rename (crash-safe, matches saveReadBudget).
  const temporaryFilePath = BUDGET_PATH + ".tmp";
  await Bun.write(temporaryFilePath, JSON.stringify(budget, null, 2));
  const { renameSync } = await import("node:fs");
  renameSync(temporaryFilePath, BUDGET_PATH);
}

class BudgetExhaustedError extends Error {
  constructor(message: string) { super(message); this.name = "BudgetExhaustedError"; }
}

async function checkBudget(action: string): Promise<void> {
  const budget = await loadBudget();
  const limit = BUDGET_LIMITS[action];
  if (limit === undefined) return;
  const used = budget[action as keyof DailyBudget] as number;
  if (used >= limit) {
    throw new BudgetExhaustedError(
      `Daily ${action} budget exhausted: ${used}/${limit}. Resets at midnight UTC.`
    );
  }
}

async function incrementBudget(action: string): Promise<DailyBudget> {
  const budget = await loadBudget();
  const key = action as keyof DailyBudget;
  if (typeof budget[key] === "number") {
    (budget as unknown as Record<string, unknown>)[action] = (budget[key] as number) + 1;
  }
  await saveBudget(budget);
  return budget;
}

/** Soft daily cap on LINK posts ($0.20 each — the dominant X cost). Throws
 * BudgetExhaustedError when the cap is hit so callers route it through the same
 * exit-2 defer path as the post-count budget. Enforced on root legacy posts only. */
async function checkLinkPostBudget(): Promise<void> {
  const budget = await loadBudget();
  const used = budget.link_posts ?? 0;
  if (used >= LINK_POST_DAILY_CAP) {
    throw new BudgetExhaustedError(
      `Daily LINK-post budget exhausted: ${used}/${LINK_POST_DAILY_CAP} link posts today ($0.20 each). Resets at midnight UTC.`
    );
  }
}

/** Record a completed post's pay-per-use write cost (plain $0.015 / link $0.20)
 * and, for link posts, bump the link_posts counter. Logs the per-post dollar
 * amount. Best-effort accounting — never throws into the caller's send path. */
async function recordWriteSpend(hasLink: boolean): Promise<void> {
  try {
    const budget = await loadBudget();
    const cost = hasLink ? WRITE_COST_LINK_USD : WRITE_COST_PLAIN_USD;
    budget.write_spend_usd = Math.round(((budget.write_spend_usd ?? 0) + cost) * 1e6) / 1e6;
    if (hasLink) budget.link_posts = (budget.link_posts ?? 0) + 1;
    await saveBudget(budget);
    log(
      `X write cost: $${cost.toFixed(3)} (${hasLink ? "LINK post — $0.20 tier" : "plain post"}); ` +
        `today writes=$${budget.write_spend_usd.toFixed(3)}` +
        (hasLink ? `, link_posts=${budget.link_posts}/${LINK_POST_DAILY_CAP}` : "")
    );
  } catch (e) {
    log(`recordWriteSpend failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [x-posting/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

// ---- OAuth 1.0a Signing ----

function percentEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    nonce += chars[byte % chars.length];
  }
  return nonce;
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

interface OAuthCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

async function loadCreds(): Promise<OAuthCreds> {
  const apiKey = await getCredential("x", "consumer_key");
  const apiSecret = await getCredential("x", "consumer_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    const missing: string[] = [];
    if (!apiKey) missing.push("x/consumer_key");
    if (!apiSecret) missing.push("x/consumer_secret");
    if (!accessToken) missing.push("x/access_token");
    if (!accessTokenSecret) missing.push("x/access_token_secret");
    throw new Error(
      `Missing X credentials: ${missing.join(", ")}. ` +
        `Set them with: arc creds set --service x --key <key> --value <value>`
    );
  }

  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

async function buildOAuthHeader(
  method: string,
  url: string,
  creds: OAuthCreds,
  params: Record<string, string> = {}
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and query params for signature base
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ---- API Calls ----

async function apiRequest(
  method: string,
  endpoint: string,
  creds: OAuthCreds,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string>
): Promise<Record<string, unknown>> {
  const baseUrl = `${API_BASE}${endpoint}`;
  const url = queryParams
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const authHeader = await buildOAuthHeader(method, baseUrl, creds, queryParams ?? {});

  const options: RequestInit = {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 204) {
    return { deleted: true };
  }

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 402) {
      await setCreditsDepleted(`402 CreditsDepleted from ${endpoint}`);
      throw new Error(
        `X API 402 CreditsDepleted: posting credits exhausted. ` +
          `Flag written to db/x-credits-depleted.json — future post/reply calls will skip for 30 days.`
      );
    }
    const apiErr = new Error(`X API error ${response.status}: ${JSON.stringify(data)}`) as Error & {
      status?: number;
      body?: unknown;
    };
    apiErr.status = response.status;
    apiErr.body = data;
    throw apiErr;
  }

  return data as Record<string, unknown>;
}

// ---- Inter-send spacing (2026-07-06, shipped after the X-flag review) -------
//
// The 2026-07-06T01:02Z incident posted 4 thread tweets in 11 seconds: each
// tweet is a separate CLI invocation, and nothing anywhere imposed a gap
// between consecutive sends. That burst cadence is the platform-manipulation
// signature X flagged @arc0btc for (review cleared 2026-07-06, label removed).
// Enforce a minimum ACCOUNT-WIDE gap between any two outbound sends — posts
// and replies, both ledgers live in the same DB — at the only three call sites
// that issue POST /tweets. Sleeping inside the CLI is safe: callers are LLM
// dispatch turns that already block on this process. The wait is bounded so a
// skewed/garbled ledger timestamp can never hang a dispatch turn.
const MIN_INTER_SEND_SECONDS = 45;
const INTER_SEND_JITTER_SECONDS = 45; // effective gap 45-90s, varies per send
async function enforceInterSendSpacing(context: string): Promise<void> {
  const db = await xPostLog();
  await xReplyLog(); // same DB handle; ensures x_reply_log exists before the UNION read
  const row = db.query(
    `SELECT MAX(t) as last FROM (
       SELECT MAX(posted_at) as t FROM x_post_log
       UNION ALL
       SELECT MAX(replied_at) as t FROM x_reply_log
     )`,
  ).get() as { last: string | null } | null;
  if (!row?.last) return;
  const elapsedMs = Date.now() - new Date(row.last).getTime();
  const requiredMs = (MIN_INTER_SEND_SECONDS + Math.floor(Math.random() * INTER_SEND_JITTER_SECONDS)) * 1000;
  if (elapsedMs >= requiredMs) return;
  const waitMs = Math.min(requiredMs - elapsedMs, 120_000);
  log(`inter-send spacing: last outbound send ${Math.round(elapsedMs / 1000)}s ago (${context}) — waiting ${Math.round(waitMs / 1000)}s before this send`);
  await Bun.sleep(waitMs);
}

// ---- Low-level reply provider primitive (single send code path) ------------
//
// This is the ONLY function that issues POST /tweets for a reply. It does NO
// dedup, NO budget mutation, and NO x_post_log write — those concerns belong to
// the unified social-engine reply sender (skills/social-engine/reply-send.ts),
// which is the SOLE caller path that decides whether a reply may be sent
// (canonical source_key UNIQUE dedup + outbound_enabled kill switch + budget_ledger).
//
// Returns the raw provider result on success. On a non-2xx the underlying
// apiRequest throws an Error carrying { status, body } so the caller can
// classify a reply-restriction 403 (skip) vs a true auth/scope 401/403 and
// persist the RAW provider JSON. Do NOT add a direct caller that skips the
// unified sender — that would re-open the duplicate-reply bypass.
export interface ProviderReplyResult {
  postId: string | null;
  raw: Record<string, unknown>;
}

export async function providerReplySend(
  text: string,
  tweetId: string,
): Promise<ProviderReplyResult> {
  if (text.length > 280) {
    throw new Error(`Reply too long: ${text.length}/280 characters`);
  }
  // Honor the X-API-credits-depleted gate (402 backpressure) before any send.
  await checkCreditsDepleted();
  await enforceInterSendSpacing("reply");
  const creds = await loadCreds();
  const body = { text, reply: { in_reply_to_tweet_id: tweetId } };
  const result = await apiRequest("POST", "/tweets", creds, body);
  const data = result["data"] as Record<string, string> | undefined;
  return { postId: data?.["id"] ?? null, raw: result };
}

// ---- Commands ----

async function cmdPost(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  if (!text) {
    console.log("Usage: post --text <tweet text>");
    process.exit(1);
  }
  if (text.length > 280) {
    console.log(`Tweet too long: ${text.length}/280 characters`);
    process.exit(1);
  }

  // Unescape HTML entities in the text to fix ASCII '->' being escaped to '-&gt;'
  const unescapeHtml = (inputText: string): string => {
    const htmlEntities: Record<string, string> = {
      '&gt;': '>',
      '&lt;': '<',
      '&amp;': '&',
      '&quot;': '"',
      '&apos;': "'",
    };
    return inputText.replace(/&(gt|lt|amp|quot|apos);/g, (_, entity) => htmlEntities[`&${entity};`] || `_${entity}_`);
  };
  const unescapedText = unescapeHtml(text);

  // ── leak canary: block verbatim/near-verbatim SKILL.md/AGENT.md recovery ──
  // (arXiv 2604.21829 black-box extraction defense-in-depth; see leak-canary.ts.
  // Extends the reply-lane canary, task #26535, to X root posts. Runs before the
  // fast-path/legacy-path branch below so it covers both.)
  const leakScan = scanForSkillLeak(unescapedText);
  if (leakScan.leaked) {
    log(`leak-canary: blocked post — matched "${leakScan.matchedShingle}" from ${leakScan.sourceFile}`);
    console.log(JSON.stringify({
      skipped: true,
      reason: "skillmd_leak_detected",
      detail: `matched "${leakScan.matchedShingle}" from ${leakScan.sourceFile}`,
    }));
    process.exit(1);
  }

  // Pay-per-use write tier: a link post costs $0.20 vs $0.015 plain (task #21463).
  const hasLink = postContainsLink(unescapedText);

  // ── P2 arc-posting-scheduler: pre-admitted-group fast path ─────────────────────
  // If --source matches an outbound_action row (admitted upfront via `reserve-group`),
  // the WHOLE guard stack below (dedup/kill-switch/DAILY_TWEET_CAP/reservation/
  // content-calendar-cap) was already enforced atomically at admission time —
  // re-running it here would be redundant AND wrong (the group's budget is already
  // reserved; re-checking headroom against it would double-count). Instead: fence-claim
  // the row, send, and markSent (dual-writes x_post_log). This is the ONLY path this
  // phase adds that actually drains the new engine; every other lane (daily-read,
  // content-calendar, cadence beat) still takes the unchanged legacy path below until
  // P3 migrates their callers onto `reserve-group`.
  if (flags["source"]) {
    const engineDb = await xPostLog(); // shared arc.sqlite handle; xPostLog() also ensures x_post_log exists

    // dev-council/Kleppmann (CONFIRMED gap, F1 — double-publication): the original
    // lookup filtered `AND status='queued'`, so once claimForSend flipped a row to
    // 'sending' a RETRY of the same --source found preAdmitted=null and fell through
    // to the LEGACY path below, which posts unconditionally (its own dedupSkip only
    // checks x_post_log, which the in-flight drainer hasn't written yet) — a real
    // double-post. Fix: look up the row by source_key alone (no status filter) so ANY
    // engine-known row — regardless of status — is recognized and NEVER falls through
    // to the legacy poster.
    const engineRow = engineDb
      .query(
        `SELECT id, lane, budget_day, is_root, atomic_group_id, status, earliest_utc_time, latest_utc_time
         FROM outbound_action WHERE source_key=?`
      )
      .get(flags["source"]) as
      | {
          id: number; lane: string; budget_day: string; is_root: number; atomic_group_id: string | null;
          status: string; earliest_utc_time: string | null; latest_utc_time: string | null;
        }
      | null;

    if (engineRow && engineRow.status !== "queued") {
      // This source was already handled by the new engine (sent/sending/unknown/
      // skipped) — never let it fall through to an ungated legacy POST.
      log(`source=${flags["source"]} already known to the engine (outbound_action id=${engineRow.id}, status=${engineRow.status}) — refusing to re-post via legacy path`);
      console.log(JSON.stringify({ skipped: true, reason: "already_handled_by_engine", source: flags["source"], existingStatus: engineRow.status }));
      return;
    }

    if (engineRow) { // status === 'queued'
      // ── P3 arc-posting-scheduler: per-lane time-window enforcement at drain time ──
      // reserve-group stored earliest_utc_time/latest_utc_time on this row (NULL/NULL
      // = anytime, unchanged legacy behavior). Checked here, not at admission, because
      // admission and drain can be minutes apart (daily-read/content-calendar draft
      // then post in the same dispatch turn, but a retry could land later).
      const nowHHMM = new Date().toISOString().slice(11, 16); // "HH:MM" UTC
      if (engineRow.latest_utc_time && nowHHMM > engineRow.latest_utc_time) {
        // dev-council/Hohpe (CONFIRMED HIGH — the phase's most severe finding): the
        // ORIGINAL version of this branch released the row + its atomic-group remainder
        // unconditionally the instant the window closed — including when the ROOT of
        // this exact group had ALREADY been sent (e.g. root posts at 13:59, reply-2's
        // drain call lands at 14:01). That left a live, PARTIALLY-PUBLISHED thread on X
        // (an orphaned root with no body/CTA) while the DB's release made the ledger
        // believe the whole group never happened — the precise "atomic admission,
        // NOT atomic publication" gap this module's own header warns about, made
        // concrete and worse by a mid-drain time boundary. Fix: once ANY sibling in the
        // group has actually posted, the group is committed — finish it regardless of
        // the wall clock, matching this quest's "never truncate a thread mid-chain"
        // mandate (extended here to the window boundary, not just the budget boundary
        // the original mandate was written for).
        const groupHasSentSibling = engineRow.atomic_group_id
          ? engineDb.query(
              `SELECT 1 FROM outbound_action WHERE atomic_group_id=? AND status='sent' LIMIT 1`
            ).get(engineRow.atomic_group_id) != null
          : false;

        if (!groupHasSentSibling) {
          // Window CLOSED with no post yet AT ALL for this group — safe to release. This
          // is the exact "loud, not silent" alert the predecessor panel required
          // (daily-read's arc-daily-read.json hook-state write, task 2 of this phase,
          // sources its defer reason from THIS branch).
          log(`WINDOW CLOSED — no post: source=${flags["source"]} (outbound_action id=${engineRow.id}, lane=${engineRow.lane}) window was ${engineRow.earliest_utc_time ?? "anytime"}-${engineRow.latest_utc_time} UTC, now=${nowHHMM} — releasing reservation`);
          releaseSingleReservation(engineDb, engineRow.id, `window closed with no post (latest_utc_time=${engineRow.latest_utc_time}, now=${nowHHMM})`);
          if (engineRow.atomic_group_id) {
            releaseGroupRemainder(engineDb, engineRow.atomic_group_id, `window closed with no post for source=${flags["source"]}`);
          }
          console.log(JSON.stringify({
            skipped: true, reason: "window_closed_no_post", source: flags["source"],
            earliest_utc_time: engineRow.earliest_utc_time, latest_utc_time: engineRow.latest_utc_time, now: nowHHMM,
          }));
          process.exit(3);
        }
        log(`window closed but atomic_group_id=${engineRow.atomic_group_id} already has a SENT sibling — finishing the group rather than truncating it (source=${flags["source"]}, now=${nowHHMM})`);
        // Falls through to the claim+send flow below — this tweet completes its
        // already-committed group instead of being released.
      }
      if (engineRow.earliest_utc_time && nowHHMM < engineRow.earliest_utc_time) {
        // Window hasn't opened yet — defer WITHOUT releasing. The reservation stays
        // valid; the caller (or its own retry) tries again later, still inside the window.
        log(`window not open yet: source=${flags["source"]} (outbound_action id=${engineRow.id}, lane=${engineRow.lane}) opens at ${engineRow.earliest_utc_time} UTC, now=${nowHHMM} — deferring, reservation kept`);
        console.log(JSON.stringify({
          deferred: true, reason: "window_not_open_yet", source: flags["source"],
          earliest_utc_time: engineRow.earliest_utc_time, now: nowHHMM,
        }));
        process.exit(2);
      }

      await checkCreditsDepleted();
      const claimed = claimForSend(engineDb, engineRow.id);
      if (!claimed) {
        log(`reserve-group row id=${engineRow.id} source=${flags["source"]} could not be claimed (status changed since admission) — skipping`);
        console.log(JSON.stringify({ skipped: true, reason: "claim_failed", source: flags["source"] }));
        process.exit(3);
      }

      // dev-council/Fowler (CONFIRMED gap): admitGroup() only checks the kill switch
      // ONCE, at admission time. A kill switch flipped false mid-drain (between
      // reserve-group and this send) must still stop the send — "kill switch" means
      // stop NOW, not "was I enabled when queued." Re-check right before the API call.
      const ksRow = engineDb.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
      if (ksRow?.value !== "true") {
        log(`kill switch active (outbound_enabled=${ksRow?.value ?? "missing"}) mid-drain — halting reserved-group send for source=${flags["source"]}`);
        releaseSingleReservation(engineDb, engineRow.id, "kill switch went false between admission and send");
        console.log(JSON.stringify({ halted: true, reason: "kill_switch", outbound_enabled: ksRow?.value ?? "missing" }));
        return;
      }

      await enforceInterSendSpacing(`reserved-group ${flags["source"] ?? "?"}`);
      const creds = await loadCreds();
      const body: Record<string, unknown> = { text: unescapedText };
      if (flags["reply-to"]) body["reply"] = { in_reply_to_tweet_id: flags["reply-to"] };
      // arc-day-n-publishing P4: event-driven quote-tweet support. A quote-tweet is a
      // regular tweet with an attached reference (X API v2 top-level `quote_tweet_id`),
      // NOT a reply — it deliberately inherits this exact guard stack (kill switch,
      // DAILY_TWEET_CAP, budget, enforceInterSendSpacing, terminal-403-no-retry) because,
      // unlike the reply lane, quote-tweets DO count against the post cap.
      if (flags["quote-tweet-id"]) body["quote_tweet_id"] = flags["quote-tweet-id"];

      log(`Posting tweet via reserved group (${text.length} chars, ${flags["reply-to"] ? "continuation" : flags["quote-tweet-id"] ? "quote" : "root"}, atomic_group_id=${engineRow.atomic_group_id})...`);
      let groupResult: Awaited<ReturnType<typeof apiRequest>>;
      try {
        groupResult = await apiRequest("POST", "/tweets", creds, body);
      } catch (err) {
        if ((err as { status?: number })?.status === 403) {
          // Same terminal-skip-no-retry posture as the legacy path (guard #4, kept
          // as-is) — PLUS release BOTH this row's own reservation (dev-council/Fowler+
          // Lamport, CONFIRMED: the original only released still-'queued' SIBLINGS,
          // never the failed row itself — every terminal 403 leaked exactly 1) AND the
          // rest of the group's reservation, so a mid-group truncation doesn't inflate
          // reserved_count forever.
          log(`X 403 on reserved-group send (source=${flags["source"]}) — backing off, NO retry.`);
          releaseSingleReservation(engineDb, engineRow.id, `terminal 403 on source_key=${flags["source"]}`);
          if (engineRow.atomic_group_id) {
            const released = releaseGroupRemainder(
              engineDb, engineRow.atomic_group_id,
              `terminal 403 on source_key=${flags["source"]}`
            );
            log(`Released own row + ${released.length} remaining queued row(s) in atomic_group_id=${engineRow.atomic_group_id}`);
          }
          console.log(JSON.stringify({
            skipped: true, reason: "x_403_backoff", retry: false,
            source: flags["source"],
            detail: ((err as Error).message ?? "403 Forbidden").slice(0, 300),
          }));
          process.exit(3);
        }
        // CONFIRMED LIVE (task #22087): any OTHER apiRequest() failure — notably 402
        // CreditsDepleted, which has no `.status` set and previously fell straight
        // through to `throw err` below with zero release — leaked this row's own
        // reservation AND its atomic-group siblings' `reserved_count` forever (the
        // root eventually got swept to 'unknown' by releaseAbandonedReservations()
        // once its lease expired, but 'queued' siblings with no lease never get
        // swept). Release both on ANY send failure, not just the terminal-403 case,
        // before re-throwing so the caller still sees/handles the real error.
        log(`Reserved-group send failed for source=${flags["source"]} (${(err as Error).message ?? "unknown error"}) — releasing reservation before re-throw.`);
        releaseSingleReservation(engineDb, engineRow.id, `send failure: ${((err as Error).message ?? "unknown").slice(0, 300)}`);
        if (engineRow.atomic_group_id) {
          const released = releaseGroupRemainder(
            engineDb, engineRow.atomic_group_id,
            `send failure on source_key=${flags["source"]}`
          );
          log(`Released own row + ${released.length} remaining queued row(s) in atomic_group_id=${engineRow.atomic_group_id}`);
        }
        throw err;
      }
      const groupData = groupResult["data"] as Record<string, string> | undefined;
      if (groupData) {
        engineMarkSent(engineDb, engineRow.id, groupData["id"], engineRow.lane as EngineLane, engineRow.budget_day);
        // Pay-per-use accounting: log the dollar cost + link-post count. Reserved
        // groups are NOT cap-blocked (already atomically admitted) but ARE metered.
        await recordWriteSpend(hasLink);
        console.log(JSON.stringify({ id: groupData["id"], text: groupData["text"] }, null, 2));
        log(`Tweet posted (reserved-group): ${groupData["id"]}`);
      } else {
        console.log(JSON.stringify(groupResult, null, 2));
      }
      return; // done — never falls through to the legacy guard stack below
    }
  }

  // dev-council/Fowler+Hohpe(C3)+Lamport(F4)+Newman(#2), CONFIRMED HIGH — all four lenses
  // independently found the same real gap: content-calendar's reserve-group call lives in
  // an LLM-executed task-description STRING (state-machine.ts), not enforced code like
  // daily-read's. If the dispatch-turn LLM composes M tweets but reserves a DIFFERENT
  // source-key list (a typo, a miscounted thread, a skipped reserve-group step entirely),
  // any `--source` with no matching `outbound_action` row would — before this fix —
  // silently fall through to the UNCHANGED legacy guard stack below, which enforces only
  // the OLD `lane='post'` cap/reservation, completely bypassing the new lane's quota,
  // its window, and (structurally, since it never reserved) any per-group atomicity. A
  // desync between "what was reserved" and "what gets posted" would escape this quest's
  // entire safety mechanism without a single error — the silent-bypass class this quest
  // exists to kill, reintroduced at exactly the one seam that's still prose instead of code.
  //
  // Fix: fail CLOSED, not open. Any `--source` matching a MANAGED lane's key convention
  // (content-calendar:*, daily-read:*) that reaches this point (no matching
  // `outbound_action` row at all) is refused with a loud, actionable error instead of
  // silently posting via the ungated legacy path. This does not affect the reply lane, the
  // cadence beat, or any other legacy `--source` shape — only the two lanes this phase
  // gave a reservation requirement to.
  // Widened 2026-07-07 (task #21524): quest:gtm: (whop-sales GTM acquisition) and
  // sensor:x-cadence: (this skill's own cadence beat) migrated onto reserve-group —
  // the last two legacy cmdPost callers. Same fail-closed principle as content-calendar/
  // daily-read: no silent fallthrough for ANY known managed-lane source shape.
  // Widened again 2026-07-07 (task #21584): publish-fanout: (blog→X hop,
  // PublishFanoutMachine's blog_published/x_pending states) was the LAST unmigrated
  // legacy cmdPost caller — now reserves via reserve-group before posting, same as
  // every other managed lane.
  const MANAGED_LANE_SOURCE_PREFIX = /^(content-calendar|daily-read|quest:gtm|sensor:x-cadence|publish-fanout):/;
  if (flags["source"] && MANAGED_LANE_SOURCE_PREFIX.test(flags["source"])) {
    log(`REFUSING legacy fallthrough: source=${flags["source"]} matches a managed-lane prefix but has no reserve-group admission (outbound_action row) — this lane MUST reserve before posting. Not falling through to the ungated legacy path.`);
    console.log(JSON.stringify({
      halted: true, reason: "reservation_required", source: flags["source"],
      detail: "This source's lane requires a prior 'reserve-group' admission (see cli.ts's fast path). No matching outbound_action row was found — refusing to post via the legacy guard stack to avoid silently bypassing this lane's quota/window.",
    }));
    process.exit(1);
  }

  // ARCHITECT DECISION (task #21658, closing the #21656 audit's open question): the
  // legacy guard stack below is NOT dead code and must not be deleted. All 5 managed
  // sensor/workflow lanes now fail closed above, but genuinely ad-hoc/manual posts —
  // AGENT.md's own canonical worked example composes a thread with NO --source at all —
  // still take this exact path, and it's the ONLY thing enforcing kill-switch,
  // DAILY_TWEET_CAP, the daily-read reservation, and the root-post budget for that
  // traffic. An unrecognized/absent --source failing closed here (matching the managed
  // lanes' posture) would block legitimate manual composition with no reservation
  // mechanism offered in its place. Keep this branch as the deliberate manual-post lane.

  // ── Legacy path (unmigrated lanes — P3 territory) — UNCHANGED guard stack ──────
  // Local ledger short-circuit BEFORE credits/budget/API — the operative
  // exactly-once guarantee for sequential re-runs (see xPostLog note).
  if (await dedupSkip(flags["source"])) return;
  await checkCreditsDepleted();

  // P2 arc-funnel-hardening: kill switch + total-tweet daily cap — both apply to ALL
  // tweet types (root + continuation + CTA). One shared db handle: xPostLog() already
  // runs initDatabase()/getDatabase() and ensures the x_post_log table exists.
  {
    const guardDb = await xPostLog();

    // Kill switch: the social-engine reply lane enforces this via admission.ts; the
    // direct post lane was missing it.
    const ksRow = guardDb.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
    if (ksRow?.value === "false") {
      log("kill switch active (outbound_enabled=false) — halting post (root or continuation)");
      console.log(JSON.stringify({ halted: true, reason: "kill_switch", outbound_enabled: "false" }));
      return;
    }

    // Total-tweet daily cap. Panel target (arc-strategy-panel 2026-06-27): 6 tweets/day.
    // Primary enforcer; BUDGET_LIMITS.posts=3 is a secondary root-only guard.
    //
    // P2 arc-posting-scheduler arbiter fix (dev-council/Hohpe+Kleppmann+Lamport,
    // CONFIRMED — most severe P0 finding): this used to be a fresh
    // `SELECT COUNT(*) FROM x_post_log`, a SECOND independently-updated counter of
    // "budget left today" alongside budget_ledger.reserved_count — no stated winner
    // between them. Reading budget_ledger's aggregate here instead makes it the SINGLE
    // counter both this reservation guard and admitGroup()'s headroom check read.
    // Sound from day one (not just once P3 migrates lanes onto reserve-group) because
    // every legacy successful send below (search "legacy budget_ledger dual-write")
    // ALSO increments budget_ledger, so this aggregate reflects ALL of today's tweets —
    // legacy-path and reserve-group-path alike — not just migrated-lane traffic.
    //
    // dev-council/Hohpe (CONFIRMED, HIGH — P2 implementation review): the design spec's
    // own text said "summed across lanes," but a literal cross-lane SUM would silently
    // pull the REPLY lane's budget_ledger row into this count. Replies write budget_ledger
    // via admitAction() but never wrote x_post_log (see the dedupSkip note above) —
    // this guard and DAILY_TWEET_CAP have NEVER counted replies (cli.ts's own P1
    // comment: "Mention replies do NOT go through this guard... they cannot consume
    // this reservation"). P2 scoped this to `lane='post'` only, and explicitly carried
    // forward the decision of whether P3's new lane VALUES should be included.
    //
    // P3 decision (dev-council/Lamport F3 + Newman #1, CONFIRMED HIGH — this WAS the
    // carried-forward gap, and leaving it unresolved was a real bug): once daily-read/
    // content-calendar got their OWN budget_ledger rows, scoping this arbiter to
    // `lane='post'` ALONE means it is BLIND to their reservations — the legacy guard
    // stack (this code) and admitGroup()'s cross-lane backstop (admission.ts) became TWO
    // independent counters instead of one, each capped at DAILY_TWEET_CAP=6, so the
    // system's real worst-case daily volume silently became up to ~2x the intended
    // envelope (exactly what CHECKPOINTS.md #2 says must not happen). Fix: widen the
    // scope to `lane != 'reply'` — every tweet-producing lane except the (deliberately,
    // pre-existing) reply exclusion — the SAME scope admitGroup()'s own cross-lane
    // backstop now uses (admission.ts, "P3 arc-posting-scheduler: cross-lane global
    // backstop"). This is the SAME derived-SUM principle applied on both sides of the
    // choke point, so a caller on EITHER path sees the SAME true cross-lane total.
    const todayCount = (guardDb.query(
      "SELECT COALESCE(SUM(reserved_count),0) as total_count FROM budget_ledger WHERE channel='x' AND utc_day=date('now') AND lane != 'reply'"
    ).get() as { total_count: number } | null)?.total_count ?? 0;

    // P1 daily-read reservation RETIRED 2026-07-08 (arc-posting-scheduler CHECKPOINTS.md #5):
    // the bar was ">=2 distinct clean-window daily-read 'sent' days post-fix, no out-of-window
    // rows" — met 2026-07-07 (13:23-13:26Z) + 2026-07-08 (13:02-13:06Z). Daily-read's window
    // priority is now enforced by reserve-group admission (admission.ts lane windows) and every
    // managed lane fail-closes above (MANAGED_LANE_SOURCE_PREFIX refusal), so this legacy-path
    // reservation guarded only unmanaged legacy sources against a lane that no longer posts
    // through this path. Restore point: cli.ts.bak-20260708-p1retire.

    if (todayCount >= DAILY_TWEET_CAP) {
      log(`daily tweet cap exhausted (${todayCount}/${DAILY_TWEET_CAP} total tweets today) — deferring`);
      console.log(JSON.stringify({
        deferred: true,
        reason: "daily_tweet_cap_exhausted",
        detail: `${todayCount}/${DAILY_TWEET_CAP} total tweets today (cap covers root + continuation + CTA)`,
        planned_for: "tomorrow",
      }));
      process.exit(2);
    }
  }

  // M0-P0a: thread continuations (--reply-to set) are NOT root tweets and must NOT
  // burn the 3/day secondary root budget. Primary cap (DAILY_TWEET_CAP) covers all types.
  const isContinuation = !!flags["reply-to"];

  if (!isContinuation) {
    // Root post — check + reserve the 3/day budget.
    // budget_exhausted → exit 2 (deferred, not failed): dispatch must NOT mark
    // status=failed on a budget-over condition; exit 2 signals deferrable.
    try {
      await checkBudget("posts");
      // Link posts are the dominant cost line — soft-cap them on root posts.
      // A capped link post defers (exit 2) the same way an exhausted post budget
      // does. Only root posts are gated; thread CTAs are never blocked mid-chain.
      if (hasLink) await checkLinkPostBudget();
    } catch (e: unknown) {
      if (e instanceof BudgetExhaustedError) {
        const sourceKey = flags["source"] ?? `budget-defer:${createHash("sha256").update(text).digest("hex").slice(0, 12)}:${todayDateStr()}`;
        const errorMessage = e.message;
        log(`root post budget exhausted — writing planned_posts deferred row, exiting 2 (deferred, not failed): ${errorMessage}`);
        // Write a deferred planned_posts row so the post re-queues for tomorrow.
        try {
          const { initDatabase, getDatabase } = await import("../../src/db.ts");
          initDatabase();
          const db = getDatabase();
          db.run(
            `INSERT OR IGNORE INTO planned_posts
               (source_key, lane, is_root, scheduled_utc_day, defer_count, status, notes, created_at, updated_at)
             VALUES (?, 'post', 1, date('now','+1 day'), 0, 'deferred', 'budget-exhausted auto-defer', strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
            [sourceKey]
          );
        } catch (dbErr) {
          // Best-effort — do not block exit on DB write failure
          log(`planned_posts deferred insert failed (non-fatal): ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
        console.log(JSON.stringify({ deferred: true, reason: "root_post_budget_exhausted", detail: errorMessage, planned_for: "tomorrow" }));
        process.exit(2);
      }
      throw e;
    }
  }

  const creds = await loadCreds();
  const body: Record<string, unknown> = { text: unescapedText };

  // Support reply / thread continuation
  if (flags["reply-to"]) {
    body["reply"] = { in_reply_to_tweet_id: flags["reply-to"] };
  }
  // arc-day-n-publishing P4: event-driven quote-tweet support (see the reserved-group fast
  // path above for the full rationale — same X API field, same guard-stack inheritance).
  if (flags["quote-tweet-id"]) {
    body["quote_tweet_id"] = flags["quote-tweet-id"];
  }

  await enforceInterSendSpacing(`legacy ${flags["source"] ?? "?"}`);
  log(`Posting tweet (${text.length} chars, ${isContinuation ? "continuation" : flags["quote-tweet-id"] ? "quote" : "root"})...`);
  // ANTI-LOCK 403 BACKOFF (2026-07-01): a 403 on a write — especially a self-reply continuation — is a
  // transient reply-restriction / rate-cooldown signal, NOT a permanent failure. RETRYING it is what
  // turned a short cooldown into a multi-hour @arc0btc lock (self-reply 403 cascade, tasks
  // #20368->20374->20375, 2026-06-30). Treat any 403 as a terminal SKIP (exit 3, non-error) so the
  // dispatching agent does not re-attempt; --source dedup + cooldown handle the rest. This is the real
  // fix and supersedes the blanket X_THREAD_CHAINING_ENABLED pause — chaining is safe (daily-read chains
  // daily); retry-hammering a 403 was not. Root cause confirmed via X API docs: 403 "not mentioned by
  // author" on a self-reply = reply-restriction/cooldown, not the whop link (whop is not ToS-blocked).
  let result: Awaited<ReturnType<typeof apiRequest>>;
  try {
    result = await apiRequest("POST", "/tweets", creds, body);
  } catch (err) {
    if ((err as { status?: number })?.status === 403) {
      log(`X 403 on ${isContinuation ? "self-reply" : "root"} — backing off, NO retry (cooldown/reply-restriction).`);
      console.log(JSON.stringify({
        skipped: true,
        reason: "x_403_backoff",
        retry: false,
        continuation: isContinuation,
        detail: ((err as Error).message ?? "403 Forbidden").slice(0, 300),
      }));
      process.exit(3);
    }
    throw err;
  }
  const data = result["data"] as Record<string, string> | undefined;
  if (data) {
    // Only root posts burn the 3/day secondary root budget counter (primary is DAILY_TWEET_CAP=6).
    if (!isContinuation) await incrementBudget("posts");
    // Pay-per-use accounting: log this send's dollar cost + link-post count (task #21463).
    await recordWriteSpend(hasLink);
    if (flags["source"]) await recordPost(flags["source"], data["id"], !isContinuation);
    // P2 arc-posting-scheduler: legacy budget_ledger dual-write. This lane hasn't
    // migrated onto reserve-group yet (P3), but the arbiter fix above (guard #3's
    // todayCount) now reads budget_ledger as the single counter of truth — so every
    // legacy send must ALSO feed it, or budget_ledger would undercount real traffic
    // and the reservation guard would under-protect daily-read. reserved_count and
    // sent_count both bump together here because for a legacy send, admission and
    // send are the same moment (unlike admitGroup's separate reserve-then-drain).
    {
      const guardDb = await xPostLog();
      guardDb.run(
        `INSERT OR IGNORE INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
         VALUES ('x', date('now'), 'post', 0, 0, ?)`,
        [DAILY_TWEET_CAP]
      );
      // dev-council/Lamport (CONFIRMED): unlike admitGroup's doubly-bound CAS, this
      // legacy write previously had no headroom guard at all — bound it the same way
      // admitAction's own single-row CAS does (`reserved_count < cap`), for defense in
      // depth. This does not fully close the check-then-act race between the
      // DAILY_TWEET_CAP check earlier in this function and this UPDATE — that residual
      // window matches this codebase's existing accepted-risk posture elsewhere (e.g.
      // dedupSkip's own documented "concurrent same-source posts... unreachable under
      // single-threaded per-agent dispatch") — but it stops this counter from being
      // driven silently past cap even under an ordinary code-path mistake.
      guardDb.run(
        `UPDATE budget_ledger SET reserved_count=reserved_count+1, sent_count=sent_count+1
         WHERE channel='x' AND utc_day=date('now') AND lane='post' AND reserved_count < cap`
      );
    }
    console.log(JSON.stringify({ id: data["id"], text: data["text"] }, null, 2));
    log(`Tweet posted: ${data["id"]}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ---- reserve-group (P2 arc-posting-scheduler) ----
//
// Atomic whole-action admission: reserves budget for an entire thread+CTA (M tweets,
// M<=5 per CHECKPOINTS.md #2) in ONE transaction — either all M source keys get a
// 'queued' outbound_action row sharing one atomic_group_id, or the whole group defers
// (zero rows admitted). Callers (P3: ContentCalendarMachine's x_thread hop,
// arc-daily-read's composer) compute the full ordered list of source keys up front
// (the deterministic suffix convention already in use: `<slug>:x`, `<slug>:x:reply-2`,
// `<slug>:x:reply-3`, `<slug>:x-cta`) and call this ONCE before posting the first tweet.
// Each subsequent `post --source <one of those keys>` call then drains one row (see
// cmdPost's pre-admitted-group fast path above).
//
// Known simplification (disclosed): payload_ref/payload_hash here are derived from the
// source key alone, not the actual tweet text (which isn't decided until the calling
// LLM composes it turn-by-turn in today's architecture) — payload_hash's role at this
// pre-admission step is dedup-shape only, matching how existing rows already use it
// loosely, not a content-integrity guarantee.
async function cmdReserveGroup(flags: Record<string, string>): Promise<void> {
  const sourcesFlag = flags["sources"];
  if (!sourcesFlag) {
    console.log("Usage: reserve-group --sources <comma-separated source keys, root first> --thread-ref <key> [--lane post] [--earliest-time HH:MM] [--latest-time HH:MM] [--budget-day YYYY-MM-DD]");
    process.exit(1);
  }
  const sourceKeys = sourcesFlag.split(",").map((s) => s.trim()).filter(Boolean);
  const threadRef = flags["thread-ref"] ?? sourceKeys[0];
  // Soak-day-1 regression (2026-07-06T01:02Z, task 21164): a pre-P3 task-description
  // string reached this command WITHOUT --lane, the `?? "post"` default admitted a
  // content-calendar thread into the windowless legacy lane, and 4 real tweets went out
  // at 01:02 UTC. cmdPost's fail-closed prefix guard can't catch this — the group HAD a
  // reservation, just in the wrong lane. Same principle as that guard: the lane a managed
  // source key belongs to is a fact of the KEY, not a caller opinion. Derive lane + the
  // lane's canonical window (CHECKPOINTS.md #1) from the source-key prefix; refuse mixed
  // prefixes; log when a caller's explicit flags were overridden. Unmanaged keys keep
  // caller-supplied lane/window semantics unchanged (reply lane, cadence beat).
  // Prefix → lane derivation table. The MATCH KEY (source-key prefix, minus its
  // trailing ":") is distinct from the LANE VALUE stored in budget_ledger/outbound_action
  // — quest:gtm:* and sensor:x-cadence:* have multi-segment prefixes but map to single-
  // token lane names (task #21524, migrating whop-sales GTM + x-cadence off legacy cmdPost).
  // earliest/latest are optional: quest-gtm, x-cadence, and publish-fanout have no fixed
  // posting window (unlike content-calendar/daily-read) — undefined means anytime, same
  // as legacy behavior.
  const MANAGED_LANES: Array<{ prefix: string; lane: string; earliest?: string; latest?: string }> = [
    { prefix: "content-calendar", lane: "content-calendar", earliest: "15:00", latest: "18:00" },
    { prefix: "daily-read", lane: "daily-read", earliest: "13:00", latest: "14:00" },
    { prefix: "quest:gtm", lane: "quest-gtm" },
    { prefix: "sensor:x-cadence", lane: "x-cadence" },
    // task #21584: blog→X hop (PublishFanoutMachine) — fires at most once per blog
    // publish, no fixed time-of-day window.
    { prefix: "publish-fanout", lane: "publish-fanout" },
  ];
  const matchedEntries = new Set(
    sourceKeys.map((s) => MANAGED_LANES.find((m) => s.startsWith(`${m.prefix}:`)) ?? null),
  );
  const managedMatches = [...matchedEntries].filter((m): m is (typeof MANAGED_LANES)[number] => m !== null);
  const distinctLanes = new Set(managedMatches.map((m) => m.lane));
  if (matchedEntries.size > 1 && managedMatches.length > 0) {
    // Either a mix of managed + unmanaged keys, or keys spanning >1 managed lane —
    // both are refused: one atomic group belongs to exactly one lane.
    const seen = managedMatches.length === matchedEntries.size ? [...distinctLanes] : [...distinctLanes, "unmanaged"];
    console.log(JSON.stringify({
      error: true, reason: "mixed_lane_group",
      detail: `reserve-group refuses a group spanning lanes (${seen.join(", ")}) — one atomic group belongs to exactly one lane. Split the reservation per lane.`,
    }));
    process.exit(1);
  }
  const derivedEntry = managedMatches[0];
  let lane = (flags["lane"] ?? "post") as EngineLane;
  // P3 arc-posting-scheduler: per-lane window (HH:MM UTC, both optional — NULL/NULL means
  // anytime, unchanged for the reply lane and any caller that doesn't pass these).
  let earliestUtcTime: string | undefined = flags["earliest-time"];
  let latestUtcTime: string | undefined = flags["latest-time"];
  if (derivedEntry) {
    if (flags["lane"] && flags["lane"] !== derivedEntry.lane) {
      log(`reserve-group: OVERRIDING caller lane=${flags["lane"]} → ${derivedEntry.lane} (lane is derived from the managed source-key prefix, not caller flags — see 2026-07-06 lane-bypass regression)`);
    }
    if ((earliestUtcTime && earliestUtcTime !== derivedEntry.earliest) || (latestUtcTime && latestUtcTime !== derivedEntry.latest)) {
      log(`reserve-group: OVERRIDING caller window ${earliestUtcTime ?? "?"}-${latestUtcTime ?? "?"} → ${derivedEntry.earliest ?? "anytime"}-${derivedEntry.latest ?? "anytime"} (canonical window for lane=${derivedEntry.lane}, CHECKPOINTS.md #1)`);
    }
    lane = derivedEntry.lane as EngineLane;
    earliestUtcTime = derivedEntry.earliest;
    latestUtcTime = derivedEntry.latest;
  }

  const payloadRefs = sourceKeys.map((s) => `reserve-${createHash("sha256").update(s).digest("hex").slice(0, 12)}`);
  const payloadHashes = sourceKeys.map((s) => createHash("sha256").update(s).digest("hex"));
  const isRootFlags = sourceKeys.map((_, i) => i === 0);

  const db = await xPostLog();
  // dev-council/Fowler (CONFIRMED — a comment is not an access control): --budget-day is
  // a TEST-ONLY override (disposable-date dry runs against a real DB without touching
  // today's real production counters). Originally guarded only by a code comment saying
  // "real callers never pass it" — but nothing stopped a future task-description string,
  // a copy-pasted command, or an LLM "let me try a clean day" improvisation from actually
  // passing it in production and reserving into a phantom budget day, invisibly stepping
  // around every real counter. Gate it behind an explicit env var so production is
  // PHYSICALLY incapable of using it without a deliberate operator opt-in.
  if (flags["budget-day"] && Bun.env.ARC_ALLOW_BUDGET_DAY_OVERRIDE !== "true") {
    console.log(JSON.stringify({
      error: true, reason: "budget_day_override_not_allowed",
      detail: "--budget-day requires ARC_ALLOW_BUDGET_DAY_OVERRIDE=true (test/dry-run use only — never set in production).",
    }));
    process.exit(1);
  }
  const budgetDay = flags["budget-day"] ?? todayDateStr();

  // dev-council/Lamport (CONFIRMED gap): releaseAbandonedReservations() had ZERO
  // callers anywhere — dead code, so a crashed/abandoned reservation would leak until
  // the next UTC-midnight day rollover (self-healing only because budget_ledger keys
  // on utc_day, but still a real same-day starvation risk this quest exists to kill).
  // reserve-group is the natural self-healing hook: sweep stale reservations before
  // checking headroom for a NEW one, so the sweep actually runs in practice.
  try {
    const released = releaseAbandonedReservations(db, { leaseGraceMinutes: 0 });
    if (released.length > 0) {
      log(`reserve-group: swept ${released.length} abandoned reservation(s) before admitting (releaseAbandonedReservations)`);
    }
  } catch (error) {
    log(`reserve-group: releaseAbandonedReservations sweep failed (non-fatal, continuing): ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = admitGroup(db, {
    sourceKeys, lane, threadRef, budgetDay, cap: DAILY_TWEET_CAP,
    payloadRefs, payloadHashes, isRootFlags,
    earliestUtcTime, latestUtcTime,
    // P3: DAILY_TWEET_CAP doubles as the cross-lane global backstop — same value, same
    // constant, so raising the lane's own cap can never widen the absolute daily ceiling.
    globalCap: DAILY_TWEET_CAP,
  });

  if (result.ok) {
    log(`reserve-group admitted M=${sourceKeys.length} atomic_group_id=${result.atomicGroupId}`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } else {
    log(`reserve-group deferred (reason=${result.reason}): ${result.detail}`);
    console.log(JSON.stringify({ deferred: true, ...result }, null, 2));
    process.exit(2);
  }
}

// DEPRECATED: reply command (2026-06-20 reply-lane consolidation; formally deprecated 2026-06-24).
//
// The reply command is now a passthrough to the unified social-engine reply sender.
// This command is DEPRECATED. All new reply workflows MUST route through social-engine directly
// (skills/social-engine/reply-send.ts). The passthrough path exists only for backwards compatibility.
//
// Historical context:
// - Before 2026-06-20: direct POST /tweets with weak dedup (—source string only, no thread dedup,
//   ignored outbound_enabled, no per-thread cap) — this bypass caused the duplicate-reply incident.
// - 2026-06-20: consolidated to delegate through social-engine, which enforces source_key UNIQUE dedup
//   (≤1 reply/thread/day), outbound_enabled kill switch, in-txn budget_ledger debit.
// - 2026-06-24: formally deprecated; callers should migrate to social-engine/reply-send.ts directly.
//
// Exit codes:
// - 0: success (sent or already_exists)
// - 3: skipped or blocked (non-error terminal state)
// - 1: error
async function cmdReply(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  const tweetId = flags["tweet-id"];
  if (!text || !tweetId) {
    console.log("Usage: reply --text <reply text> --tweet-id <id> [--x-lead-id <author_id>]");
    process.exit(1);
  }

  log(`[DEPRECATED] reply command delegating to social-engine reply sender (thread ${tweetId})...`);
  console.error("[DEPRECATED] social-x-posting -- reply is a passthrough to social-engine and will be removed in a future release.");
  console.error("[DEPRECATED] New code should call social-engine/reply-send.ts directly (skills/social-engine/reply-send.ts).");

  const { sendReply } = await import("../social-engine/reply-send.ts");
  const replyResult = await sendReply({
    threadRef: tweetId,
    text,
    xLeadId: flags["x-lead-id"],
    accountHandle: flags["account"],
  });
  console.log(JSON.stringify(replyResult, null, 2));
  if (replyResult.outcome === "sent" || replyResult.outcome === "already_exists") {
    process.exit(0);
  }
  // skipped / blocked outcomes are non-error terminal states (no slot burn beyond
  // what the unified sender records); exit non-zero so the dispatch task surfaces it.
  process.exit(replyResult.outcome === "skipped" || replyResult.outcome === "blocked" ? 3 : 1);
}

async function cmdDelete(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: delete --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  log(`Deleting tweet ${tweetId}...`);
  const result = await apiRequest("DELETE", `/tweets/${tweetId}`, creds);
  console.log(JSON.stringify(result, null, 2));
  log(`Tweet deleted: ${tweetId}`);
}

async function cmdTimeline(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // First get our user ID
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id,username,name,public_metrics",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`User ID: ${userId}, fetching timeline...`);

  const timeline = await apiRequest("GET", `/users/${userId}/tweets`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,public_metrics,conversation_id",
  });

  const tweets = timeline["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent tweets found.");
    return;
  }

  for (const tweet of tweets) {
    const metrics = tweet["public_metrics"] as Record<string, number> | undefined;
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`Text: ${tweet["text"]}`);
    if (metrics) {
      console.log(
        `Engagement: ${metrics["like_count"]} likes, ${metrics["retweet_count"]} RTs, ${metrics["reply_count"]} replies`
      );
    }
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} tweets.`);
}

async function cmdMentions(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // Get user ID first
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`Fetching mentions for user ${userId}...`);

  const mentions = await apiRequest("GET", `/users/${userId}/mentions`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,author_id,public_metrics",
  });

  const tweets = mentions["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent mentions found.");
    return;
  }

  for (const tweet of tweets) {
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`From: ${tweet["author_id"]}`);
    console.log(`Text: ${tweet["text"]}`);
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} mentions.`);
}

async function cmdStatus(_flags: Record<string, string>): Promise<void> {
  try {
    const creds = await loadCreds();
    log("Checking X API access...");
    const me = await apiRequest("GET", "/users/me", creds, undefined, {
      "user.fields": "id,username,name,public_metrics,created_at,description",
    });
    const userData = me["data"] as Record<string, unknown> | undefined;
    if (userData) {
      const metrics = userData["public_metrics"] as Record<string, number> | undefined;
      console.log(JSON.stringify({
        status: "connected",
        id: userData["id"],
        username: userData["username"],
        name: userData["name"],
        description: userData["description"],
        created_at: userData["created_at"],
        followers: metrics?.["followers_count"],
        following: metrics?.["following_count"],
        tweets: metrics?.["tweet_count"],
      }, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ status: "error", message }, null, 2));
  }
}

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const query = flags["query"];
  if (!query) {
    console.log("Usage: search --query <text> [--limit <n>]");
    process.exit(1);
  }

  const limit = flags["limit"] ?? "10";
  const maxResults = Math.min(Math.max(parseInt(limit, 10) || 10, 10), 100);

  const creds = await loadCreds();
  log(`Searching tweets: "${query}" (limit: ${maxResults})...`);

  const result = await apiRequest("GET", "/tweets/search/recent", creds, undefined, {
    query,
    max_results: maxResults.toString(),
    "tweet.fields": "created_at,author_id,public_metrics,conversation_id",
  });

  const tweets = result["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No tweets found.");
    return;
  }

  // Cache results
  const cache = await loadCache();
  const now = new Date().toISOString();
  let newCount = 0;
  for (const tweet of tweets) {
    const id = tweet["id"] as string;
    if (!cache.tweets[id]) {
      newCount++;
    }
    cache.tweets[id] = { id, type: "tweet", fetched_at: now, data: tweet };
  }
  await saveCache(cache);

  for (const tweet of tweets) {
    const metrics = tweet["public_metrics"] as Record<string, number> | undefined;
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`Author: ${tweet["author_id"]}`);
    console.log(`Text: ${tweet["text"]}`);
    if (metrics) {
      console.log(
        `Engagement: ${metrics["like_count"]} likes, ${metrics["retweet_count"]} RTs, ${metrics["reply_count"]} replies`
      );
    }
  }
  console.log(`---`);
  console.log(`Found ${tweets.length} tweets (${newCount} new, cached to db/x-cache.json).`);
}

async function cmdLookup(flags: Record<string, string>): Promise<void> {
  const username = flags["username"];
  if (!username) {
    console.log("Usage: lookup --username <handle>");
    process.exit(1);
  }

  // Strip leading @ if present
  const handle = username.replace(/^@/, "");

  const creds = await loadCreds();
  log(`Looking up user: @${handle}...`);

  const result = await apiRequest("GET", `/users/by/username/${handle}`, creds, undefined, {
    "user.fields": "id,username,name,description,public_metrics,created_at,location,url,verified",
  });

  const userData = result["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    console.log(`User @${handle} not found.`);
    return;
  }

  // Cache user
  const cache = await loadCache();
  const now = new Date().toISOString();
  const id = userData["id"] as string;
  cache.users[id] = { id, type: "user", fetched_at: now, data: userData };
  await saveCache(cache);

  const metrics = userData["public_metrics"] as Record<string, number> | undefined;
  console.log(JSON.stringify({
    id: userData["id"],
    username: userData["username"],
    name: userData["name"],
    description: userData["description"],
    location: userData["location"],
    url: userData["url"],
    created_at: userData["created_at"],
    verified: userData["verified"],
    followers: metrics?.["followers_count"],
    following: metrics?.["following_count"],
    tweets: metrics?.["tweet_count"],
    cached_at: now,
  }, null, 2));
}

async function getMyUserId(creds: OAuthCreds): Promise<string> {
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) throw new Error("Could not fetch user info");
  return userData["id"] as string;
}

async function cmdLike(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: like --tweet-id <id>");
    process.exit(1);
  }

  await checkBudget("likes");
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Liking tweet ${tweetId}...`);
  const result = await apiRequest("POST", `/users/${userId}/likes`, creds, { tweet_id: tweetId });
  await incrementBudget("likes");
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ liked: data?.["liked"] ?? true, tweet_id: tweetId }, null, 2));
  log(`Tweet liked: ${tweetId}`);
}

async function cmdUnlike(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: unlike --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Unliking tweet ${tweetId}...`);
  const result = await apiRequest("DELETE", `/users/${userId}/likes/${tweetId}`, creds);
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ liked: data?.["liked"] ?? false, tweet_id: tweetId }, null, 2));
  log(`Tweet unliked: ${tweetId}`);
}

async function cmdRetweet(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: retweet --tweet-id <id>");
    process.exit(1);
  }

  await checkBudget("retweets");
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Retweeting ${tweetId}...`);
  const result = await apiRequest("POST", `/users/${userId}/retweets`, creds, { tweet_id: tweetId });
  await incrementBudget("retweets");
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ retweeted: data?.["retweeted"] ?? true, tweet_id: tweetId }, null, 2));
  log(`Retweeted: ${tweetId}`);
}

async function cmdUnretweet(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: unretweet --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  const userId = await getMyUserId(creds);

  log(`Unretweeting ${tweetId}...`);
  const result = await apiRequest("DELETE", `/users/${userId}/retweets/${tweetId}`, creds);
  const data = result["data"] as Record<string, unknown> | undefined;
  console.log(JSON.stringify({ retweeted: data?.["retweeted"] ?? false, tweet_id: tweetId }, null, 2));
  log(`Unretweeted: ${tweetId}`);
}

// ---- Lists (arc-x-research-channel Phase 4, 2026-07-13) --------------------
// Private X List over the curated roster (social_accounts) — the chosen read
// mechanism (List-poll over Activity API push, decided in Phase 1's console
// reconciliation §2: cost is a wash, List-poll needs zero new standing
// infrastructure and fits this codebase's scheduled-poll-per-tick architecture
// everywhere else). These are WRITES (create the list, add a member) — same
// proven OAuth 1.0a `apiRequest` path every other write in this file uses, so
// they live here, not in the read-metered `lib/x-api.ts`. Pricing for List
// WRITES (create/add-member) is NOT on the public rate card and NOT confirmed
// this phase — disclosed, not invented (dev-council, Phase 4 verify artifact).

/** Create a private X List. One-time setup call (idempotency is the CALLER's
 * job — `skills/list-roster/sensor.ts` only calls this once, persisting the
 * returned id to `db/hook-state/list-roster-state.json` so it's never called
 * twice). Throws on failure — a failed list-create has no safe fallback for
 * the caller to paper over. */
export async function createXList(name: string, description: string): Promise<{ id: string; name: string }> {
  const creds = await loadCreds();
  const result = await apiRequest("POST", "/lists", creds, { name, description, private: true });
  const data = (result["data"] as Record<string, unknown> | undefined) ?? {};
  if (!data["id"]) {
    throw new Error(`createXList: no id in response — ${JSON.stringify(result)}`);
  }
  return { id: String(data["id"]), name: String(data["name"] ?? name) };
}

/** Add one member to an existing X List. Non-throwing (a batch caller syncing
 * ~138 roster accounts must keep going past one bad id) — mirrors cmdFollow's
 * catch shape. X returns 200 with `is_member: true` on both a fresh add AND a
 * repeat add (same idempotent shape as follow), so a re-run never double-errors.
 *
 * `alreadyMember` (despite the name — kept for API-compat with the first
 * version of this function) is the ACTUAL membership-confirmation signal
 * (`data.is_member === true`), NOT merely "the HTTP call returned 2xx."
 * dev-council (Lamport lens, 2026-07-13): the ORIGINAL callers gated their
 * `list_member_added_at` UPDATE on `result.ok` alone and never read this
 * field — i.e. the one signal that actually confirms membership was computed
 * and then discarded, so a 200-with-`is_member:false` response (e.g. a
 * pending/queued add X hasn't confirmed yet) would have been recorded as a
 * confirmed member. Both call sites (skills/list-roster/sensor.ts,
 * src/follow-policy.ts) now gate on `result.ok && result.alreadyMember`. */
export async function addListMember(listId: string, userId: string): Promise<{ ok: boolean; alreadyMember?: boolean; status?: number; error?: string }> {
  try {
    const result = await apiRequest("POST", `/lists/${listId}/members`, await loadCreds(), { user_id: userId });
    const data = (result["data"] as Record<string, unknown> | undefined) ?? {};
    return { ok: true, alreadyMember: data["is_member"] === true };
  } catch (err) {
    const e = err as Error & { status?: number };
    return { ok: false, status: e.status ?? null as unknown as number, error: e.message };
  }
}

/** Resolve a username to its numeric X user id via the METERED read path
 * (`lib/x-api.ts`'s `xApiGet`, NOT this file's own unmetered `apiRequest` —
 * Phase 1's console reconciliation confirmed user reads bill $0.010/resource,
 * a real cost every caller should show up in `db/x-read-budget.json`'s
 * `by_lane.users`). `cmdFollow` below still does its OWN unmetered lookup —
 * a pre-existing gap this function does NOT retroactively fix (out of this
 * phase's scope), it just avoids adding a NEW unmetered call site. Returns
 * `null` (never throws) on a not-found/failed lookup — a bad handle in a
 * batch sync shouldn't crash the whole run. */
export async function resolveUserId(username: string): Promise<string | null> {
  const xCreds = await loadMeteredXCreds();
  if (!xCreds) return null;
  try {
    const resp = await xApiGet(`/users/by/username/${username.replace(/^@/, "")}`, xCreds, { "user.fields": "id" }, { costUsd: 0.010, lane: "users" });
    const data = resp["data"] as Record<string, unknown> | undefined;
    return data?.["id"] ? String(data["id"]) : null;
  } catch (error) {
    log(`resolveUserId(${username}) failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function cmdListCreate(flags: Record<string, string>): Promise<void> {
  const name = flags["name"];
  const description = flags["description"] ?? "";
  if (!name) {
    console.log("Usage: list-create --name <name> [--description <desc>]");
    process.exit(1);
  }
  const result = await createXList(name, description);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

async function cmdListAddMember(flags: Record<string, string>): Promise<void> {
  const listId = flags["list-id"];
  const userId = flags["user-id"];
  if (!listId || !userId) {
    console.log("Usage: list-add-member --list-id <id> --user-id <id>");
    process.exit(1);
  }
  const result = await addListMember(listId, userId);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(3);
}

// ---- Follow (audience exposure + reply-permission) ----
// Mirrors cmdRetweet/cmdLike exactly: same apiRequest signed-POST path, same daily
// budget plumbing (the "follows" limit already existed in BUDGET_LIMITS). Reuses the
// proven OAuth 1.0a helper — no auth duplication. Accept either --username (resolves
// via /users/by/username) or --target-id (caller pre-resolved the id to save a read).
// Output is single-line JSON so a batch orchestrator can parse ok/already/error.
export interface FollowByIdResult {
  ok: boolean;
  following?: boolean;
  pendingFollow?: boolean;
  deferred?: boolean; // true = daily 20/day cap reached (normal, not a failure)
  status?: number | null;
  error?: string;
}

/**
 * Follow a pre-resolved user id, IN-PROCESS (no subprocess). Extracted from
 * `cmdFollow` (2026-07-13, arc-x-research-channel Phase 4, dev-council/Newman
 * lens — "highest-leverage change... one structural fix retires two
 * findings"): `src/follow-policy.ts` previously shelled out to
 * `bun cli.ts follow --target-id ...` and parsed the last stdout line as
 * JSON — but `checkBudget("follows")` throws BEFORE `cmdFollow`'s try/catch,
 * so a daily-cap hit propagated to the TOP-LEVEL `main().catch` (stderr-only,
 * `process.exit(1)`, no stdout JSON at all), making the caller's "budget
 * exhausted = deferred, not a failure" branch dead code (confirmed
 * independently by BOTH the Lamport and Newman lenses) — every over-cap
 * follow was silently misreported as a generic failure. This function
 * returns a STRUCTURED result instead of throwing/exiting, so a cap hit is a
 * plain `{ok: false, deferred: true}` value, not a parsed-stdout guess. Also
 * removes the per-follow subprocess boot (fresh Bun process + cold creds
 * reload + a fresh `getMyUserId` read, every single follow) `follow-policy.ts`
 * was paying for no reason — `addListMember`/`resolveUserId` were already
 * in-process; follow is now consistent with them.
 */
export async function followByTargetId(targetId: string): Promise<FollowByIdResult> {
  try {
    await checkBudget("follows");
  } catch (error) {
    return { ok: false, deferred: true, error: error instanceof Error ? error.message : String(error) };
  }
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);
  try {
    const result = await apiRequest("POST", `/users/${userId}/following`, creds, { target_user_id: targetId });
    await incrementBudget("follows");
    const data = (result["data"] as Record<string, unknown> | undefined) ?? {};
    return { ok: true, following: data["following"] === true, pendingFollow: data["pending_follow"] === true };
  } catch (err) {
    const e = err as Error & { status?: number };
    // Re-following an account you already follow returns 200 with following:true on X,
    // so a thrown error here is a real failure (429/restriction/etc).
    return { ok: false, status: e.status ?? null, error: e.message };
  }
}

// ---- Like, in-process (arc-x-research-channel Phase 7, 2026-07-13) ----------
// Extracted the same way followByTargetId was (2026-07-13, Phase 4): a structured
// result the caller can branch on (ok/deferred/error), no throw, no subprocess.
// cmdLike (above, ~line 1541) already does this write via apiRequest but as a
// standalone CLI command with no in-process caller — this is the first in-process
// caller (arc-link-research's cmdProcess, via a best-effort "like the source
// tweet" step alongside the existing follow-policy hook).
//
// Algo-shaping context (operator directive, 2026-07-13): a READ (personalized_trends,
// already consumed since Phase 3) reflects Arc's follow graph back — it doesn't
// feed X's own personalization of what Arc sees. A WRITE (follow/like) is the only
// plausible signal that shapes it going forward. Same documented-removed-but-
// empirically-live status as follow writes (2026-04-20 announcement removed
// follow/like/quote-post from all self-serve tiers; @arc0btc's follows kept
// working past that date per the 2026-07-13 console reconciliation doc) — treated
// identically here: live, unpriced in $ terms (goes through BUDGET_LIMITS.likes,
// a count cap, same precedent as follows — NOT threaded into x-read-budget.json,
// which is reads-only by design).
//
// dev-council 2026-07-13 (Phase 7, CONFIRMED independently by the Fowler and Hohpe
// lenses): the FIRST version of this function called the existing
// `enforceInterSendSpacing("like")` — but that function's clock is
// MAX(x_post_log.posted_at, x_reply_log.replied_at) (tweet/reply timing), a
// resource likes never write to. Spacing a like against that clock is both
// meaningless (a like never advances it, so the "spacing" measures unrelated
// tweet/reply activity) and expensive (up to 120s bounded sleep, called up to 5x
// per `process` run — up to ~10 minutes of serial blocking on the research
// pipeline for a cosmetic side effect that gate wasn't even protecting).
// enforceInterSendSpacing itself is ALSO not currently called by cmdLike or
// followByTargetId (it only guards the three POST /tweets call sites per its own
// header comment) — a pre-existing gap for follow, disclosed not fixed here.
// Fixed: likes get their OWN dedicated 45-90s clock (enforceLikeSpacing /
// recordLikeSpacing below, a tiny JSON state file — same atomic tmp+rename
// pattern as saveFollowerCache above), honoring the operator's explicit
// "respect the spacing rule" directive against a clock likes actually advance.
const LIKE_SPACING_MIN_SECONDS = 45;
const LIKE_SPACING_JITTER_SECONDS = 45; // effective gap 45-90s, matching enforceInterSendSpacing's own shape
const LIKE_SPACING_STATE_PATH = join(import.meta.dir, "..", "..", "db", "hook-state", "last-like-at.json");

async function enforceLikeSpacing(): Promise<void> {
  let lastAt: string | null = null;
  try {
    const f = Bun.file(LIKE_SPACING_STATE_PATH);
    if (await f.exists()) {
      const state = (await f.json()) as { lastLikeAt?: string };
      lastAt = state.lastLikeAt ?? null;
    }
  } catch {
    // missing/corrupt state = no prior recorded like — proceed immediately, don't block on a
    // bookkeeping read failure.
  }
  if (!lastAt) return;
  const elapsedMs = Date.now() - new Date(lastAt).getTime();
  const requiredMs = (LIKE_SPACING_MIN_SECONDS + Math.floor(Math.random() * LIKE_SPACING_JITTER_SECONDS)) * 1000;
  if (elapsedMs >= requiredMs) return;
  const waitMs = Math.min(requiredMs - elapsedMs, 120_000);
  await Bun.sleep(waitMs);
}

async function recordLikeSpacing(): Promise<void> {
  try {
    const { mkdirSync, renameSync } = await import("node:fs");
    const dir = join(import.meta.dir, "..", "..", "db", "hook-state");
    mkdirSync(dir, { recursive: true });
    const temporaryPath = LIKE_SPACING_STATE_PATH + ".tmp";
    await Bun.write(temporaryPath, JSON.stringify({ lastLikeAt: new Date().toISOString() }, null, 2) + "\n");
    renameSync(temporaryPath, LIKE_SPACING_STATE_PATH);
  } catch {
    // best-effort bookkeeping only — never block or fail the like itself over a write hiccup.
  }
}

export interface LikeByIdResult {
  ok: boolean;
  liked?: boolean;
  deferred?: boolean; // true = daily likes budget cap reached (normal, not a failure)
  status?: number | null;
  error?: string;
}

export async function likeByTargetId(tweetId: string): Promise<LikeByIdResult> {
  try {
    await checkBudget("likes");
  } catch (error) {
    return { ok: false, deferred: true, error: error instanceof Error ? error.message : String(error) };
  }
  await enforceLikeSpacing();
  const creds = await loadCreds();
  const userId = await getMyUserId(creds);
  try {
    const result = await apiRequest("POST", `/users/${userId}/likes`, creds, { tweet_id: tweetId });
    await incrementBudget("likes");
    await recordLikeSpacing();
    const data = (result["data"] as Record<string, unknown> | undefined) ?? {};
    return { ok: true, liked: data["liked"] !== false };
  } catch (err) {
    const e = err as Error & { status?: number };
    // Liking an already-liked tweet returns 200 with liked:true on X, so a thrown
    // error here is a real failure (429/restriction/etc), same reasoning as
    // followByTargetId's own catch above.
    return { ok: false, status: e.status ?? null, error: e.message };
  }
}

async function cmdFollow(flags: Record<string, string>): Promise<void> {
  const rawHandle = (flags["username"] ?? "").replace(/^@/, "");
  let targetId = flags["target-id"] ?? "";
  if (!targetId && !rawHandle) {
    console.log("Usage: follow (--username <handle> | --target-id <id>)");
    process.exit(1);
  }

  if (!targetId) {
    const creds = await loadCreds();
    const lk = await apiRequest("GET", `/users/by/username/${rawHandle}`, creds, undefined, { "user.fields": "id" });
    const u = lk["data"] as Record<string, unknown> | undefined;
    if (!u || !u["id"]) {
      console.log(JSON.stringify({ ok: false, error: "user_not_found", username: rawHandle }));
      process.exit(2);
    }
    targetId = String(u["id"]);
  }

  log(`Following ${rawHandle || targetId} (id=${targetId})...`);
  const result = await followByTargetId(targetId);
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, following: result.following, pending_follow: result.pendingFollow, target_id: targetId, username: rawHandle || null }));
  } else if (result.deferred) {
    console.log(JSON.stringify({ ok: false, deferred: true, error: result.error, target_id: targetId, username: rawHandle || null }));
    process.exit(4); // distinct exit code from a real failure (3) — CLI callers can distinguish "cap hit" from "broken"
  } else {
    console.log(JSON.stringify({ ok: false, status: result.status ?? null, error: result.error, target_id: targetId, username: rawHandle || null }));
    process.exit(3);
  }
}

// AI-054: course-candidacy assessment (arc-workflows/state-machine.ts) needs a read
// path over x_post_log/x_reply_log to check "did the CTA post at --source get
// replies" without raw SQL. Looks up the tweet posted under --source, then counts
// x_reply_log rows keyed to that tweet (replied_to_tweet_id) as the engagement signal.
async function cmdEngagementCount(flags: Record<string, string>): Promise<void> {
  const source = flags["source"];
  if (!source) {
    console.log("Usage: engagement-count --source <key>");
    process.exit(1);
  }

  const postDb = await xPostLog();
  const post = postDb.query(
    "SELECT tweet_id, posted_at FROM x_post_log WHERE source = ?",
  ).get(source) as { tweet_id: string | null; posted_at: string } | null;

  if (!post || !post.tweet_id) {
    console.log(JSON.stringify({ source, found: false, tweet_id: null, reply_count: 0, replies: [] }, null, 2));
    return;
  }

  const replyDb = await xReplyLog();
  const replies = replyDb.query(
    "SELECT reply_tweet_id, x_lead_author_id, replied_at FROM x_reply_log WHERE replied_to_tweet_id = ? ORDER BY replied_at ASC",
  ).all(post.tweet_id) as { reply_tweet_id: string | null; x_lead_author_id: string | null; replied_at: string }[];

  console.log(JSON.stringify({
    source,
    found: true,
    tweet_id: post.tweet_id,
    posted_at: post.posted_at,
    reply_count: replies.length,
    replies,
  }, null, 2));
}

async function cmdBudget(_flags: Record<string, string>): Promise<void> {
  const budget = await loadBudget();
  const guardDb = await xPostLog();
  const dailyTweetCapUsed = (guardDb.query(
    "SELECT COUNT(*) as total_count FROM x_post_log WHERE date(posted_at) = date('now')"
  ).get() as { total_count: number } | null)?.total_count ?? 0;
  console.log(JSON.stringify({
    date: budget.date,
    // Primary enforcer for ALL tweet types (root + continuation + CTA). The "posts" entry
    // below is a secondary root-only sub-budget within this shared cap — see DAILY_TWEET_CAP.
    daily_tweet_cap: { used: dailyTweetCapUsed, limit: DAILY_TWEET_CAP, remaining: DAILY_TWEET_CAP - dailyTweetCapUsed, covers: "root + continuation + CTA" },
    posts: { used: budget.posts, limit: BUDGET_LIMITS["posts"], remaining: BUDGET_LIMITS["posts"] - budget.posts, note: "root-only secondary sub-budget, see daily_tweet_cap for the real shared cap" },
    replies: { used: budget.replies, limit: BUDGET_LIMITS["replies"], remaining: BUDGET_LIMITS["replies"] - budget.replies },
    likes: { used: budget.likes, limit: BUDGET_LIMITS["likes"], remaining: BUDGET_LIMITS["likes"] - budget.likes },
    retweets: { used: budget.retweets, limit: BUDGET_LIMITS["retweets"], remaining: BUDGET_LIMITS["retweets"] - budget.retweets },
    follows: { used: budget.follows, limit: BUDGET_LIMITS["follows"], remaining: BUDGET_LIMITS["follows"] - budget.follows },
  }, null, 2));
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "post":
      await cmdPost(flags);
      break;
    case "reserve-group":
      await cmdReserveGroup(flags);
      break;
    case "reply":
      await cmdReply(flags);
      break;
    case "delete":
      await cmdDelete(flags);
      break;
    case "timeline":
      await cmdTimeline(flags);
      break;
    case "mentions":
      await cmdMentions(flags);
      break;
    case "search":
      await cmdSearch(flags);
      break;
    case "lookup":
      await cmdLookup(flags);
      break;
    case "like":
      await cmdLike(flags);
      break;
    case "unlike":
      await cmdUnlike(flags);
      break;
    case "retweet":
      await cmdRetweet(flags);
      break;
    case "unretweet":
      await cmdUnretweet(flags);
      break;
    case "follow":
      await cmdFollow(flags);
      break;
    case "list-create":
      await cmdListCreate(flags);
      break;
    case "list-add-member":
      await cmdListAddMember(flags);
      break;
    case "budget":
      await cmdBudget(flags);
      break;
    case "status":
      await cmdStatus(flags);
      break;
    case "engagement-count":
      await cmdEngagementCount(flags);
      break;
    default:
      console.log(`x-posting — Post and manage tweets via X API v2

Commands:
  post       --text <text> [--source <key>] [--reply-to <id>] [--quote-tweet-id <id>]
                                               Post a tweet (max 280 chars)
                                               (--source: a re-run with the same key is suppressed
                                                by the local x_post_log ledger — no double-post.
                                                If --source matches a reserve-group-admitted row,
                                                this drains it through the atomic queue instead of
                                                the legacy guard stack.
                                                --quote-tweet-id: arc-day-n-publishing P4 —
                                                event-driven quote-tweet. Posts as a NORMAL tweet
                                                with X's native quote-tweet attachment (NOT a
                                                reply) — counts against DAILY_TWEET_CAP like any
                                                other post, unlike the separately-budgeted reply
                                                lane. See skills/social-engine/quote-trigger-detect.ts
                                                for the trigger + receipt-attachment composition step.)
  reserve-group --sources <k1,k2,...> [--thread-ref <key>] [--lane post|reply|daily-read|content-calendar]
                [--earliest-time HH:MM] [--latest-time HH:MM]
             P2/P3 arc-posting-scheduler: atomically reserve a WHOLE thread+CTA (root first,
             <=5 tweets) as one unit — all-or-nothing, upfront, in its own lane's budget PLUS
             the cross-lane DAILY_TWEET_CAP backstop. --earliest-time/--latest-time (P3) set
             the UTC HH:MM window this group may drain within (omit = anytime). Follow with
             one 'post --source <ki>' call per key, in order, to drain the group — cmdPost
             enforces the window at drain time (window_not_open_yet defers without
             releasing; window_closed_no_post releases the whole remaining group, loud).
  reply      --text <text> --tweet-id <id> [--source <key>] [--x-lead-id <author_id>]
             Reply to a tweet. --source: idempotent re-run. --x-lead-id: log as give-3x value_touch for this X lead.
  delete     --tweet-id <id>                   Delete a tweet
  like       --tweet-id <id>                   Like a tweet
  unlike     --tweet-id <id>                   Unlike a tweet
  retweet    --tweet-id <id>                   Retweet a tweet
  unretweet  --tweet-id <id>                   Undo a retweet
  follow     --username <handle>|--target-id <id>  Follow an account (audience exposure)
  list-create --name <name> [--description <desc>] Create a private X List (arc-x-research-channel P4)
  list-add-member --list-id <id> --user-id <id>     Add a member to an X List
  timeline   [--limit <n>]                     Show recent tweets (default: 10)
  mentions   [--limit <n>]                     Show recent mentions (default: 10)
  search     --query <text> [--limit <n>]      Search recent tweets (10-100, default: 10)
  lookup     --username <handle>               Look up a user by username
  budget                                       Show daily action budget usage
  status                                       Check API access and account info
  engagement-count --source <key>              Count replies to the tweet posted under --source
                                                (joins x_post_log -> x_reply_log; found:false + 0
                                                if no post/no replies yet — AI-054 read path)

Daily budget limits (resets at midnight UTC):
  6 tweets/day shared cap (root + continuation + CTA), 3 root posts, 40 replies, 50 likes, 15 retweets, 20 follows

Credentials required (set via arc creds set --service x --key <key> --value <value>):
  x/consumer_key         OAuth 1.0a Consumer Key
  x/consumer_secret      OAuth 1.0a Consumer Secret
  x/access_token         User Access Token
  x/access_token_secret  User Access Token Secret

Get credentials from https://developer.x.com/`);
      break;
  }
}

// Only auto-run the CLI when this file is the entrypoint. When imported as a
// module (e.g. social-engine/reply-send.ts importing providerReplySend) the
// top-level main() must NOT execute. import.meta.main is true only for the
// process entry module under Bun.
if (import.meta.main) {
  main().catch((error) => {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
