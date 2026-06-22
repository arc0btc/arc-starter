/**
 * skills/social-engine/admission.ts
 * Shared admission primitive for all outbound lanes (post + reply).
 *
 * P4 hardening (2026-06-22): two reply-spam gaps closed per operator incident report
 * and dev-council (4-lens) APPROVE-WITH-CHANGES review:
 *
 *   GUARD 1 (target-age): moved into sendReply() pre-check; block if tweet is stale.
 *   GUARD 2 (per-conversation burst): moved INSIDE the CAS transaction in admitAction()
 *     so it is atomic with the budget reservation — no TOCTOU race.
 *     conversation_ref column added to outbound_action (migration 016, backfilled).
 *   account_id enforcement: reply lane now requires account_id != null at admission
 *     entry — fail with 'missing_account_id' rather than silently omitting it.
 *
 * Both guards fail CLOSED (block-with-log) not open (skip-and-continue).
 */

import type { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export type Lane = "post" | "reply";

export interface AdmitOpts {
  sourceKey: string;
  lane: Lane;
  isRoot: boolean;
  threadRef: string | null;
  conversationRef?: string | null;  // root tweet of the conversation (reply lane)
  payloadRef: string;
  payloadHash: string;
  budgetDay: string;  // YYYY-MM-DD
  accountId?: number;
  notes?: string;
}

export type AdmitResult =
  | { ok: true; actionId: number; engQueuedId: number; engClaimedId: number }
  | { ok: false; reason: AdmitFailReason; detail?: string; existingId?: number; existingStatus?: string };

export type AdmitFailReason =
  | "kill_switch_off"
  | "already_exists"
  | "missing_account_id"       // P4: reply lane requires account_id
  | "root_cap_exceeded"
  | "continuation_cap_exceeded"
  | "conversation_burst"       // P4: ≤1 reply per conversation per window
  | "budget_exhausted"
  | "budget_race"
  | "admission_txn_failed"
  | "cas_claim_failed";

export interface DeferOpts {
  actionId: number;
  newBudgetDay: string;
  currentDeferCount: number;
}

export type DeferResult =
  | { ok: true; terminal: false; newDeferCount: number }
  | { ok: true; terminal: true; reason: "max_defer_count_reached" }
  | { ok: false; reason: "not_future_day" | "update_failed" | "max_defer_already_terminal"; detail?: string };

// ── Config helpers ────────────────────────────────────────────────────────────

function getConfigInt(db: Database, key: string, fallback: number): number {
  const row = db.query("SELECT value FROM agent_config WHERE key=?").get(key) as { value: string } | null;
  if (!row) return fallback;
  const n = parseInt(row.value, 10);
  return isNaN(n) ? fallback : n;
}

function getCapForLane(db: Database, lane: Lane): number {
  if (lane === "post") return getConfigInt(db, "root_daily_cap", 3);
  if (lane === "reply") return getConfigInt(db, "reply_daily_cap", 3);
  return 3;
}

function utcNow(): string {
  return new Date().toISOString();
}

// ── admitAction ───────────────────────────────────────────────────────────────

/**
 * Run §3 delivery state machine steps 1-5:
 *   kill-switch → account_id check (reply) → idempotency → cap checks →
 *   atomic admission txn (incl. conversation burst guard) → CAS claim
 *
 * P4 changes:
 * - Reply lane: account_id must be provided (not null). Returns 'missing_account_id' otherwise.
 * - Conversation burst guard runs INSIDE the admission txn (atomic with budget reservation)
 *   to prevent TOCTOU races. It checks: any sent/queued/sending reply in the same
 *   conversation_ref within conversation_window_minutes. Fails closed.
 */
export function admitAction(db: Database, opts: AdmitOpts): AdmitResult {
  const {
    sourceKey, lane, isRoot, threadRef, payloadRef, payloadHash,
    budgetDay, accountId, notes,
  } = opts;
  const conversationRef = opts.conversationRef ?? threadRef;

  // ── Step 1: Kill-switch check ────────────────────────────────────────────
  const cfg = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string } | null;
  if (!cfg || cfg.value !== "true") {
    return { ok: false, reason: "kill_switch_off", detail: `outbound_enabled=${cfg?.value ?? "missing"}` };
  }

  // ── Step 1b: account_id required for reply lane (P4 hardening) ──────────
  // Fail closed: a reply with no account_id bypasses per-author dedup.
  // Callers must resolve account_id before calling admitAction() for replies.
  if (lane === "reply" && accountId == null) {  // covers both undefined and null
    return {
      ok: false,
      reason: "missing_account_id",
      detail: "reply lane requires account_id to be populated before admission (prevents per-author dedup bypass)",
    };
  }

  // ── Step 2: Idempotency ──────────────────────────────────────────────────
  const existing = db
    .query("SELECT id, status FROM outbound_action WHERE source_key=?")
    .get(sourceKey) as { id: number; status: string } | null;
  if (existing) {
    return {
      ok: false, reason: "already_exists",
      existingId: existing.id, existingStatus: existing.status,
      detail: `outbound_action id=${existing.id} status=${existing.status}`,
    };
  }

  // ── Step 3c: Root cap (post lane, is_root=true) ──────────────────────────
  if (lane === "post" && isRoot) {
    const rootDailyCap = getConfigInt(db, "root_daily_cap", 3);
    const rootCount = db
      .query(
        `SELECT COUNT(*) as cnt FROM outbound_action
         WHERE lane='post' AND is_root=1 AND budget_day=? AND status IN ('queued','sending','sent')`
      )
      .get(budgetDay) as { cnt: number };
    if (rootCount.cnt >= rootDailyCap) {
      return {
        ok: false, reason: "root_cap_exceeded",
        detail: `roots_today=${rootCount.cnt}/${rootDailyCap}`,
      };
    }
  }

  // ── Step 3d: Continuation cap (post lane, is_root=false) ─────────────────
  if (lane === "post" && !isRoot && threadRef) {
    const maxCont = getConfigInt(db, "max_continuations", 2);
    const contCount = db
      .query(
        `SELECT COUNT(*) as cnt FROM outbound_action
         WHERE lane='post' AND thread_ref=? AND is_root=0
           AND status IN ('queued','sending','sent')`
      )
      .get(threadRef) as { cnt: number };
    if (contCount.cnt >= maxCont) {
      return {
        ok: false, reason: "continuation_cap_exceeded",
        detail: `thread_ref=${threadRef} continuations=${contCount.cnt}/${maxCont}`,
      };
    }
  }

  // ── Step 3e: Pre-check budget headroom ──────────────────────────────────
  const cap = getCapForLane(db, lane);
  const budget = db
    .query(
      "SELECT reserved_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane=?"
    )
    .get(budgetDay, lane) as { reserved_count: number; cap: number } | null;
  if (budget && budget.reserved_count >= budget.cap) {
    return {
      ok: false, reason: "budget_exhausted",
      detail: `reserved=${budget.reserved_count}/${budget.cap} for ${lane}/${budgetDay}`,
    };
  }

  // ── Step 4/5: Atomic admission txn (incl. P4 conversation burst guard) ───
  let actionId: number;
  let engQueuedId: number;

  try {
    db.exec("BEGIN");

    // P4 GUARD 2: per-conversation burst check — INSIDE the txn for atomicity.
    // Fails closed: any sent/queued/sending reply in the same conversation within
    // the window blocks this admission. Wedged 'sending' rows older than the
    // lease_expires_at are treated as expired and excluded (liveness: a crashed
    // mid-send does not block the conversation indefinitely).
    if (lane === "reply" && conversationRef) {
      const windowMinutes = getConfigInt(db, "conversation_window_minutes", 1440);
      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
      const now = utcNow();
      const existing = db.query(`
        SELECT id, status FROM outbound_action
        WHERE conversation_ref = ?
          AND lane = 'reply'
          AND created_at >= ?
          AND (
            status IN ('sent', 'queued')
            OR (status = 'sending' AND (lease_expires_at IS NULL OR lease_expires_at > ?))
          )
        LIMIT 1
      `).get(conversationRef, windowStart, now) as
        | { id: number; status: string } | null;

      if (existing) {
        db.exec("ROLLBACK");
        return {
          ok: false,
          reason: "conversation_burst",
          detail: `conversation_ref=${conversationRef} already has a reply (id=${existing.id} status=${existing.status}) within ${windowMinutes}min window`,
        };
      }
    }

    // Ensure budget row exists
    db.run(
      `INSERT OR IGNORE INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
       VALUES ('x', ?, ?, 0, 0, ?)`,
      [budgetDay, lane, cap]
    );

    // CAS reservation: reserve only if still under cap
    const budgetUp = db.run(
      `UPDATE budget_ledger SET reserved_count=reserved_count+1
       WHERE channel='x' AND utc_day=? AND lane=? AND reserved_count < cap`,
      [budgetDay, lane]
    );
    if (budgetUp.changes !== 1) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "budget_race", detail: "budget UPDATE returned 0 changes" };
    }

    // Insert outbound_action (with conversation_ref)
    const insertRes = db.run(
      `INSERT INTO outbound_action
         (source_key, platform, lane, status, payload_ref, payload_hash,
          is_root, thread_ref, conversation_ref, defer_count, budget_day, account_id)
       VALUES (?, 'x', ?, 'queued', ?, ?, ?, ?, ?, 0, ?, ?)`,
      [sourceKey, lane, payloadRef, payloadHash, isRoot ? 1 : 0, threadRef,
       conversationRef ?? null, budgetDay, accountId ?? null]
    );
    actionId = insertRes.lastInsertRowid as number;

    // engagement_log: queued
    const engQ = db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'queued', ?)`,
      [actionId, notes ?? `admitted by shared admission primitive (lane=${lane})`]
    );
    engQueuedId = engQ.lastInsertRowid as number;

    db.exec("COMMIT");
  } catch (err: any) {
    try { db.exec("ROLLBACK"); } catch {}
    return { ok: false, reason: "admission_txn_failed", detail: String(err?.message ?? err) };
  }

  // ── Step 6: CAS claim (queued → sending) ─────────────────────────────────
  const leaseSeconds = getConfigInt(db, "claim_lease_seconds", 300);
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();

  const casUp = db.run(
    `UPDATE outbound_action
     SET status='sending', lease_expires_at=?, updated_at=?
     WHERE id=? AND status='queued'`,
    [leaseUntil, utcNow(), actionId]
  );
  if (casUp.changes !== 1) {
    return { ok: false, reason: "cas_claim_failed", detail: `action_id=${actionId} no longer queued` };
  }

  const engC = db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'claimed', ?)`,
    [actionId, `CAS claim: queued→sending, lease_expires=${leaseUntil}`]
  );
  const engClaimedId = engC.lastInsertRowid as number;

  return { ok: true, actionId, engQueuedId, engClaimedId };
}

