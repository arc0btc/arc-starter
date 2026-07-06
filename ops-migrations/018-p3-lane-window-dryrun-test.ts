#!/usr/bin/env bun
/**
 * 018-p3-lane-window-dryrun-test.ts
 * arc-posting-scheduler P3 — proves lane isolation, time-window storage, and the
 * cross-lane global backstop against DISPOSABLE budget_day values (2099-*), never
 * touching real production data. Modeled on P2's 014b/014c dry-run scripts.
 *
 * REVISED post-dev-council (Newman fix applied): the global backstop is no longer a
 * separate `lane='__global__'` sentinel row — it's a derived SUM over budget_ledger
 * (`WHERE lane != 'reply'`), computed live inside admitGroup()'s own transaction. Tests
 * below assert on that derived total via `crossLaneTotal()`, not a sentinel row lookup.
 * Also adds coverage for: idempotent release (Kleppmann/Lamport fixes — calling a release
 * function twice on the same row must not double-decrement), and the reply-lane exclusion
 * (a 'reply' lane reservation must NOT count toward the cross-lane total).
 *
 * Run: bun ops-migrations/018-p3-lane-window-dryrun-test.ts
 * Cleans up every row it inserts (outbound_action + engagement_log + budget_ledger for
 * the 2099-* days) at the end, even on failure.
 */
import { Database } from "bun:sqlite";
import {
  admitGroup, releaseSingleReservation, releaseGroupRemainder,
} from "../skills/social-engine/admission.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "db/arc.sqlite";
const db = new Database(DB_PATH);

const DAY_A = "2099-03-01"; // daily-read + content-calendar isolation test
const DAY_B = "2099-03-02"; // global-backstop test
const DAY_C = "2099-03-03"; // reply-lane exclusion + idempotent-release test
const DISPOSABLE_DAYS = [DAY_A, DAY_B, DAY_C];

let failures = 0;
function assertEq(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!pass) failures++;
}

function crossLaneTotal(day: string): number {
  const row = db.query(
    `SELECT COALESCE(SUM(reserved_count),0) as total FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane != 'reply'`
  ).get(day) as { total: number };
  return row.total;
}

function cleanup() {
  for (const day of DISPOSABLE_DAYS) {
    const ids = db.query(`SELECT id FROM outbound_action WHERE budget_day=?`).all(day) as { id: number }[];
    for (const { id } of ids) {
      db.run(`DELETE FROM engagement_log WHERE action_id=?`, [id]);
    }
    db.run(`DELETE FROM outbound_action WHERE budget_day=?`, [day]);
    db.run(`DELETE FROM budget_ledger WHERE utc_day=?`, [day]);
  }
}

function keys(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? `${prefix}:x` : `${prefix}:x:${i}`));
}
function opts(sourceKeys: string[]) {
  return {
    payloadRefs: sourceKeys.map((s) => `ref-${s}`),
    payloadHashes: sourceKeys.map((s) => `hash-${s}`),
    isRootFlags: sourceKeys.map((_, i) => i === 0),
  };
}

console.log("=== Pre-test cleanup (in case a prior run left rows) ===");
cleanup();

