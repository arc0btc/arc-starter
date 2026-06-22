/**
 * skills/social-engine/reply-send.ts
 *
 * THE single reply sender for Arc's X reply lane.
 *
 * P4 hardening (2026-06-22) — two gaps from operator incident (outbound_action
 * ids 7,8 — week-old necro-replies with account_id=NULL) closed per dev-council
 * (4-lens) APPROVE-WITH-CHANGES review:
 *
 *   GUARD 1 (target-age, fail-closed): if tweetCreatedAt is provided, compute age and
 *     refuse to reply to tweets older than reply_target_age_hours (default 48h).
 *     If tweetCreatedAt is NOT provided, the reply is BLOCKED with 'missing_tweet_age'
 *     rather than silently allowed — callers must supply tweet metadata. The only
 *     exception is opts.skipAgeCheck=true for explicit bypass (fixtures/tests only).
 *
 *   GUARD 2 (conversation burst, atomic): moved INSIDE admitAction()'s CAS txn —
 *     see admission.ts. sendReply() sets conversationRef (required for reply lane)
 *     and passes it to admitAction(). admitAction() returns 'conversation_burst' if
 *     ≤1 reply per conversationRef per window is violated.
 *
 *   account_id resolution (fail-closed): two-step resolution:
 *     1. accountHandle → social_accounts.handle
 *     2. xLeadId → social_accounts.follow_target_id
 *     If account_id is still null after both steps, the reply is BLOCKED with
 *     'missing_account_id' (admission.ts enforces this). Callers must pass at least
 *     one of accountHandle or xLeadId for the reply lane.
 *
 * Every reply — reactive or proactive — goes through sendReply().
 * It is the ONLY code path permitted to issue a reply.
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { admitAction, killSwitchRecheck, markSent, markUnknown } from "./admission.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const PAYLOADS_DIR = process.env.ARC_PAYLOADS_DIR ?? "/home/dev/arc-starter/payloads";

export type ReplyOutcome =
  | "sent"
  | "skipped"          // reply-restriction 403 (thread outside scope)
  | "unknown"          // ambiguous send or true auth/scope error — never auto-resent
  | "blocked"          // admission refused (kill switch / budget / cap / guard)
  | "already_exists";  // canonical source_key already has a row (idempotent no-op)

export interface SendReplyOpts {
  threadRef: string;          // the tweet id being replied to
  conversationRef?: string;   // root tweet id of the conversation (required for burst guard; defaults to threadRef)
  text: string;
  tweetCreatedAt?: string;    // ISO8601 creation time of the target tweet (required; skipAgeCheck=true to bypass)
  skipAgeCheck?: boolean;     // fixture/test bypass ONLY — skips target-age guard
  accountHandle?: string;     // for account_id resolution (step 1)
  xLeadId?: string;           // for account_id resolution fallback (step 2, follow_target_id)
  sourceKey?: string;         // optional override; default canonical per-thread key
  dbPath?: string;            // optional override (fixtures)
}

export interface SendReplyResult {
  outcome: ReplyOutcome;
  actionId?: number;
  providerPostId?: string | null;
  sourceKey: string;
  reason?: string;
  detail?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function getConfigInt(db: Database, key: string, fallback: number): number {
  const row = db.query("SELECT value FROM agent_config WHERE key=?").get(key) as { value: string } | null;
  if (!row) return fallback;
  const n = parseInt(row.value, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Canonical reply source_key. DAY-INDEPENDENT: keyed only on thread_ref so the
 * UNIQUE constraint on outbound_action.source_key enforces AT MOST ONE reply per
 * thread for ALL TIME (closes the cross-day re-fire gap).
 */
export function canonicalReplySourceKey(threadRef: string, _day?: string): string {
  return `engage:out:reply:x:${threadRef}`;
}

/**
 * Classify a provider error from providerReplySend().
 */
export function classifyProviderError(err: any): {
  kind: "reply_restriction" | "auth_scope" | "transient";
  status: number | null;
  rawJson: string;
} {
  const status: number | null = typeof err?.status === "number" ? err.status : null;
  const body = err?.body;
  const rawJson =
    body !== undefined
      ? JSON.stringify(body)
      : JSON.stringify({ message: String(err?.message ?? err) });
  const hay = rawJson.toLowerCase();

  const replyRestrictionSignals = [
    "not permitted to reply",
    "not allowed to reply",
    "cannot reply",
    "reply to this",
    "who can reply",
    "not allowed to create a reply",
    "in-reply-to",
    "in_reply_to",
    "conversation",
    "you are not able to reply",
  ];
  if (status === 403 && replyRestrictionSignals.some((s) => hay.includes(s))) {
    return { kind: "reply_restriction", status, rawJson };
  }

  const authSignals = [
    "unauthorized",
    "oauth",
    "access token",
    "consumer key",
    "not authorized",
    "unsupported authentication",
    "scope",
    "permission",
    "forbidden",
  ];
  if ((status === 401 || status === 403) && authSignals.some((s) => hay.includes(s))) {
    return { kind: "auth_scope", status, rawJson };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth_scope", status, rawJson };
  }
  return { kind: "transient", status, rawJson };
}

