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
 *
 * P2 arc-posting-scheduler (2026-07-05, dev-council 5-lens reviewed design spec —
 * docs/specs/2026-07-05-posting-scheduler-design.md, this repo's control plane): the
 * atomic-action unit of account. `admitAction()` above admits ONE `outbound_action` ROW
 * (one tweet) per call — nothing stops a root being admitted and a later continuation
 * call failing, starving a thread mid-chain. `admitGroup()` below admits a whole POSTING
 * ACTION (a thread + its CTA, M tweets) in ONE transaction: either M budget slots are
 * reserved AND M `outbound_action` rows are inserted, or NEITHER happens. Terminology
 * note (dev-council/Fowler): "action" here is the domain unit (M tweets); the
 * `outbound_action` TABLE's row is still one tweet — do not conflate the two.
 *
 * Precise invariant (dev-council/Kleppmann + Lamport): `admitGroup()` proves ATOMIC
 * ADMISSION only — the DB transitions atomically. It does NOT prove ATOMIC PUBLICATION —
 * the drain loop (cli.ts) still POSTs each row's tweet one external API call at a time,
 * non-transactionally, so a crash/403 between tweets can still truncate the thread ON X
 * even though the DB stays fully consistent. `nextUnsentInGroup()` is the DB-side
 * resumable-drain primitive for that residual case; `claimForSend()` adds a fencing CAS at
 * the actual send moment (closing the "lease expires while still mid-flight" double-send
 * gap `lease_expires_at` alone doesn't close); `releaseAbandonedReservations()` decrements
 * `budget_ledger.reserved_count` for abandoned rows so reservations don't climb forever
 * (Lamport/Kleppmann's named leak: reserved_count only ever incremented before this).
 */

import type { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

// P3 arc-posting-scheduler (2026-07-05): two new lane VALUES so daily-read and
// content-calendar each get their OWN budget_ledger row/cap — real per-lane separation,
// not a shared 'post' lane. See admitGroup()'s globalCap param for how DAILY_TWEET_CAP
// stays an absolute cross-lane backstop even though each lane now has its own quota.
// P3-migration (2026-07-07, task #21524): quest-gtm (whop-sales GTM acquisition
// posts) and x-cadence (social-x-posting's own proactive beat) migrated off the
// legacy cmdPost guard stack onto reserve-group, same as daily-read/content-calendar.
export type Lane = "post" | "reply" | "daily-read" | "content-calendar" | "quest-gtm" | "x-cadence";

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

// ── admitGroup types (P2 arc-posting-scheduler) ───────────────────────────────

/** One posting ACTION = M tweets (root + continuations + CTA), admitted as one unit. */
export interface AdmitGroupOpts {
  /** Source keys in POST ORDER — sourceKeys[0] is the root (isRootFlags[0] must be true). */
  sourceKeys: string[];
  lane: Lane;
  threadRef: string;
  budgetDay: string; // YYYY-MM-DD
  /** Tweet-TOTAL cap for this lane/day (e.g. DAILY_TWEET_CAP=6) — distinct from
   *  getCapForLane()'s ROOT-only cap. Caller-supplied because admitGroup reserves
   *  M *tweets*, not M *roots*. */
  cap: number;
  payloadRefs: string[];
  payloadHashes: string[];
  isRootFlags: boolean[];
  accountId?: number;
  notes?: string;
  /** P3 arc-posting-scheduler: HH:MM (UTC) window this group may drain within. NULL/
   *  undefined on either end = anytime on that end (matches today's implicit behavior —
   *  existing rows/lanes with no window keep working unchanged). Stored on every row in
   *  the group (outbound_action.earliest_utc_time/latest_utc_time, migration 014). */
  earliestUtcTime?: string;
  latestUtcTime?: string;
  /** P3 arc-posting-scheduler: the ABSOLUTE cross-lane tweet-total ceiling for the day
   *  (DAILY_TWEET_CAP=6) — distinct from `cap`, which is this GROUP's own lane's cap.
   *  When supplied, admitGroup() ALSO CAS-reserves M slots against a sentinel
   *  `lane='__global__'` budget_ledger row in the SAME transaction, so no combination of
   *  lanes can push today's real tweet total past this value, even though each lane has
   *  its own separate quota. Omitted (undefined) = no global check (back-compat for any
   *  caller that doesn't pass it, e.g. tests).
   */
  globalCap?: number;
}

export type AdmitGroupResult =
  | { ok: true; actionIds: number[]; atomicGroupId: string }
  | { ok: false; reason: AdmitGroupFailReason; detail?: string; existingId?: number; existingStatus?: string };

export type AdmitGroupFailReason =
  | "kill_switch_off"
  | "invalid_opts"
  | "already_exists"
  | "group_too_large"          // CHECKPOINTS.md #2: >5 tweets/action
  | "actions_per_day_exceeded" // CHECKPOINTS.md #2: >=3 groups already admitted today for this lane
  | "budget_exhausted"         // whole-group headroom check failed — NEITHER slot reserved nor row inserted
  | "global_cap_exceeded"      // P3: per-lane headroom was fine but the cross-lane DAILY_TWEET_CAP backstop isn't
  | "admission_txn_failed";

// SUPERSEDED (dev-council/Newman, applied — see admitGroup()'s global-backstop comment):
// this sentinel-row approach was replaced by a derived cross-lane SUM. `GLOBAL_BACKSTOP_LANE`
// is kept defined only because the three release functions below still reference it in a
// dead branch (`if (row.global_reserved)` — always false now, since admitGroup() always
// inserts `global_reserved=0`) guarding backward-compat for any historical row from this
// phase's own brief live-testing window (all cleaned up). Left in place deliberately rather
// than excised mid-fix-pass — removing it is a safe, no-behavior-change follow-up, not a
// live risk (an always-false `if` is inert).
const GLOBAL_BACKSTOP_LANE = "__global__";

/**
 * CHECKPOINTS.md #2 safety rail (arc-posting-scheduler): 3 actions/day x 5 tweets/action.
 * dev-council/Fowler (noted): MAX_ACTIONS_PER_DAY is enforced PER LANE (admitGroup's
 * query is `WHERE lane=? AND budget_day=?`), while CHECKPOINTS.md #2's "3 actions/day"
 * was framed against today's single-lane reality (BUDGET_LIMITS.posts=3 roots/day,
 * across all posting). While only the 'post' lane is live (this phase), per-lane and
 * global are the same number — no behavior difference. The moment P3 adds new lane
 * VALUES (daily-read/content-calendar), "3/lane" and "3 total" diverge; deciding which
 * one CHECKPOINTS.md #2 actually meant at that point is P3's job, not silently
 * inherited from this constant's current per-lane scope.
 */
export const MAX_TWEETS_PER_ACTION = 5;
export const MAX_ACTIONS_PER_DAY = 3;

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

// ── admitGroup (P2 arc-posting-scheduler) ─────────────────────────────────────

/**
 * Admit a whole posting ACTION (M tweets: root + continuations + CTA) as ONE atomic
 * unit — either M budget slots are reserved AND M `outbound_action` rows are inserted
 * (status='queued', sharing one atomic_group_id), or NEITHER happens. This directly
 * kills the starvation class the quest exists to fix: a mid-thread "insufficient
 * slots" defer can never happen again, because the whole group either has headroom
 * for all M tweets or it doesn't — there is no partial-admission state.
 *
 * Does NOT auto-claim (queued→sending) the way admitAction() does — a group's rows
 * stay 'queued' until the caller drains them one at a time via claimForSend(), since
 * the actual send happens externally, one X API call per tweet, over what may be
 * several separate cli.ts invocations.
 *
 * Precise scope (dev-council/Kleppmann + Lamport): this proves ATOMIC ADMISSION only.
 * See the module header for the admission-vs-publication distinction.
 */
export function admitGroup(db: Database, opts: AdmitGroupOpts): AdmitGroupResult {
  const {
    sourceKeys, lane, threadRef, budgetDay, cap, payloadRefs, payloadHashes,
    isRootFlags, accountId, notes, earliestUtcTime, latestUtcTime, globalCap,
  } = opts;

  const m = sourceKeys.length;
  if (
    m === 0 ||
    payloadRefs.length !== m ||
    payloadHashes.length !== m ||
    isRootFlags.length !== m ||
    !isRootFlags[0]
  ) {
    return {
      ok: false, reason: "invalid_opts",
      detail: `sourceKeys/payloadRefs/payloadHashes/isRootFlags must all be length ${m}>0 and isRootFlags[0] must be true (first key is the root)`,
    };
  }

  // ── Kill-switch ───────────────────────────────────────────────────────────
  const cfg = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string } | null;
  if (!cfg || cfg.value !== "true") {
    return { ok: false, reason: "kill_switch_off", detail: `outbound_enabled=${cfg?.value ?? "missing"}` };
  }

  // ── Idempotency — whole group, not per-row (a partial re-admit would defeat the
  //    atomic-unit guarantee: if key 1 of 4 already exists, we must NOT admit keys 2-4
  //    as a smaller group under a new atomic_group_id). ─────────────────────────────
  for (const sourceKey of sourceKeys) {
    const existing = db
      .query("SELECT id, status FROM outbound_action WHERE source_key=?")
      .get(sourceKey) as { id: number; status: string } | null;
    if (existing) {
      return {
        ok: false, reason: "already_exists",
        existingId: existing.id, existingStatus: existing.status,
        detail: `source_key=${sourceKey} outbound_action id=${existing.id} status=${existing.status} — whole group rejected, not partially admitted`,
      };
    }
  }

  // ── CHECKPOINTS.md #2 shape rail: tweets/action ──────────────────────────────────
  if (m > MAX_TWEETS_PER_ACTION) {
    return {
      ok: false, reason: "group_too_large",
      detail: `M=${m} exceeds ${MAX_TWEETS_PER_ACTION} tweets/action`,
    };
  }

  // ── Atomic transaction: actions/day recheck + whole-group headroom check + reserve
  //    + insert. dev-council/Kleppmann (CONFIRMED): the actions/day COUNT DISTINCT
  //    check is only race-free if it runs INSIDE the same transaction as the
  //    reservation — read-then-act outside a txn lets two concurrent admitGroup()
  //    calls both read count=2 and both admit a 4th action. Moved inside BEGIN below
  //    (the shape-rail rejections above — invalid_opts/kill_switch/already_exists/
  //    group_too_large — are cheap, pre-DB-write checks where a race just means an
  //    occasional less-precise error message, not a correctness violation, so they
  //    stay outside the txn; ONLY the two checks that gate an actual DB mutation
  //    (actions/day, budget headroom) need transactional protection).
  const atomicGroupId = crypto.randomUUID();
  const actionIds: number[] = [];

  try {
    // dev-council/Kleppmann (P3 fix, CONFIRMED robustness gap): a plain `BEGIN` opens a
    // DEFERRED transaction — its first statement here is the SELECT below, so under real
    // concurrency a second admitter that established its read snapshot first can hit
    // SQLITE_BUSY_SNAPSHOT on this transaction's later write-upgrade, which `busy_timeout`
    // does NOT retry (it's a snapshot conflict, not a lock wait). That surfaces as a
    // spurious `admission_txn_failed` rather than a lock-wait honoring busy_timeout.
    // `BEGIN IMMEDIATE` takes the write lock up front, turning contention into a bounded
    // wait instead of an abort.
    db.exec("BEGIN IMMEDIATE");

    const actionsToday = db
      .query(
        `SELECT COUNT(DISTINCT atomic_group_id) as cnt FROM outbound_action
         WHERE lane=? AND budget_day=? AND atomic_group_id IS NOT NULL`
      )
      .get(lane, budgetDay) as { cnt: number };
    if (actionsToday.cnt >= MAX_ACTIONS_PER_DAY) {
      db.exec("ROLLBACK");
      return {
        ok: false, reason: "actions_per_day_exceeded",
        detail: `${actionsToday.cnt}/${MAX_ACTIONS_PER_DAY} actions already admitted today for lane=${lane}/${budgetDay}`,
      };
    }

    // Ensure budget row exists (caller-supplied cap — the TWEET-TOTAL cap, e.g.
    // DAILY_TWEET_CAP=6, distinct from getCapForLane()'s ROOT-only cap used by
    // admitAction()'s single-tweet post-lane path).
    db.run(
      `INSERT OR IGNORE INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
       VALUES ('x', ?, ?, 0, 0, ?)`,
      [budgetDay, lane, cap]
    );

    // CAS reserve-the-whole-group-or-nothing: reserved_count+M bound twice so the
    // UPDATE only matches (and only takes effect) if there is headroom for ALL M —
    // never a partial reservation.
    const budgetUp = db.run(
      `UPDATE budget_ledger SET reserved_count=reserved_count+?
       WHERE channel='x' AND utc_day=? AND lane=? AND reserved_count+? <= cap`,
      [m, budgetDay, lane, m]
    );
    if (budgetUp.changes !== 1) {
      db.exec("ROLLBACK");
      const current = db
        .query("SELECT reserved_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane=?")
        .get(budgetDay, lane) as { reserved_count: number; cap: number } | null;
      return {
        ok: false, reason: "budget_exhausted",
        detail: `M=${m} would exceed headroom (reserved=${current?.reserved_count ?? "?"}/${current?.cap ?? cap}) — whole group deferred, zero rows admitted`,
      };
    }

    // ── P3 arc-posting-scheduler: cross-lane global backstop (dev-council/Newman,
    //    CONFIRMED HIGH — revised from the original sentinel-row design) ───────────────
    // ORIGINAL DESIGN (superseded): a separate `lane='__global__'` sentinel row,
    // CAS-reserved alongside the per-lane row. Newman's review found this was a
    // distributed-write invariant that was ALREADY violated on day one: the pre-existing
    // legacy 'post'-lane path (cli.ts's un-migrated guard stack, still live for the
    // cadence beat and any caller that never migrates) writes its own budget_ledger
    // updates directly and was never taught to also bump the sentinel — so the "absolute
    // ceiling" was only absolute for reserve-group callers, while the legacy path could
    // independently add up to DAILY_TWEET_CAP MORE tweets on top, unseen. Worst case:
    // ~2x the intended envelope (exactly what CHECKPOINTS.md #2 says must NOT happen).
    //
    // REVISED (this fix): no sentinel row, no separate counter to keep in sync. Compute
    // the cross-lane total as a live SUM over budget_ledger — the same rows EVERY path
    // already writes (the per-lane CAS above, and the legacy path's own existing
    // dual-write) — read inside this SAME transaction, immediately after the per-lane
    // CAS succeeds (so the SUM already includes this group's own M). `lane != 'reply'`
    // preserves the pre-existing, deliberate design decision (arc-demand-gen P1, restated
    // in this module's own admitAction() docs) that replies have NEVER counted toward
    // DAILY_TWEET_CAP — a global ceiling scoped to "every tweet-producing lane except
    // replies" is what CHECKPOINTS.md #2 actually means, made explicit here rather than
    // left for a future phase to guess (P2's own carried-forward disclosure).
    if (globalCap !== undefined) {
      const crossLaneTotal = db
        .query(
          `SELECT COALESCE(SUM(reserved_count),0) as total FROM budget_ledger
           WHERE channel='x' AND utc_day=? AND lane != 'reply'`
        )
        .get(budgetDay) as { total: number };
      if (crossLaneTotal.total > globalCap) {
        db.exec("ROLLBACK");
        return {
          ok: false, reason: "global_cap_exceeded",
          detail: `cross-lane total (all non-reply lanes, INCLUDING this group's own M=${m}) = ${crossLaneTotal.total} exceeds globalCap=${globalCap} — lane=${lane} had its own headroom, but the absolute daily ceiling doesn't; whole group deferred, zero rows admitted, lane reservation rolled back too`,
        };
      }
    }

    for (let i = 0; i < m; i++) {
      const insertRes = db.run(
        `INSERT INTO outbound_action
           (source_key, platform, lane, status, payload_ref, payload_hash,
            is_root, thread_ref, defer_count, budget_day, account_id, atomic_group_id,
            earliest_utc_time, latest_utc_time, global_reserved)
         VALUES (?, 'x', ?, 'queued', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          // global_reserved is always 0 now — the global backstop (above) is a derived
          // SUM over budget_ledger, not a separately-reserved counter, so there is no
          // per-row "did this consume a global slot" fact to record anymore (dev-council/
          // Newman fix — see the comment on the global-backstop check above). The column
          // is kept in the schema (harmless, already migrated) for any historical rows.
          sourceKeys[i], lane, payloadRefs[i], payloadHashes[i],
          isRootFlags[i] ? 1 : 0, threadRef, budgetDay, accountId ?? null, atomicGroupId,
          earliestUtcTime ?? null, latestUtcTime ?? null, 0,
        ]
      );
      const actionId = insertRes.lastInsertRowid as number;
      actionIds.push(actionId);

      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'queued', ?)`,
        [actionId, notes ?? `admitted by admitGroup (lane=${lane}, atomic_group_id=${atomicGroupId}, ${i + 1}/${m})`]
      );
    }

    db.exec("COMMIT");
  } catch (err: any) {
    try { db.exec("ROLLBACK"); } catch {}
    return { ok: false, reason: "admission_txn_failed", detail: String(err?.message ?? err) };
  }

  return { ok: true, actionIds, atomicGroupId };
}

// ── claimForSend (P2 arc-posting-scheduler) ───────────────────────────────────

/**
 * Fencing CAS immediately before the actual X API POST call — distinct from
 * admitAction()'s admission-time claim. `lease_expires_at` alone (kept as-is) lets a
 * slow-not-crashed worker's lease expire while still mid-flight, so a second drainer
 * could claim the same row and BOTH call POST /tweets (Kleppmann, CONFIRMED gap — no
 * fencing token today). Calling this right before the send means a stale claim is
 * rejected at the DB layer even if the caller's own lease bookkeeping is stale.
 */
export function claimForSend(db: Database, actionId: number): boolean {
  const leaseSeconds = getConfigInt(db, "claim_lease_seconds", 300);
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const casUp = db.run(
    `UPDATE outbound_action
     SET status='sending', lease_expires_at=?, updated_at=?
     WHERE id=? AND status='queued'`,
    [leaseUntil, utcNow(), actionId]
  );
  return casUp.changes === 1;
}

// ── nextUnsentInGroup (P2 arc-posting-scheduler) ──────────────────────────────

/**
 * Resumable-drain primitive: the first not-yet-sent row in an atomic group, in post
 * order. Disclosed honestly (dev-council review): this is a DB-side primitive only —
 * true AUTOMATIC resumption after a crash still needs a caller (or a future daemon) to
 * actually query this on retry. No current caller does yet; this phase provides the
 * primitive, not the daemon.
 */
export function nextUnsentInGroup(db: Database, atomicGroupId: string): { id: number; source_key: string } | null {
  return db
    .query(
      `SELECT id, source_key FROM outbound_action
       WHERE atomic_group_id=? AND status='queued'
       ORDER BY id ASC LIMIT 1`
    )
    .get(atomicGroupId) as { id: number; source_key: string } | null;
}

// ── releaseAbandonedReservations (P2 arc-posting-scheduler) ──────────────────

export interface ReleasedRow {
  actionId: number;
  lane: string;
  budgetDay: string;
}

/**
 * Closes the reservation-release gap (Lamport/Kleppmann, CONFIRMED): admitAction()
 * and admitGroup() both only ever INCREMENT budget_ledger.reserved_count. If a
 * reservation is abandoned (lease expired mid-send, no provider_post_id ever
 * recorded), nothing released it — reserved_count inflates monotonically, causing
 * FALSE cap-exhaustion and self-starvation, the exact failure class this quest
 * fights. Finds abandoned rows (status='sending', lease expired, never sent),
 * decrements budget_ledger.reserved_count per (lane, budget_day) by the count
 * released (clamped at 0), and marks the rows 'unknown' (markUnknown's pattern).
 */
export function releaseAbandonedReservations(
  db: Database,
  opts: { leaseGraceMinutes?: number } = {}
): ReleasedRow[] {
  const graceMs = (opts.leaseGraceMinutes ?? 0) * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs).toISOString();

  // dev-council/Kleppmann (CONFIRMED gap, F3): the original version SELECTed its
  // target set OUTSIDE any transaction, then unconditionally decremented +
  // overwrote status — a slow-but-completing drainer's markSent() racing between
  // this SELECT and its UPDATE would get its just-'sent' row clobbered back to
  // 'unknown' AND double-decrement reserved_count (corrupting both ledgers,
  // under-counting reserved → over-admission → the exact SafetyBudget breach this
  // module exists to prevent). Fix: SELECT and the per-row flip both run inside ONE
  // transaction, and the flip UPDATE RE-CHECKS the same status/provider_post_id
  // conditions at write time — if a row completed in the meantime, this UPDATE's
  // `changes` is 0 and we skip it (no decrement, no clobber) rather than trusting
  // the SELECT's now-stale snapshot.
  const released: ReleasedRow[] = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    const abandoned = db
      .query(
        `SELECT id, lane, budget_day, global_reserved FROM outbound_action
         WHERE status='sending' AND provider_post_id IS NULL
           AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`
      )
      .all(cutoff) as { id: number; lane: string; budget_day: string; global_reserved: number }[];

    for (const row of abandoned) {
      const flip = db.run(
        `UPDATE outbound_action SET status='unknown', updated_at=?
         WHERE id=? AND status='sending' AND provider_post_id IS NULL`,
        [utcNow(), row.id]
      );
      if (flip.changes !== 1) continue; // raced with a concurrent completion — do not release

      // Clamp at 0 — never let a bookkeeping race drive reserved_count negative.
      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
         WHERE channel='x' AND utc_day=? AND lane=?`,
        [row.budget_day, row.lane]
      );
      // Dead branch now (global_reserved is always 0 post-Newman-fix) — see
      // GLOBAL_BACKSTOP_LANE's comment. Kept for any historical row.
      if (row.global_reserved) {
        db.run(
          `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
           WHERE channel='x' AND utc_day=? AND lane=?`,
          [row.budget_day, GLOBAL_BACKSTOP_LANE]
        );
      }
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
        [row.id, `lease expired with no send evidence — reservation released by releaseAbandonedReservations() (grace=${opts.leaseGraceMinutes ?? "n/a"}min)`]
      );
      released.push({ actionId: row.id, lane: row.lane, budgetDay: row.budget_day });
    }

    // ── P3 arc-posting-scheduler (dev-council/Kleppmann, "finding A", CONFIRMED
    //    durability gap) ─────────────────────────────────────────────────────────
    // A group reserved via admitGroup() but never drained stays `status='queued'`
    // with `lease_expires_at=NULL` FOREVER — the sweep above only targets 'sending'
    // rows with an expired lease, so a `window_not_open_yet` park (cli.ts, this
    // phase) that's then abandoned (process crash, caller never retries) leaks its
    // reservation on both the lane and the (now-derived) cross-lane total for the
    // rest of the UTC day. P2's reserve→drain gap was sub-second (same dispatch
    // turn); P3's window parking stretches that gap to up to ~an hour, widening
    // this exposure. Reclaim `queued` rows whose window has PERMANENTLY closed —
    // either a past budget_day, or today with `latest_utc_time` already behind
    // wall-clock — mirroring cli.ts's own `window_closed_no_post` logic but as a
    // caller-independent, time-based sweep rather than requiring someone to retry
    // the exact `--source`.
    const windowExpired = db
      .query(
        `SELECT id, lane, budget_day, global_reserved FROM outbound_action
         WHERE status='queued' AND latest_utc_time IS NOT NULL
           AND (budget_day < date('now')
                OR (budget_day = date('now') AND latest_utc_time < strftime('%H:%M','now')))`
      )
      .all() as { id: number; lane: string; budget_day: string; global_reserved: number }[];

    for (const row of windowExpired) {
      const flip = db.run(
        `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=? AND status='queued'`,
        [utcNow(), row.id]
      );
      if (flip.changes !== 1) continue; // raced with a concurrent claim/release — do not double-release

      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
         WHERE channel='x' AND utc_day=? AND lane=?`,
        [row.budget_day, row.lane]
      );
      if (row.global_reserved) {
        db.run(
          `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
           WHERE channel='x' AND utc_day=? AND lane=?`,
          [row.budget_day, GLOBAL_BACKSTOP_LANE]
        );
      }
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
        [row.id, `window permanently closed with no drain attempt — reservation released by releaseAbandonedReservations()'s time-based sweep`]
      );
      released.push({ actionId: row.id, lane: row.lane, budgetDay: row.budget_day });
    }

    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }

  return released;
}