try {
  console.log("\n=== Test 1: daily-read and content-calendar reserve on SEPARATE lane budgets, same day ===");
  console.log("(globalCap=20 here deliberately generous — this test isolates the PER-LANE");
  console.log(" counters from each other; the tight cross-lane DAILY_TWEET_CAP backstop");
  console.log(" itself is exercised separately, and more realistically, in Test 2.)");
  const drKeys = keys("dr-demo", 4);
  const drResult = admitGroup(db, {
    sourceKeys: drKeys, lane: "daily-read", threadRef: drKeys[0], budgetDay: DAY_A,
    cap: 6, ...opts(drKeys), earliestUtcTime: "13:00", latestUtcTime: "14:00", globalCap: 20,
  });
  assertEq("daily-read group admitted", drResult.ok, true);

  const ccKeys = keys("cc-demo", 3);
  const ccResult = admitGroup(db, {
    sourceKeys: ccKeys, lane: "content-calendar", threadRef: ccKeys[0], budgetDay: DAY_A,
    cap: 6, ...opts(ccKeys), earliestUtcTime: "15:00", latestUtcTime: "18:00", globalCap: 20,
  });
  assertEq("content-calendar group admitted (own lane, not blocked by daily-read's)", ccResult.ok, true);

  const rows = db.query(
    `SELECT source_key, lane, earliest_utc_time, latest_utc_time FROM outbound_action WHERE budget_day=? ORDER BY id`
  ).all(DAY_A) as { source_key: string; lane: string; earliest_utc_time: string; latest_utc_time: string }[];
  assertEq("7 rows total (4 daily-read + 3 content-calendar)", rows.length, 7);
  assertEq("daily-read row window stored", rows.find((r) => r.lane === "daily-read")?.earliest_utc_time + "-" + rows.find((r) => r.lane === "daily-read")?.latest_utc_time, "13:00-14:00");
  assertEq("content-calendar row window stored", rows.find((r) => r.lane === "content-calendar")?.earliest_utc_time + "-" + rows.find((r) => r.lane === "content-calendar")?.latest_utc_time, "15:00-18:00");

  const ledgerA = db.query(`SELECT lane, reserved_count, cap FROM budget_ledger WHERE utc_day=? ORDER BY lane`).all(DAY_A) as { lane: string; reserved_count: number; cap: number }[];
  console.log("budget_ledger rows for", DAY_A, ":", ledgerA);
  const drLedger = ledgerA.find((l) => l.lane === "daily-read");
  const ccLedger = ledgerA.find((l) => l.lane === "content-calendar");
  assertEq("daily-read lane reserved_count=4 (own counter)", drLedger?.reserved_count, 4);
  assertEq("content-calendar lane reserved_count=3 (own counter, untouched by daily-read)", ccLedger?.reserved_count, 3);
  assertEq("no __global__ sentinel row exists anymore (Newman fix — derived SUM, not a stored counter)", ledgerA.some((l) => l.lane === "__global__"), false);
  assertEq("derived cross-lane total = 7 (4+3, computed live via SUM)", crossLaneTotal(DAY_A), 7);

  console.log("\n=== Test 2: global cross-lane backstop blocks a 2nd lane once combined M exceeds globalCap ===");
  // Fresh disposable day. globalCap=6. First group (lane=post) takes 5. Second group
  // (lane=content-calendar) of size 3 must be REJECTED globally (5+3=8>6) even though
  // content-calendar's OWN lane cap (6) would have allowed it alone.
  const g1Keys = keys("g1-demo", 5);
  const g1 = admitGroup(db, {
    sourceKeys: g1Keys, lane: "post", threadRef: g1Keys[0], budgetDay: DAY_B,
    cap: 6, ...opts(g1Keys), globalCap: 6,
  });
  assertEq("group 1 (post, M=5) admitted", g1.ok, true);
  assertEq("cross-lane total after group 1 = 5", crossLaneTotal(DAY_B), 5);

  const g2Keys = keys("g2-demo", 3);
  const g2 = admitGroup(db, {
    sourceKeys: g2Keys, lane: "content-calendar", threadRef: g2Keys[0], budgetDay: DAY_B,
    cap: 6, ...opts(g2Keys), globalCap: 6,
  });
  assertEq("group 2 (content-calendar, M=3) DEFERRED — global backstop, own lane had headroom", g2.ok, false);
  if (!g2.ok) assertEq("group 2 defer reason", g2.reason, "global_cap_exceeded");

  const g2Rows = db.query(`SELECT COUNT(*) as n FROM outbound_action WHERE budget_day=? AND lane='content-calendar'`).get(DAY_B) as { n: number };
  assertEq("group 2 inserted ZERO rows (whole-group rollback, not partial)", g2Rows.n, 0);

  const postLedgerB = (db.query(`SELECT reserved_count FROM budget_ledger WHERE utc_day=? AND lane='post'`).get(DAY_B) as { reserved_count: number } | null);
  assertEq("group 1's post-lane reservation untouched by group 2's rollback", postLedgerB?.reserved_count, 5);
  assertEq("cross-lane total stayed at 5 (group 2's rollback undid its own attempted +3)", crossLaneTotal(DAY_B), 5);

  console.log("\n=== Test 2b: LEGACY 'post' lane volume is now visible to the cross-lane total (the Newman/Lamport fix — previously a SEPARATE, blind counter) ===");
  // Simulate the legacy path's own dual-write incrementing the SAME 'post' lane row
  // directly (as cli.ts's un-migrated guard stack does) — the derived SUM must reflect
  // it immediately, with no separate bookkeeping required.
  db.run(`UPDATE budget_ledger SET reserved_count = reserved_count + 1 WHERE utc_day=? AND lane='post'`, [DAY_B]);
  assertEq("cross-lane total reflects the legacy lane's own direct write (5->6, no sentinel needed)", crossLaneTotal(DAY_B), 6);

  console.log("\n=== Test 3: release functions release the reservation (idempotent — a SECOND release call is a safe no-op) ===");
  const g1Row = db.query(`SELECT id FROM outbound_action WHERE source_key=?`).get(g1Keys[0]) as { id: number };
  const released = releaseSingleReservation(db, g1Row.id, "test cleanup release");
  assertEq("releaseSingleReservation succeeded", released, true);
  const postAfter = (db.query(`SELECT reserved_count FROM budget_ledger WHERE utc_day=? AND lane='post'`).get(DAY_B) as { reserved_count: number } | null);
  assertEq("post-lane reserved_count decremented 6->5 (one release)", postAfter?.reserved_count, 5);

  // dev-council/Kleppmann + Lamport (F5, CONFIRMED gap, fixed): the ORIGINAL guard
  // (`status != 'sent'`) still matched an already-released 'unknown' row, so a SECOND
  // call on the same actionId would decrement AGAIN. The fix narrows the flip guard to
  // `status IN ('queued','sending')` — a second call must now be a genuine no-op.
  const releasedAgain = releaseSingleReservation(db, g1Row.id, "test idempotency: second release attempt on the same already-released row");
  assertEq("SECOND releaseSingleReservation call on the same row returns false (idempotency fix)", releasedAgain, false);
  const postAfterSecondAttempt = (db.query(`SELECT reserved_count FROM budget_ledger WHERE utc_day=? AND lane='post'`).get(DAY_B) as { reserved_count: number } | null);
  assertEq("post-lane reserved_count UNCHANGED at 5 after the redundant second release call (no double-decrement)", postAfterSecondAttempt?.reserved_count, 5);

  console.log("\n=== Test 4: releaseGroupRemainder releases only genuinely-'queued' siblings, idempotently ===");
  const remainderReleased = releaseGroupRemainder(db, g1.ok ? g1.atomicGroupId : "", "test cleanup remainder release");
  assertEq("remainder release count (4 rows left: g1 had M=5, 1 already released above)", remainderReleased.length, 4);
  const postFinalB = (db.query(`SELECT reserved_count FROM budget_ledger WHERE utc_day=? AND lane='post'`).get(DAY_B) as { reserved_count: number } | null);
  assertEq("post-lane reserved_count back to 0 (5 released total: 1 single + 4 remainder; the +1 simulated legacy write in 2b was a separate untracked bump, expect 1 remaining)", postFinalB?.reserved_count, 1);

  // Idempotency: calling releaseGroupRemainder AGAIN on the same (now fully-drained)
  // atomic_group_id must find zero 'queued' rows left and release nothing further.
  const remainderReleasedAgain = releaseGroupRemainder(db, g1.ok ? g1.atomicGroupId : "", "test idempotency: second remainder-release call");
  assertEq("SECOND releaseGroupRemainder call on the same (drained) group releases 0 rows", remainderReleasedAgain.length, 0);
  const postAfterSecondRemainder = (db.query(`SELECT reserved_count FROM budget_ledger WHERE utc_day=? AND lane='post'`).get(DAY_B) as { reserved_count: number } | null);
  assertEq("post-lane reserved_count UNCHANGED after the redundant second remainder-release call", postAfterSecondRemainder?.reserved_count, 1);

  console.log("\n=== Test 5: the reply lane is EXCLUDED from the cross-lane global total (pre-existing, deliberate design, unchanged) ===");
  const replyKeys = keys("reply-demo", 1);
  const replyResult = admitGroup(db, {
    sourceKeys: replyKeys, lane: "reply", threadRef: replyKeys[0], budgetDay: DAY_C,
    cap: 40, ...opts(replyKeys), globalCap: 6,
  });
  assertEq("reply-lane group admitted", replyResult.ok, true);
  assertEq("cross-lane total EXCLUDES the reply lane's own reservation (stays 0, not 1)", crossLaneTotal(DAY_C), 0);

  // globalCap deliberately set to 5 here (tight, = MAX_TWEETS_PER_ACTION) — if the reply
  // lane's 1 reservation counted toward the cross-lane total, 5 (this group) + 1 (reply)
  // = 6 > globalCap(5) would correctly reject it. It must NOT reject, proving the reply
  // exclusion is real, not just "happened not to matter" at a looser cap.
  const ccKeys2 = keys("cc-demo2", 5);
  const ccResult2 = admitGroup(db, {
    sourceKeys: ccKeys2, lane: "content-calendar", threadRef: ccKeys2[0], budgetDay: DAY_C,
    cap: 6, ...opts(ccKeys2), globalCap: 5,
  });
  assertEq("a content-calendar group that exactly fills globalCap=5 still admits despite the reply reservation (proves reply truly doesn't count against the backstop)", ccResult2.ok, true);
  assertEq("cross-lane total now 5 (content-calendar only — reply still excluded)", crossLaneTotal(DAY_C), 5);

} finally {
  console.log("\n=== Cleanup ===");
  cleanup();
  const leftoverA = db.query(`SELECT COUNT(*) as n FROM outbound_action WHERE budget_day IN (?,?,?)`).get(DAY_A, DAY_B, DAY_C) as { n: number };
  const leftoverLedger = db.query(`SELECT COUNT(*) as n FROM budget_ledger WHERE utc_day IN (?,?,?)`).get(DAY_A, DAY_B, DAY_C) as { n: number };
  console.log(`Leftover outbound_action rows for disposable days: ${leftoverA.n} (expect 0)`);
  console.log(`Leftover budget_ledger rows for disposable days: ${leftoverLedger.n} (expect 0)`);
  db.close();
}

console.log(`\n=== ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
