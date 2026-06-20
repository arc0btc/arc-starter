/**
 * skills/social-engine/reply-send.ts
 *
 * THE single reply sender for Arc's X reply lane.
 *
 * Every reply — reactive (mention) or proactive (cohort reply-guy) — goes through
 * sendReply(). It is the ONLY code path permitted to issue a reply, and it routes
 * every send through the shared admission primitive (admission.ts) so that:
 *
 *   - source_key is UNIQUE per thread (DAY-INDEPENDENT) -> at most ONE reply per
 *     thread for ALL TIME (canonical key: engage:out:reply:x:<thread_ref>, no day
 *     suffix). The UNIQUE constraint on outbound_action.source_key is the hard
 *     all-time dedup the legacy --source-string path lacked. Per-day BUDGET is
 *     enforced separately by budget_ledger (debited per UTC day in admission).
 *   - outbound_enabled (kill switch) is checked BEFORE admission AND again
 *     immediately before the provider call (killSwitchRecheck).
 *   - budget_ledger is debited inside the admission txn (CAS reservation under cap).
 *   - an ambiguous send → status='unknown' and is NEVER auto-resent.
 *   - a reply-restriction 403 ("not permitted to reply" — thread outside Arc's
 *     conversation scope) → status='skipped': no kill-switch trip, no alarm, the
 *     reserved slot is released (budget reserved_count decremented), and the RAW
 *     provider JSON is persisted to engagement_log.notes.
 *   - a TRUE auth/scope 401/403 (OAuth/permission) → status='unknown' + kill switch
 *     tripped (outbound_enabled=false) so the operator investigates.
 *
 * The actual HTTP POST /tweets is done by the low-level providerReplySend() in
 * social-x-posting/cli.ts — that primitive does NO dedup/budget of its own.
 *
 * Env: ARC_DB_PATH (default /home/dev/arc-starter/db/arc.sqlite),
 *      ARC_CREDS_PASSWORD (for the credential store used by providerReplySend).
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { admitAction, killSwitchRecheck, markSent, markUnknown } from "./admission.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const PAYLOADS_DIR = process.env.ARC_PAYLOADS_DIR ?? "/home/dev/arc-starter/payloads";

export type ReplyOutcome =
  | "sent" // provider accepted; provider_post_id recorded
  | "skipped" // reply-restriction 403 (thread outside scope) — no slot burn, no alarm
  | "unknown" // ambiguous send or true auth/scope error — never auto-resent
  | "blocked" // admission refused (kill switch off / budget exhausted / cap)
  | "already_exists"; // canonical source_key already has a row (idempotent no-op)

export interface SendReplyOpts {
  threadRef: string; // the tweet id being replied to (thread root ref)
  text: string;
  accountHandle?: string; // optional: target account handle (for account_id linkage)
  xLeadId?: string; // optional: original author id for give-3x value_touch logging
  sourceKey?: string; // optional override; default canonical per-thread/day key
  dbPath?: string; // optional override (fixtures)
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

/**
 * Canonical reply source_key. DAY-INDEPENDENT: keyed only on thread_ref so the
 * UNIQUE constraint on outbound_action.source_key enforces AT MOST ONE reply per
 * thread for ALL TIME (closes the cross-day re-fire gap — Arc must never reply to
 * the same X thread twice in its lifetime). Per-day BUDGET is enforced separately
 * by budget_ledger UNIQUE(channel, utc_day, lane), debited per UTC day in admission.
 *
 * The optional second arg is accepted and IGNORED for backward call-site compat.
 */
export function canonicalReplySourceKey(threadRef: string, _day?: string): string {
  return `engage:out:reply:x:${threadRef}`;
}

/**
 * Classify a provider error from providerReplySend().
 * Returns:
 *   "reply_restriction" — 403 whose body indicates the reply is not permitted for
 *      this thread (outside Arc's conversation scope). → skip.
 *   "auth_scope"        — 401/403 indicating an OAuth/permission/scope problem. → kill switch.
 *   "transient"         — anything else (timeout, 5xx, parse). → unknown, no auto-resend.
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

  // Reply-restriction signals: X returns 403 with detail/title text indicating the
  // authenticated user may not reply to this conversation (not in the conversation,
  // protected/limited replies, "who can reply" restriction).
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

  // True auth/scope problems.
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
  // Any other 401/403 with no reply-restriction signal → treat as auth/scope (safe default:
  // trip the kill switch rather than silently skip an unexplained permission failure).
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

/**
 * Mark a reply-restriction skip: status='skipped', release the reserved budget slot
 * (so a thread we cannot reply to does not burn a daily slot), persist RAW provider JSON.
 */
