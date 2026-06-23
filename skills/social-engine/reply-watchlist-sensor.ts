/**
 * skills/social-engine/reply-watchlist-sensor.ts
 *
 * P2 arc-reach-unblock (2026-06-23) — Autonomous reply-guy sensor.
 *
 * Prior version was SCAN-ONLY (no sends). This version:
 *   1. Discovers recent tweets from in-network (follow_state='following') watchlist accounts
 *      via X API searchRecentByHandle() — budget-gated, structured data, no shell-out.
 *   2. Prioritises recency: < 24h preferred, 24-48h acceptable; non-following excluded.
 *   3. Sends replies autonomously via sendReply() (canonical lane, all P4 guards intact).
 *   4. Tracks 403-reply-restriction failures per account: 2 consecutive skips = 7-day
 *      circuit-breaker (reply_locked_until). Count resets on lock expiry AND on success.
 *
 * Spam guards (DO NOT REGRESS — enforced by sendReply / admission.ts):
 *   GUARD 1: target-age fail-closed (tweetCreatedAt required, > 48h = blocked)
 *   GUARD 2: conversation burst atomic CAS (1 reply per conversation per 1440min window)
 *   Kill switch: outbound_enabled checked before send + re-checked inside sendReply
 *   account_id: required for reply lane (fail-closed)
 *   source_key UNIQUE: all-time per-thread dedup
 *
 * Discovery rate: max MAX_DISCOVERY_PER_RUN accounts per run (search quota protection).
 * At 2 runs/day this is ~20-30 search calls/day — safe on Basic plan (96 searches/day).
 *
 * Usage:
 *   bun skills/social-engine/reply-watchlist-sensor.ts [--dry-run]
 */

import { Database } from "bun:sqlite";
import { searchRecentByHandle, loadXCreds } from "../social-x-posting/lib/x-api.ts";
import { sendReply } from "./reply-send.ts";
import { getReplyDraft } from "./reply-copy-pool.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const DRY_RUN = process.argv.includes("--dry-run");