// ── deferAction ───────────────────────────────────────────────────────────────

export function deferAction(db: Database, opts: DeferOpts): DeferResult {
  const { actionId, newBudgetDay, currentDeferCount } = opts;

  const today = new Date().toISOString().slice(0, 10);
  if (newBudgetDay <= today) {
    return {
      ok: false, reason: "not_future_day",
      detail: `newBudgetDay=${newBudgetDay} must be strictly after today=${today}`,
    };
  }

  const maxDefer = getConfigInt(db, "max_defer_count", 3);
  const nextDeferCount = currentDeferCount + 1;
  const isTerminal = nextDeferCount >= maxDefer;

  if (isTerminal) {
    const existRow = db
      .query("SELECT status, defer_count FROM outbound_action WHERE id=?")
      .get(actionId) as { status: string; defer_count: number } | null;

    if (existRow?.status === "skipped") {
      return { ok: false, reason: "max_defer_already_terminal", detail: "already skipped" };
    }

    db.run(
      `UPDATE outbound_action SET status='skipped', defer_count=?, updated_at=? WHERE id=?`,
      [nextDeferCount, utcNow(), actionId]
    );
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'skipped', ?)`,
      [actionId, `terminal: max_defer_count=${maxDefer} reached (defer_count=${nextDeferCount})`]
    );
    return { ok: true, terminal: true, reason: "max_defer_count_reached" };
  }

  const maxDeferAgeDays = getConfigInt(db, "max_defer_age_days", 7);
  const ageRow = db.query("SELECT created_at FROM outbound_action WHERE id=?").get(actionId) as
    | { created_at: string } | null;
  if (ageRow) {
    const ageMs = Date.now() - new Date(ageRow.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxDeferAgeDays) {
      db.run(
        `UPDATE outbound_action SET status='skipped', defer_count=?, updated_at=? WHERE id=? AND status NOT IN ('sent','skipped')`,
        [nextDeferCount, utcNow(), actionId]
      );
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'deferred', ?)`,
        [actionId, `terminal: max_defer_age=${maxDeferAgeDays}d exceeded (age=${ageDays.toFixed(1)}d, defer_count=${nextDeferCount})`]
      );
      return { ok: true, terminal: true, reason: "max_defer_count_reached" };
    }
  }

  const newDeferCount = currentDeferCount + 1;
  const upRes = db.run(
    `UPDATE outbound_action
     SET budget_day=?, defer_count=?, status='queued', updated_at=?
     WHERE id=? AND status IN ('queued','sending','planned')`,
    [newBudgetDay, newDeferCount, utcNow(), actionId]
  );

  if (upRes.changes !== 1) {
    return { ok: false, reason: "update_failed", detail: `action_id=${actionId} not in deferrable status` };
  }

  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'deferred', ?)`,
    [actionId, `deferred to ${newBudgetDay} (defer_count=${newDeferCount}/${maxDefer})`]
  );

  return { ok: true, terminal: false, newDeferCount };
}

// ── killSwitchRecheck ─────────────────────────────────────────────────────────

export function killSwitchRecheck(db: Database, actionId: number): boolean {
  const cfg = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string } | null;
  if (cfg && cfg.value === "true") return true;

  db.run(
    `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`,
    [utcNow(), actionId]
  );
  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', 'kill switch off between admission and provider send')`,
    [actionId]
  );
  return false;
}