function markReplyRestrictionSkip(
  db: Database,
  actionId: number,
  budgetDay: string,
  rawJson: string,
): void {
  db.exec("BEGIN");
  try {
    db.run(`UPDATE outbound_action SET status='skipped', updated_at=? WHERE id=?`, [nowIso(), actionId]);
    // Release the reserved slot — a non-permitted thread must not consume a reply slot.
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
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Log give-3x value_touch for the original author (mirrors legacy recordXReply). */
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
 * @param sender optional injectable provider primitive (fixtures pass a fake).
 *               Defaults to social-x-posting's providerReplySend (real HTTP).
 */
export async function sendReply(
  opts: SendReplyOpts,
  sender?: (text: string, tweetId: string) => Promise<{ postId: string | null; raw: Record<string, unknown> }>,
): Promise<SendReplyResult> {
  const dbPath = opts.dbPath ?? DB_PATH;
  const budgetDay = utcDay();
  const sourceKey = opts.sourceKey ?? canonicalReplySourceKey(opts.threadRef);

  if (opts.text.length > 280) {
    return { outcome: "blocked", sourceKey, reason: "text_too_long", detail: `${opts.text.length}/280` };
  }

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  try {
    // Resolve optional account_id linkage (non-fatal if missing).
    let accountId: number | undefined;
    if (opts.accountHandle) {
      const acc = db
        .query("SELECT id FROM social_accounts WHERE handle=?")
        .get(opts.accountHandle) as { id: number } | null;
      accountId = acc?.id;
    }

    const payloadHash = sha256(opts.text);
    const payloadRef = "reply-" + payloadHash.slice(0, 12);

    // ── Step 1-6: admission (kill switch → idempotency → caps → budget txn → CAS claim)
    const admit = admitAction(db, {
      sourceKey,
      lane: "reply",
      isRoot: false,
      threadRef: opts.threadRef,
      payloadRef,
      payloadHash,
      budgetDay,
      accountId,
      notes: `unified reply sender: thread=${opts.threadRef}`,
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

    // Persist payload file (best-effort, for parity with prior pipeline).
    try {
      fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
      const pPath = path.join(PAYLOADS_DIR, `${payloadRef}.txt`);
      if (!fs.existsSync(pPath)) fs.writeFileSync(pPath, opts.text, "utf8");
    } catch {
      /* payload persistence is non-fatal */
    }

    // ── Step 7: kill-switch re-check immediately before provider call ──────────
    if (!killSwitchRecheck(db, actionId)) {
      // killSwitchRecheck already marked status='unknown' + logged. Release the slot
      // so a flip of the switch does not permanently burn budget.
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

      // ── Step 9: persist sent + reconcile-by-presence ───────────────────────
      markSent(db, actionId, providerPostId, "reply", budgetDay);
      recordGive3x(db, opts.threadRef, providerPostId, opts.xLeadId);
      appendEngagement(db, actionId, "reconciled", `provider_post_id=${providerPostId} accepted by provider`);
      return { outcome: "sent", sourceKey, actionId, providerPostId };
    } catch (err: any) {
      const cls = classifyProviderError(err);

      if (cls.kind === "reply_restriction") {
        // SKIP: no kill-switch trip, no alarm, slot released, RAW JSON persisted.
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
        // TRUE auth/scope error: trip kill switch + mark unknown (operator investigates).
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

      // transient/ambiguous → unknown, never auto-resent.
      markUnknown(db, actionId, `transient send error (no auto-resend). raw=${cls.rawJson}`);
      return { outcome: "unknown", sourceKey, actionId, reason: "transient_error", detail: cls.rawJson.slice(0, 200) };
    }
  } finally {
    db.close();
  }
}