/** Max accounts to run tweet discovery on per sensor invocation (search quota guard). */
const MAX_DISCOVERY_PER_RUN = 10;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [reply-watchlist-sensor] ${msg}`);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function getConfigInt(db: Database, key: string, fallback: number): number {
  const row = db.query("SELECT value FROM agent_config WHERE key=?").get(key) as { value: string } | null;
  if (!row) return fallback;
  const n = parseInt(row.value, 10);
  return isNaN(n) ? fallback : n;
}

function getRemainingBudget(db: Database): number {
  const today = utcDay();
  const capRow = db.query("SELECT value FROM agent_config WHERE key='reply_daily_cap'").get() as { value: string } | null;
  const cap = capRow ? parseInt(capRow.value, 10) : 3;
  const ledger = db.query(
    "SELECT reserved_count FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='reply'"
  ).get(today) as { reserved_count: number } | null;
  const used = ledger?.reserved_count ?? 0;
  return Math.max(0, cap - used);
}

interface WatchlistAccount {
  id: number;
  handle: string;
  follow_state: string | null;
  follow_target_id: string | null;
  reach_fit_tier: string | null;
  target_last_tweet_id: string | null;
  target_last_tweet_at: string | null;
  consecutive_403_count: number;
  reply_locked_until: string | null;
}

interface DiscoveredTarget {
  account: WatchlistAccount;
  tweetId: string;
  tweetCreatedAt: string;
  ageMs: number;
}

async function run() {
  log(`Starting${DRY_RUN ? " (DRY-RUN)" : ""}`);

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  // ── Kill switch check ─────────────────────────────────────────────────────
  const ksRow = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
  if (ksRow?.value === "false") {
    log("Kill switch OFF — outbound_enabled=false. Exiting.");
    db.close();
    return;
  }

  const targetAgeHours = getConfigInt(db, "reply_target_age_hours", 48);
  const preferredAgeHours = getConfigInt(db, "reply_preferred_age_hours", 24);
  const cutoffMs = targetAgeHours * 3600 * 1000;
  const preferredMs = preferredAgeHours * 3600 * 1000;
  const now = Date.now();
  const nowIsoStr = new Date(now).toISOString();

  // ── Load X creds ──────────────────────────────────────────────────────────
  const creds = await loadXCreds();
  if (!creds) {
    log("X credentials not available — exiting.");
    db.close();
    return;
  }

  // ── Phase 1: Discovery — find eligible in-network accounts ───────────────
  // Only following accounts; skip if reply_locked_until is in the future.
  // ORDER BY COALESCE(target_last_tweet_at, '1970-01-01') ASC for rotation fairness.
  const accounts = db.query(`
    SELECT id, handle, follow_state, follow_target_id, reach_fit_tier,
           target_last_tweet_id, target_last_tweet_at,
           consecutive_403_count, reply_locked_until
    FROM social_accounts
    WHERE follow_state='following'
      AND targeting_status='eligible'
      AND (reply_locked_until IS NULL OR reply_locked_until < ?)
    ORDER BY COALESCE(target_last_tweet_at, '1970-01-01') ASC
    LIMIT ?
  `).all(nowIsoStr, MAX_DISCOVERY_PER_RUN) as WatchlistAccount[];

  log(`Discovery pass: ${accounts.length} eligible in-network accounts (max ${MAX_DISCOVERY_PER_RUN}/run)`);

  const discovered: DiscoveredTarget[] = [];
  let searchCount = 0;

  for (const account of accounts) {
    // Reset 403-lock if it was previously set and has now expired.
    // (SQL WHERE already excludes accounts with future locks, so any non-null
    // reply_locked_until here is guaranteed expired — no < nowIsoStr guard needed.)
    if (account.reply_locked_until) {
      db.run(
        "UPDATE social_accounts SET consecutive_403_count=0, reply_locked_until=NULL, reply_lock_reason=NULL, updated_at=? WHERE id=?",
        [nowIsoStr, account.id]
      );
      account.consecutive_403_count = 0;
      account.reply_locked_until = null;
      log(`@${account.handle}: lock expired — consecutive_403_count reset to 0`);
    }

    try {
      const result = await searchRecentByHandle(account.handle, creds, { maxResults: 10 });
      searchCount++;

      // Filter to tweets within the age window
      const eligible = result.tweets.filter(t => {
        if (!t.created_at) return false;
        const age = now - new Date(t.created_at).getTime();
        return age >= 0 && age <= cutoffMs;
      });

      if (eligible.length === 0) {
        log(`@${account.handle}: no tweets in window (${targetAgeHours}h)`);
        continue;
      }

      // Most recent eligible tweet
      const best = eligible.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      const ageMs = now - new Date(best.created_at).getTime();

      // Store back to DB
      db.run(
        "UPDATE social_accounts SET target_last_tweet_id=?, target_last_tweet_at=?, updated_at=? WHERE id=?",
        [best.id, best.created_at, nowIsoStr, account.id]
      );

      log(`@${account.handle}: found tweet ${best.id} (${(ageMs / 3600000).toFixed(1)}h old)`);
      discovered.push({ account, tweetId: best.id, tweetCreatedAt: best.created_at, ageMs });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("backoff") || msg.includes("429")) {
        log(`@${account.handle}: search rate-limited — stopping discovery`);
        break;
      }
      if (msg.includes("budget exhausted")) {
        log(`@${account.handle}: read budget exhausted — stopping discovery`);
        break;
      }
      log(`@${account.handle}: search error — ${msg.slice(0, 100)}`);
    }
  }

  log(`Discovery complete: ${discovered.length} targets found (${searchCount} searches)`);

  if (discovered.length === 0) {
    log("No eligible targets found. Sent 0. (not a crash, not a budget debit)");
    db.close();
    return;
  }

  // ── Phase 2: Priority sort — prefer < 24h, then 24-48h ───────────────────
  const sorted = discovered.sort((a, b) => {
    const aPref = a.ageMs <= preferredMs ? 0 : 1;
    const bPref = b.ageMs <= preferredMs ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return a.ageMs - b.ageMs; // older-age-first within same tier (maximize reply window before cutoff)
  });

  // ── Phase 3: Autonomous send ──────────────────────────────────────────────
  const budget = getRemainingBudget(db);
  log(`Reply budget remaining: ${budget}`);

  if (budget === 0) {
    log("Reply budget exhausted for today. Sent 0.");
    db.close();
    return;
  }

  let sentCount = 0;
  let skipped403Count = 0;
  let blockedCount = 0;

  for (const target of sorted) {
    if (sentCount >= budget) {
      log("Budget reached. Stopping.");
      break;
    }

    // Kill switch is re-checked inside sendReply (admission Step 1 + killSwitchRecheck
    // before provider call) — no extra per-iteration DB read needed here.

    const draft = getReplyDraft({ tweetText: "", authorHandle: target.account.handle }, db);

    log(`@${target.account.handle}: attempting reply to tweet ${target.tweetId} (template ${draft.templateId})${DRY_RUN ? " [DRY-RUN]" : ""}`);

    if (DRY_RUN) {
      log(`DRY-RUN: would send: "${draft.text.slice(0, 80)}..."`);
      continue;
    }

    const result = await sendReply({
      threadRef: target.tweetId,
      conversationRef: target.tweetId,
      text: draft.text,
      tweetCreatedAt: target.tweetCreatedAt,
      accountHandle: target.account.handle,
      xLeadId: target.account.follow_target_id ?? undefined,
    });

    log(`@${target.account.handle}: outcome=${result.outcome} reason=${result.reason ?? "none"}`);

    if (result.outcome === "sent") {
      sentCount++;
      // Reset 403 counter on success
      if (target.account.consecutive_403_count > 0) {
        db.run(
          "UPDATE social_accounts SET consecutive_403_count=0, updated_at=? WHERE id=?",
          [nowIsoStr, target.account.id]
        );
      }
    } else if (result.outcome === "skipped" && result.reason === "reply_restriction_403") {
      skipped403Count++;
      const newCount = (target.account.consecutive_403_count ?? 0) + 1;
      const lockUntil = newCount >= 2 ? new Date(now + 7 * 24 * 3600 * 1000).toISOString() : null;
      db.run(
        "UPDATE social_accounts SET consecutive_403_count=?, reply_locked_until=?, reply_lock_reason=?, updated_at=? WHERE id=?",
        [newCount, lockUntil, lockUntil ? "consecutive_403_circuit_breaker" : null, nowIsoStr, target.account.id]
      );
      if (lockUntil) {
        log(`@${target.account.handle}: 2 consecutive 403s — locked until ${lockUntil}`);
      } else {
        log(`@${target.account.handle}: consecutive_403_count=${newCount}`);
      }
    } else if (result.outcome === "blocked") {
      blockedCount++;
      log(`@${target.account.handle}: blocked — ${result.reason}: ${result.detail ?? ""}`);
    } else if (result.outcome === "already_exists") {
      log(`@${target.account.handle}: already_exists — tweet ${target.tweetId} already replied`);
    }
  }

  // ── Phase 4: Summary ──────────────────────────────────────────────────────
  log(`Summary: accounts_discovered=${discovered.length} sent=${sentCount} skipped_403=${skipped403Count} blocked=${blockedCount}`);
  if (sentCount === 0 && !DRY_RUN) {
    log("Sent 0 — either no reply-able targets or all blocked/skipped. (not a crash, not a budget debit)");
  }

  db.close();
}

run().catch((e) => {
  console.error("[reply-watchlist-sensor] Fatal:", e.message);
  process.exit(1);
});