// ── releaseSingleReservation (P2 arc-posting-scheduler) ───────────────────────

/**
 * Compensating action for exactly ONE row (dev-council/Fowler + Lamport, CONFIRMED
 * gap: `releaseGroupRemainder` only released a failed row's still-'queued' SIBLINGS,
 * never the failed row itself, which `claimForSend` had already flipped to
 * 'sending' — every terminal 403 leaked exactly 1 reservation). Refuses to release a
 * row that has already reached 'sent' (a concurrent success must never be clobbered).
 */
export function releaseSingleReservation(db: Database, actionId: number, reasonNote: string): boolean {
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db
      .query(`SELECT lane, budget_day, status, global_reserved FROM outbound_action WHERE id=?`)
      .get(actionId) as { lane: string; budget_day: string; status: string; global_reserved: number } | null;
    if (!row || row.status === "sent") {
      db.exec("ROLLBACK");
      return false;
    }
    // dev-council/Kleppmann (P3 fix, CONFIRMED gap): the original guard was
    // `status != 'sent'`, which ALSO matches `'unknown'` — so calling this function
    // TWICE on the same already-released row (a real risk once cli.ts's window-closed
    // branch can be reached by overlapping/retried drains) would flip 'unknown'->'unknown'
    // (a no-op status-wise) but the UPDATE still reports changes=1, so the caller would
    // decrement reserved_count a SECOND time for a slot already released — driving the
    // ledger to under-count reserved (over-admission risk, the exact failure this module
    // exists to prevent). Narrowing to `IN ('queued','sending')` makes a second call on an
    // already-'unknown' row a genuine no-op (0 rows matched, returns false, no decrement).
    const flip = db.run(
      `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=? AND status IN ('queued','sending')`,
      [utcNow(), actionId]
    );
    if (flip.changes !== 1) {
      db.exec("ROLLBACK");
      return false;
    }
    db.run(
      `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
       WHERE channel='x' AND utc_day=? AND lane=?`,
      [row.budget_day, row.lane]
    );
    // P3: release the matching cross-lane global-backstop slot too (see the identical
    // note in releaseAbandonedReservations above).
    if (row.global_reserved) {
      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - 1)
         WHERE channel='x' AND utc_day=? AND lane=?`,
        [row.budget_day, GLOBAL_BACKSTOP_LANE]
      );
    }
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
      [actionId, reasonNote]
    );
    db.exec("COMMIT");
    return true;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
}

// ── releaseGroupRemainder (P2 arc-posting-scheduler) ──────────────────────────

/**
 * Compensating action for a mid-group terminal failure (e.g. a 403 on tweet 2 of a
 * 4-tweet group — guard #4's terminal-skip-no-retry behavior, kept as-is, means the
 * rest of the group will never be sent). Releases every remaining 'queued' row
 * sharing `atomicGroupId` (marks 'unknown', decrements budget_ledger.reserved_count
 * by the count released) so the abandoned remainder doesn't inflate reserved_count
 * forever — the same leak `releaseAbandonedReservations()` closes for lease-expiry,
 * named separately here because this fires immediately at the point of failure
 * (caller-driven) rather than being discovered later by a lease-expiry sweep.
 */
export function releaseGroupRemainder(db: Database, atomicGroupId: string, reasonNote: string): ReleasedRow[] {
  // dev-council/Kleppmann (P3 fix, CONFIRMED gap): the original SELECT ran BEFORE any
  // transaction, so its snapshot could go stale if a concurrent/retried call raced this
  // one (or a legitimate drain completed a row) between the SELECT and the flip below —
  // the old code decremented budget_ledger by the STALE snapshot count regardless of
  // whether each row's flip actually took effect. Fix: SELECT, per-row flip (re-checking
  // status='queued' at write time), and the ledger decrements ALL run inside ONE
  // transaction, and the decrement amount is the ACTUAL number of rows this call flipped
  // (`changes`), never the pre-transaction snapshot count — so two overlapping calls on
  // the same group can each only release what's genuinely still 'queued' at their own
  // flip moment, never double-decrementing the same row's reservation.
  const released: ReleasedRow[] = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    const remaining = db
      .query(`SELECT id, lane, budget_day, global_reserved FROM outbound_action WHERE atomic_group_id=? AND status='queued'`)
      .all(atomicGroupId) as { id: number; lane: string; budget_day: string; global_reserved: number }[];

    if (remaining.length === 0) {
      db.exec("ROLLBACK");
      return [];
    }

    const byGroup = new Map<string, number>();
    const byGlobalDay = new Map<string, number>(); // dead-branch bookkeeping, see GLOBAL_BACKSTOP_LANE comment
    for (const row of remaining) {
      const flip = db.run(
        `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=? AND status='queued'`,
        [utcNow(), row.id]
      );
      if (flip.changes !== 1) continue; // raced with a concurrent completion/release — do not double-count
      const key = `${row.lane}|${row.budget_day}`;
      byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
      if (row.global_reserved) {
        byGlobalDay.set(row.budget_day, (byGlobalDay.get(row.budget_day) ?? 0) + 1);
      }
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
        [row.id, `atomic_group_id=${atomicGroupId} remainder released: ${reasonNote}`]
      );
      released.push({ actionId: row.id, lane: row.lane, budgetDay: row.budget_day });
    }

    for (const [key, count] of byGroup) {
      const [lane, budgetDay] = key.split("|");
      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - ?)
         WHERE channel='x' AND utc_day=? AND lane=?`,
        [count, budgetDay, lane]
      );
    }
    for (const [budgetDay, count] of byGlobalDay) {
      db.run(
        `UPDATE budget_ledger SET reserved_count = MAX(0, reserved_count - ?)
         WHERE channel='x' AND utc_day=? AND lane=?`,
        [count, budgetDay, GLOBAL_BACKSTOP_LANE]
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }

  return released;
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

/**
 * P2 arc-posting-scheduler dual-write (dev-council/Newman, CONFIRMED gap): `.bak`
 * restores roll back CODE, not ROWS written under the new schema mid-migration. If
 * cli.ts is reverted mid-soak, the OLD code reads x_post_log, not outbound_action —
 * anything sent through the new engine would be invisible to reverted code (silently
 * dropped, or double-posted since the old dedup ledger never learned about it).
 * Every successful send through admission.ts now ALSO writes an x_post_log row, so
 * x_post_log stays a complete, authoritative fallback ledger for the whole soak — a
 * code-only `.bak` rollback is then sufficient. x_post_log's schema/table is owned by
 * social-x-posting/cli.ts; we CREATE TABLE IF NOT EXISTS here defensively (same DDL
 * cli.ts uses) so this module has no hard load-order dependency on cli.ts having run
 * first in a given process.
 */
function dualWriteXPostLog(db: Database, sourceKey: string, providerPostId: string, isRoot: boolean): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS x_post_log (
       source TEXT PRIMARY KEY,
       tweet_id TEXT,
       posted_at TEXT NOT NULL,
       is_root INTEGER NOT NULL DEFAULT 0
     )`
  );
  db.run(
    `INSERT OR IGNORE INTO x_post_log (source, tweet_id, posted_at, is_root) VALUES (?, ?, ?, ?)`,
    [sourceKey, providerPostId, utcNow(), isRoot ? 1 : 0]
  );
}

/**
 * dev-council/Kleppmann (CONFIRMED gap, F2): the original version ran 4 separate
 * autocommit statements — a crash after the outbound_action UPDATE but before the
 * x_post_log dual-write left `status='sent'` with NO x_post_log row, defeating the
 * exact rollback-safety guarantee the dual-write exists for (a `.bak` code revert
 * reads an empty x_post_log and re-posts). Fix: wrap the whole function in one
 * transaction — either all four writes land, or none do, so there is no
 * crash-reachable partial state.
 */
export function markSent(db: Database, actionId: number, providerPostId: string, lane: Lane, budgetDay: string): void {
  try {
    db.exec("BEGIN");

    // Read back source_key/is_root FIRST (before the row's own status changes) so
    // callers don't need to pass them redundantly.
    const row = db
      .query("SELECT source_key, is_root FROM outbound_action WHERE id=?")
      .get(actionId) as { source_key: string; is_root: number } | null;

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
    if (row) {
      dualWriteXPostLog(db, row.source_key, providerPostId, row.is_root === 1);
    }

    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
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