// ── markUnknown ───────────────────────────────────────────────────────────────

export function markUnknown(db: Database, actionId: number, reason: string): void {
  db.run(
    `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`,
    [utcNow(), actionId]
  );
  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
    [actionId, reason.slice(0, 500)]
  );
}

// ── markSent ─────────────────────────────────────────────────────────────────

export function markSent(db: Database, actionId: number, providerPostId: string, lane: Lane, budgetDay: string): void {
  db.run(
    `UPDATE outbound_action SET status='sent', provider_post_id=?, updated_at=? WHERE id=?`,
    [providerPostId, utcNow(), actionId]
  );
  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'sent', ?)`,
    [actionId, `provider_post_id=${providerPostId}`]
  );
  db.run(
    `UPDATE budget_ledger SET sent_count=sent_count+1
     WHERE channel='x' AND utc_day=? AND lane=?`,
    [budgetDay, lane]
  );
}

// ── retryToQueued ─────────────────────────────────────────────────────────────

export function retryToQueued(db: Database, actionId: number, notes: string): boolean {
  const row = db
    .query(
      `SELECT status, lease_expires_at FROM outbound_action WHERE id=? AND status='sending'`
    )
    .get(actionId) as { status: string; lease_expires_at: string | null } | null;

  if (!row) return false;

  if (row.lease_expires_at && row.lease_expires_at < new Date().toISOString()) {
    markUnknown(db, actionId, `lease expired: ${row.lease_expires_at}; cannot retry: ${notes}`);
    return false;
  }

  db.run(
    `UPDATE outbound_action SET status='queued', lease_expires_at=NULL, updated_at=? WHERE id=?`,
    [utcNow(), actionId]
  );
  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'queued', ?)`,
    [actionId, `pre-send failure: returned to queued (lease valid): ${notes}`]
  );
  return true;
}