function appendEngagement(db: Database, actionId: number, eventType: string, notes: string): void {
  db.run(`INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, ?, ?)`, [
    actionId,
    eventType,
    notes.slice(0, 500),
  ]);
}

function markReplyRestrictionSkip(
  db: Database,
  actionId: number,
  budgetDay: string,
  rawJson: string,
): void {
  db.exec("BEGIN");
  try {
    db.run(`UPDATE outbound_action SET status='skipped', updated_at=? WHERE id=?`, [nowIso(), actionId]);
    db.run(
      `UPDATE budget_ledger SET reserved_count = MAX(reserved_count - 1, 0)
       WHERE channel='x' AND utc_day=? AND lane='reply'`,
      [budgetDay],
    );
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'skipped', ?)`,
      [actionId, `reply-restriction 403 (thread outside scope) — slot released. raw=${rawJson}`.slice(0, 500)],
    );
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

function recordGive3x(
  db: Database,
  repliedToTweetId: string,
  replyTweetId: string | null,
  xLeadAuthorId: string | undefined,
): void {
  if (!xLeadAuthorId) return;
  db.run(
    `CREATE TABLE IF NOT EXISTS x_reply_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       replied_to_tweet_id TEXT NOT NULL,
       reply_tweet_id TEXT,
       x_lead_author_id TEXT,
       replied_at TEXT NOT NULL
     )`,
  );
  db.run(
    `INSERT INTO x_reply_log (replied_to_tweet_id, reply_tweet_id, x_lead_author_id, replied_at)
     VALUES (?, ?, ?, ?)`,
    [repliedToTweetId, replyTweetId, xLeadAuthorId, nowIso()],
  );
}

/**
 * Send a single reply through the one admission + send path.
 *
 * P4 hardening: GUARD 1 (target-age, fail-closed) runs before admission.
 * GUARD 2 (conversation burst, atomic) runs inside admitAction()'s CAS txn.
 * account_id resolution is two-step (accountHandle then xLeadId fallback);
 * missing account_id blocks the reply (fail-closed, enforced by admitAction).
 *
 * @param sender optional injectable provider primitive (fixtures pass a fake).
 */
export async function sendReply(
  opts: SendReplyOpts,
  sender?: (text: string, tweetId: string) => Promise<{ postId: string | null; raw: Record<string, unknown> }>,
): Promise<SendReplyResult> {
  const dbPath = opts.dbPath ?? DB_PATH;
  const budgetDay = utcDay();
  const sourceKey = opts.sourceKey ?? canonicalReplySourceKey(opts.threadRef);
  const conversationRef = opts.conversationRef ?? opts.threadRef;

  if (opts.text.length > 280) {
    return { outcome: "blocked", sourceKey, reason: "text_too_long", detail: `${opts.text.length}/280` };
  }

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  try {
    // ── P4 GUARD 1: target-age check (fail-closed, flattened guard clauses) ──
    // Requires tweetCreatedAt for all reply sends; missing = block (not skip).
    if (!opts.skipAgeCheck) {
      if (!opts.tweetCreatedAt)
        return { outcome: "blocked", sourceKey, reason: "missing_tweet_age",
                 detail: "tweetCreatedAt is required (P4 fail-closed). Pass skipAgeCheck=true in fixtures." };

      const tweetDate = new Date(opts.tweetCreatedAt);
      if (isNaN(tweetDate.getTime()))
        return { outcome: "blocked", sourceKey, reason: "invalid_tweet_age",
                 detail: `tweetCreatedAt='${opts.tweetCreatedAt}' is not a valid ISO8601 date` };

      const ageMs = Date.now() - tweetDate.getTime();
      const cutoffHours = getConfigInt(db, "reply_target_age_hours", 48);
      if (ageMs > cutoffHours * 3600 * 1000)
        return { outcome: "blocked", sourceKey, reason: "stale_target",
                 detail: `tweet age ${(ageMs / 3600000).toFixed(1)}h > cutoff ${cutoffHours}h (reply_target_age_hours)` };
    }

    // ── account_id resolution (two-step, fail-closed) ─────────────────────
    // Step 1: accountHandle → social_accounts.handle
    let accountId: number | undefined;
    if (opts.accountHandle) {
      const acc = db
        .query("SELECT id FROM social_accounts WHERE handle=?")
        .get(opts.accountHandle) as { id: number } | null;
      accountId = acc?.id;
    }
    // Step 2: xLeadId fallback → social_accounts.follow_target_id
    if (accountId === undefined && opts.xLeadId) {
      const acc = db
        .query("SELECT id FROM social_accounts WHERE follow_target_id=?")
        .get(opts.xLeadId) as { id: number } | null;
      accountId = acc?.id;
    }
    // NOTE: if accountId is still undefined here, admitAction() will return
    // 'missing_account_id' (fail-closed). Callers must pass accountHandle or xLeadId.

    const payloadHash = sha256(opts.text);
    const payloadRef = "reply-" + payloadHash.slice(0, 12);

    // ── Steps 1-6: admission (kill switch → account_id check → idempotency →
    //    caps → atomic txn incl. P4 conversation burst guard → CAS claim)
    const admit = admitAction(db, {
      sourceKey,
      lane: "reply",
      isRoot: false,
      threadRef: opts.threadRef,
      conversationRef,
      payloadRef,
      payloadHash,
      budgetDay,
      accountId,
      notes: `unified reply sender: thread=${opts.threadRef} conversation=${conversationRef}`,
    });

    if (!admit.ok) {
      if (admit.reason === "already_exists") {
        return {
          outcome: "already_exists",
          sourceKey,
          actionId: admit.existingId,
          reason: admit.reason,
          detail: admit.detail,
        };
      }
      return { outcome: "blocked", sourceKey, reason: admit.reason, detail: admit.detail };
    }

    const actionId = admit.actionId;

    // Persist payload file (best-effort)
    try {
      fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
      const pPath = path.join(PAYLOADS_DIR, `${payloadRef}.txt`);
      if (!fs.existsSync(pPath)) fs.writeFileSync(pPath, opts.text, "utf8");
    } catch {
      /* payload persistence is non-fatal */
    }

    // ── Step 7: kill-switch re-check immediately before provider call ──────
    if (!killSwitchRecheck(db, actionId)) {
      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(reserved_count - 1, 0)
         WHERE channel='x' AND utc_day=? AND lane='reply'`,
        [budgetDay],
      );
      return { outcome: "unknown", sourceKey, actionId, reason: "kill_switch_off_pre_send" };
    }

    // ── Step 8: provider send ────────────────────────────────────────────────
    const doSend =
      sender ??
      (async (text: string, tweetId: string) => {
        const { providerReplySend } = await import("../social-x-posting/cli.ts");
        return providerReplySend(text, tweetId);
      });

    let providerPostId: string | null = null;
    try {
      const res = await doSend(opts.text, opts.threadRef);
      providerPostId = res.postId;

      if (!providerPostId) {
        markUnknown(db, actionId, `send returned no provider_post_id. raw=${JSON.stringify(res.raw)}`);
        return { outcome: "unknown", sourceKey, actionId, reason: "no_provider_post_id" };
      }

      // ── Step 9: persist sent ───────────────────────────────────────────────
      markSent(db, actionId, providerPostId, "reply", budgetDay);
      recordGive3x(db, opts.threadRef, providerPostId, opts.xLeadId);
      appendEngagement(db, actionId, "reconciled", `provider_post_id=${providerPostId} accepted by provider`);
      return { outcome: "sent", sourceKey, actionId, providerPostId };
    } catch (err: any) {
      const cls = classifyProviderError(err);

      if (cls.kind === "reply_restriction") {
        markReplyRestrictionSkip(db, actionId, budgetDay, cls.rawJson);
        return {
          outcome: "skipped",
          sourceKey,
          actionId,
          reason: "reply_restriction_403",
          detail: cls.rawJson.slice(0, 200),
        };
      }

      if (cls.kind === "auth_scope") {
        db.run(`UPDATE agent_config SET value='false', updated_at=? WHERE key='outbound_enabled'`, [nowIso()]);
        markUnknown(db, actionId, `auth/scope ${cls.status}: kill switch tripped. raw=${cls.rawJson}`);
        return {
          outcome: "unknown",
          sourceKey,
          actionId,
          reason: "auth_scope_error_kill_switch",
          detail: cls.rawJson.slice(0, 200),
        };
      }

      markUnknown(db, actionId, `transient send error (no auto-resend). raw=${cls.rawJson}`);
      return { outcome: "unknown", sourceKey, actionId, reason: "transient_error", detail: cls.rawJson.slice(0, 200) };
    }
  } finally {
    db.close();
  }
}
