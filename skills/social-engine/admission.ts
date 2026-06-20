/**
 * ops/lib/social-engine/admission.ts
 * Shared admission primitive for all outbound lanes (post + reply).
 *
 * Both the reply lane (P3) and the post lane (P4) use this module for §3 delivery
 * state machine steps 1-5 (kill-switch, idempotency, cap checks, atomic admission,
 * CAS claim) and deferral with bounded max_defer_count.
 *
 * P3's control send (005-p3-reply-pipeline.ts) implemented the same logic inline.
 * That script already ran its one-time live send. New sends in both lanes call
 * admitAction() from this module to avoid divergence.
 *
 * Usage (example):
 *   import { admitAction, deferAction } from '../../ops/lib/social-engine/admission.ts';
 *
 * Config is read live from agent_config in the provided Database instance.
 * All DB operations use the caller's open Database — no new connections opened.
 */

import type { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export type Lane = "post" | "reply";

export interface AdmitOpts {
  sourceKey: string;
  lane: Lane;
  isRoot: boolean;
  threadRef: string | null;
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
  | "root_cap_exceeded"
  | "continuation_cap_exceeded"
  | "budget_exhausted"
  | "budget_race"
  | "admission_txn_failed"
  | "cas_claim_failed";

export interface DeferOpts {
  actionId: number;
  newBudgetDay: string;  // Must be strictly > today
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
  if (lane === "reply") return getConfigInt(db, "reply_daily_cap", 40);
  return 40;
}

function utcNow(): string {
  return new Date().toISOString();
}

// ── admitAction ───────────────────────────────────────────────────────────────

/**
 * Run §3 delivery state machine steps 1-5:
 *   kill-switch → idempotency → cap checks → atomic admission txn → CAS claim
 *
 * Returns { ok: true, actionId, engQueuedId, engClaimedId } on success.
 * Returns { ok: false, reason, ... } on any gate failure.
 *
 * On success the outbound_action row is in status='sending' with an active lease.
 * The caller is responsible for:
 *   - Doing the kill-switch re-check immediately before provider send (§3.7)
 *   - Updating status to 'sent' + provider_post_id on success
 *   - Updating status to 'unknown' on ambiguous send
 */
export function admitAction(db: Database, opts: AdmitOpts): AdmitResult {
  const {
    sourceKey, lane, isRoot, threadRef, payloadRef, payloadHash,
    budgetDay, accountId, notes,
  } = opts;

  // ── Step 1: Kill-switch check ────────────────────────────────────────────
  const cfg = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string } | null;
  if (!cfg || cfg.value !== "true") {
    return { ok: false, reason: "kill_switch_off", detail: `outbound_enabled=${cfg?.value ?? "missing"}` };
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

  // ── Step 4/5: Atomic admission txn ───────────────────────────────────────
  let actionId: number;
  let engQueuedId: number;

  try {
    db.exec("BEGIN");

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

    // Insert outbound_action
    const insertRes = db.run(
      `INSERT INTO outbound_action
         (source_key, platform, lane, status, payload_ref, payload_hash,
          is_root, thread_ref, defer_count, budget_day, account_id)
       VALUES (?, 'x', ?, 'queued', ?, ?, ?, ?, 0, ?, ?)`,
      [sourceKey, lane, payloadRef, payloadHash, isRoot ? 1 : 0, threadRef, budgetDay, accountId ?? null]
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

/**
 * Defer a queued action to a strictly future UTC day.
 *
 * Per §3: "A defer must set budget_day to a strictly later UTC day;
 *          after the third defer it is skipped."
 *
 * Returns { ok: true, terminal: false, newDeferCount } on successful defer.
 * Returns { ok: true, terminal: true, reason: 'max_defer_count_reached' } on 3rd defer.
 * Returns { ok: false, reason: 'not_future_day' } if newBudgetDay is not strictly future.
 */
export function deferAction(db: Database, opts: DeferOpts): DeferResult {
  const { actionId, newBudgetDay, currentDeferCount } = opts;

  // Validate strictly future day
  const today = new Date().toISOString().slice(0, 10);
  if (newBudgetDay <= today) {
    return {
      ok: false, reason: "not_future_day",
      detail: `newBudgetDay=${newBudgetDay} must be strictly after today=${today}`,
    };
  }

  const maxDefer = getConfigInt(db, "max_defer_count", 3);

  // Terminal skip: when the NEW defer_count would reach or exceed max_defer_count.
  // "after the 3rd defer it is skipped" → terminal when currentDeferCount + 1 >= maxDefer.
  // Also handles case where row is already at max (e.g., stuck row found by monitor).
  const nextDeferCount = currentDeferCount + 1;
  const isTerminal = nextDeferCount >= maxDefer;

  if (isTerminal) {
    // Check current status to avoid double-skip
    const existRow = db
      .query("SELECT status, defer_count FROM outbound_action WHERE id=?")
      .get(actionId) as { status: string; defer_count: number } | null;

    if (existRow?.status === "skipped") {
      return { ok: false, reason: "max_defer_already_terminal", detail: "already skipped" };
    }

    // Apply the final defer_count before skipping (consistent state)
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

  // Non-terminal defer: bump defer_count, update budget_day, reset to queued
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

/**
 * §3 step 7: Kill-switch re-check immediately before provider send.
 * If kill switch is off, marks action as 'unknown' and logs it.
 *
 * Returns true if clear to send; false if kill switch was off (caller must abort send).
 */
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

/**
 * Mark an action as unknown (ambiguous send) and log it.
 * unknown is NEVER automatically resent per §3.4.
 */
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

/**
 * Mark an action as sent with provider_post_id and increment budget sent_count.
 */
export function markSent(db: Database, actionId: number, providerPostId: string, lane: Lane, budgetDay: string): void {
  db.run(
    `UPDATE outbound_action SET status='sent', provider_post_id=?, updated_at=? WHERE id=?`,
    [providerPostId, utcNow(), actionId]
  );
  db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'sent', ?)`,
    [actionId, `provider_post_id=${providerPostId}`]
  );
  // Increment sent_count (observational — does not gate caps)
  db.run(
    `UPDATE budget_ledger SET sent_count=sent_count+1
     WHERE channel='x' AND utc_day=? AND lane=?`,
    [budgetDay, lane]
  );
}

// ── retryToQueued ─────────────────────────────────────────────────────────────

/**
 * §3.5: A clearly pre-send failure may return to 'queued' ONLY while its original
 * reservation remains valid (lease still active). Returns false if lease expired.
 */
export function retryToQueued(db: Database, actionId: number, notes: string): boolean {
  const row = db
    .query(
      `SELECT status, lease_expires_at FROM outbound_action WHERE id=? AND status='sending'`
    )
    .get(actionId) as { status: string; lease_expires_at: string | null } | null;

  if (!row) return false;

  // Check lease is still valid
  if (row.lease_expires_at && row.lease_expires_at < new Date().toISOString()) {
    // Lease expired — cannot return to queued; mark unknown instead
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
