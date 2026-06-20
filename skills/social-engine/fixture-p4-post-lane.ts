#!/usr/bin/env bun
/**
 * fixture-p4-post-lane.ts
 * P4 verify: Fixture-only tests for post-lane admission machine.
 *
 * ALL tests run on a COPY of arc.sqlite — never touch the live DB.
 *
 * Proves:
 * 1. CAS: single winner under overlapping claims
 * 2. Root cap: ≤3 roots/day enforced (4th admission rejected)
 * 3. Continuation cap: ≤2 per thread enforced (3rd rejected)
 * 4. Defer sets strictly-future UTC budget_day + rejects same-day defer
 * 5. Terminal skip after 3rd defer (max_defer_count=3)
 * 6. Pre-send failure returns to queued while lease valid (§3.5)
 * 7. Ambiguous-send → unknown; same source_key cannot be re-admitted (never auto-resent)
 *
 * Run: bun ops/verify/social-engine/fixture-p4-post-lane.ts
 */

import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  admitAction, deferAction, killSwitchRecheck, markUnknown, retryToQueued
} from "./admission.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const FIXTURE_DIR = "/tmp";

let passed = 0;
let failed = 0;
const START_UTC = new Date().toISOString();

function check(label: string, result: boolean, detail: string = "") {
  const status = result ? "PASS" : "FAIL";
  const mark = result ? "+" : "!";
  console.log(`[${status}] ${mark} ${label}${detail ? " — " + detail : ""}`);
  if (result) passed++;
  else failed++;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function payloadRef(text: string): string {
  return "post-" + sha256(text).slice(0, 12);
}

function makeFixture(tag: string): { fpath: string; db: Database } {
  const ts = Date.now();
  const fpath = path.join(FIXTURE_DIR, `arc-fixture-p4-${tag}-${ts}.db`);
  execSync(`cp ${DB_PATH} ${fpath}`);
  const db = new Database(fpath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  return { fpath, db };
}

function cleanup(fpath: string) {
  try {
    fs.unlinkSync(fpath);
    if (fs.existsSync(fpath + "-shm")) fs.unlinkSync(fpath + "-shm");
    if (fs.existsSync(fpath + "-wal")) fs.unlinkSync(fpath + "-wal");
  } catch {}
}

function insertTestPost(db: Database, opts: {
  sourceKey: string;
  isRoot?: boolean;
  threadRef?: string | null;
  status?: string;
  budgetDay?: string;
  deferCount?: number;
  leasePast?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const pr = "post-" + sha256(opts.sourceKey).slice(0, 12);
  const ph = sha256(opts.sourceKey);
  const leaseExpiresAt = opts.leasePast
    ? new Date(Date.now() - 60_000).toISOString()  // expired 1 min ago
    : new Date(Date.now() + 300_000).toISOString();  // 5 min from now

  const res = db.run(
    `INSERT INTO outbound_action
       (source_key, platform, lane, status, payload_ref, payload_hash,
        is_root, thread_ref, defer_count, budget_day, lease_expires_at)
     VALUES (?, 'x', 'post', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.sourceKey, opts.status ?? "queued", pr, ph,
      opts.isRoot !== false ? 1 : 0,
      opts.threadRef ?? null,
      opts.deferCount ?? 0,
      opts.budgetDay ?? today,
      opts.status === "sending" ? leaseExpiresAt : null,
    ]
  );
  return res.lastInsertRowid as number;
}

function ensureBudget(db: Database, lane: string, cap: number, reserved: number, budgetDay?: string) {
  const day = budgetDay ?? new Date().toISOString().slice(0, 10);
  db.run(
    `INSERT OR REPLACE INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
     VALUES ('x', ?, ?, ?, 0, ?)`,
    [day, lane, reserved, cap]
  );
}

console.log("=== arc-social-engine P4 fixture-p4-post-lane ===");
console.log(`UTC: ${START_UTC}`);
console.log(`Source DB: ${DB_PATH}`);
console.log("");

// ── Test 1: CAS single winner under overlapping claims ────────────────────────
console.log("--- Test 1: CAS single winner under overlapping claims ---");
{
  const { fpath, db } = makeFixture("cas-winner");
  const today = new Date().toISOString().slice(0, 10);
  const SOURCE_KEY = "post:out:root:x:test-cas-winner-fixture";

  // Insert one queued post-lane action
  insertTestPost(db, { sourceKey: SOURCE_KEY, status: "queued", budgetDay: today });
  ensureBudget(db, "post", 3, 0);

  // Two concurrent CAS claim attempts (simulate by running the UPDATE twice)
  const leaseUntil = new Date(Date.now() + 300_000).toISOString();
  const utcNow = new Date().toISOString();

  const id = db.query("SELECT id FROM outbound_action WHERE source_key=?").get(SOURCE_KEY) as { id: number };

  const claim1 = db.run(
    `UPDATE outbound_action SET status='sending', lease_expires_at=?, updated_at=?
     WHERE id=? AND status='queued'`,
    [leaseUntil, utcNow, id.id]
  );
  const claim2 = db.run(
    `UPDATE outbound_action SET status='sending', lease_expires_at=?, updated_at=?
     WHERE id=? AND status='queued'`,
    [leaseUntil, utcNow, id.id]
  );

  check("First CAS claim succeeds (changes=1)", claim1.changes === 1, `changes=${claim1.changes}`);
  check("Second CAS claim fails (changes=0)", claim2.changes === 0, `changes=${claim2.changes}`);

  // Confirm row is in 'sending' status
  const row = db.query("SELECT status FROM outbound_action WHERE source_key=?").get(SOURCE_KEY) as { status: string };
  check("Action is in 'sending' status after CAS", row?.status === "sending", `status=${row?.status}`);

  db.close();
  cleanup(fpath);
}

// ── Test 2: Root cap ≤3/day ───────────────────────────────────────────────────
console.log("\n--- Test 2: Root cap (≤3 roots/day) enforced ---");
{
  const { fpath, db } = makeFixture("root-cap");
  const today = new Date().toISOString().slice(0, 10);

  // Insert 3 root posts for today (at cap)
  for (let i = 1; i <= 3; i++) {
    insertTestPost(db, {
      sourceKey: `post:out:root:x:test-root-cap-${i}`,
      isRoot: true, status: "queued", budgetDay: today
    });
  }
  ensureBudget(db, "post", 3, 3);

  // Try to admit a 4th root post
  const text4 = "fourth root post attempt";
  const pr4 = payloadRef(text4);
  const result = admitAction(db, {
    sourceKey: `post:out:root:x:${pr4}`,
    lane: "post", isRoot: true, threadRef: null,
    payloadRef: pr4, payloadHash: sha256(text4),
    budgetDay: today, notes: "test root cap 4th"
  });

  check("4th root post admission rejected", !result.ok, result.ok ? "admitted — BUG" : `reason=${result.reason}`);
  if (!result.ok) {
    check(
      "Rejection reason is root_cap_exceeded",
      result.reason === "root_cap_exceeded",
      `reason=${result.reason}`
    );
  }

  // Verify count is still 3
  const count = db.query(
    "SELECT COUNT(*) as cnt FROM outbound_action WHERE lane='post' AND is_root=1 AND budget_day=? AND status IN ('queued','sending','sent')"
  ).get(today) as { cnt: number };
  check("Root count unchanged (still 3) after rejected admission", count.cnt === 3, `cnt=${count.cnt}`);

  db.close();
  cleanup(fpath);
}

// ── Test 3: Continuation cap ≤2/thread ────────────────────────────────────────
console.log("\n--- Test 3: Continuation cap (≤2 per thread) enforced ---");
{
  const { fpath, db } = makeFixture("cont-cap");
  const today = new Date().toISOString().slice(0, 10);
  const THREAD_REF = "test-thread-ref-12345";

  // Insert root post first
  insertTestPost(db, {
    sourceKey: `post:out:root:x:test-cont-cap-root`,
    isRoot: true, status: "sent", budgetDay: today
  });

  // Insert 2 continuations (at cap)
  for (let i = 1; i <= 2; i++) {
    insertTestPost(db, {
      sourceKey: `post:out:thread:x:${THREAD_REF}:${i}`,
      isRoot: false, threadRef: THREAD_REF, status: "queued", budgetDay: today
    });
  }
  ensureBudget(db, "post", 3, 3);

  // Try to admit a 3rd continuation for same thread
  const text3 = "third continuation attempt";
  const pr3 = payloadRef(text3);
  const result = admitAction(db, {
    sourceKey: `post:out:thread:x:${THREAD_REF}:3`,
    lane: "post", isRoot: false, threadRef: THREAD_REF,
    payloadRef: pr3, payloadHash: sha256(text3),
    budgetDay: today, notes: "test cont cap 3rd"
  });

  check("3rd continuation admission rejected", !result.ok, result.ok ? "admitted — BUG" : `reason=${result.reason}`);
  if (!result.ok) {
    check(
      "Rejection reason is continuation_cap_exceeded",
      result.reason === "continuation_cap_exceeded",
      `reason=${result.reason}`
    );
  }

  // Count continuations still 2
  const count = db.query(
    "SELECT COUNT(*) as cnt FROM outbound_action WHERE lane='post' AND thread_ref=? AND is_root=0 AND status IN ('queued','sending','sent')"
  ).get(THREAD_REF) as { cnt: number };
  check("Continuation count unchanged (2) after rejection", count.cnt === 2, `cnt=${count.cnt}`);

  db.close();
  cleanup(fpath);
}

// ── Test 4: Defer sets strictly-future UTC budget_day ─────────────────────────
console.log("\n--- Test 4: Defer sets strictly-future UTC budget_day ---");
{
  const { fpath, db } = makeFixture("defer-future");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  // Admit a post-lane action
  ensureBudget(db, "post", 3, 0);
  const text = "deferrable post content";
  const pr = payloadRef(text);
  const admitResult = admitAction(db, {
    sourceKey: `post:out:root:x:${pr}`,
    lane: "post", isRoot: true, threadRef: null,
    payloadRef: pr, payloadHash: sha256(text),
    budgetDay: today, notes: "test defer"
  });
  check("Admission for defer test succeeds", admitResult.ok, admitResult.ok ? `id=${admitResult.actionId}` : `reason=${(admitResult as any).reason}`);

  if (admitResult.ok) {
    const actionId = admitResult.actionId;

    // Return to queued first (so defer can act on it)
    retryToQueued(db, actionId, "test setup: return to queued for defer test");

    // Defer to tomorrow (valid — strictly future)
    const deferResult = deferAction(db, { actionId, newBudgetDay: tomorrow, currentDeferCount: 0 });
    check("Defer to tomorrow succeeds", deferResult.ok, deferResult.ok ? `newDeferCount=${(deferResult as any).newDeferCount}` : `reason=${(deferResult as any).reason}`);

    if (deferResult.ok && !deferResult.terminal) {
      check("defer_count incremented to 1", deferResult.newDeferCount === 1, `newDeferCount=${deferResult.newDeferCount}`);

      // Verify budget_day changed to tomorrow
      const row = db.query("SELECT budget_day, defer_count, status FROM outbound_action WHERE id=?").get(actionId) as
        { budget_day: string; defer_count: number; status: string } | null;
      check("budget_day set to tomorrow", row?.budget_day === tomorrow, `budget_day=${row?.budget_day}`);
      check("status is queued after defer", row?.status === "queued", `status=${row?.status}`);

      // Verify engagement_log has 'deferred' event
      const deferLog = db.query(
        "SELECT event_type, notes FROM engagement_log WHERE action_id=? AND event_type='deferred'"
      ).get(actionId) as { event_type: string; notes: string } | null;
      check("engagement_log has 'deferred' event", deferLog !== null, deferLog ? `notes=${deferLog.notes}` : "no deferred event");
    }

    // Try to defer with same-day budget_day (must fail)
    const sameDayResult = deferAction(db, { actionId, newBudgetDay: today, currentDeferCount: 1 });
    check(
      "Same-day defer rejected (not strictly future)",
      !sameDayResult.ok && (sameDayResult as any).reason === "not_future_day",
      `ok=${sameDayResult.ok} reason=${(sameDayResult as any).reason}`
    );
  }

  db.close();
  cleanup(fpath);
}

// ── Test 5: Terminal skip after 3rd defer (max_defer_count=3) ─────────────────
console.log("\n--- Test 5: Terminal skip after 3rd defer ---");
{
  const { fpath, db } = makeFixture("terminal-skip");
  const today = new Date().toISOString().slice(0, 10);

  // Seed successive future days
  const days = [
    new Date(Date.now() + 1 * 86_400_000).toISOString().slice(0, 10),
    new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
  ];

  ensureBudget(db, "post", 3, 0);
  const text = "terminal defer test post";
  const pr = payloadRef(text);
  const admitResult = admitAction(db, {
    sourceKey: `post:out:root:x:${pr}`,
    lane: "post", isRoot: true, threadRef: null,
    payloadRef: pr, payloadHash: sha256(text),
    budgetDay: today, notes: "test terminal skip"
  });
  check("Admission for terminal skip test succeeds", admitResult.ok, admitResult.ok ? `id=${admitResult.actionId}` : `reason=${(admitResult as any).reason}`);

  if (admitResult.ok) {
    const actionId = admitResult.actionId;
    // Return to queued for defers
    retryToQueued(db, actionId, "test setup");

    // Defer 1 (defer_count 0 → 1)
    const d1 = deferAction(db, { actionId, newBudgetDay: days[0], currentDeferCount: 0 });
    check("1st defer succeeds (non-terminal)", d1.ok && !(d1 as any).terminal, d1.ok ? `deferCount=${(d1 as any).newDeferCount}` : `reason=${(d1 as any).reason}`);

    // Defer 2 (defer_count 1 → 2)
    const d2 = deferAction(db, { actionId, newBudgetDay: days[1], currentDeferCount: 1 });
    check("2nd defer succeeds (non-terminal)", d2.ok && !(d2 as any).terminal, d2.ok ? `deferCount=${(d2 as any).newDeferCount}` : `reason=${(d2 as any).reason}`);

    // Defer 3 (defer_count 2 → terminal)
    const d3 = deferAction(db, { actionId, newBudgetDay: days[2], currentDeferCount: 2 });
    check("3rd defer is terminal", d3.ok && (d3 as any).terminal === true, d3.ok ? `terminal=${(d3 as any).terminal}` : `reason=${(d3 as any).reason}`);

    if (d3.ok) {
      check("Terminal reason is max_defer_count_reached", (d3 as any).reason === "max_defer_count_reached", `reason=${(d3 as any).reason}`);
    }

    // Verify status='skipped' and defer_count=3
    const row = db.query("SELECT status, defer_count FROM outbound_action WHERE id=?").get(actionId) as
      { status: string; defer_count: number } | null;
    check("status='skipped' after 3rd defer", row?.status === "skipped", `status=${row?.status}`);
    check("defer_count=3 after 3 defers", row?.defer_count === 3, `defer_count=${row?.defer_count}`);

    // Verify engagement_log has 'skipped' event
    const skipLog = db.query(
      "SELECT event_type, notes FROM engagement_log WHERE action_id=? AND event_type='skipped'"
    ).get(actionId) as { event_type: string; notes: string } | null;
    check("engagement_log has 'skipped' event", skipLog !== null, skipLog ? `notes=${skipLog.notes}` : "no skipped event");
  }

  db.close();
  cleanup(fpath);
}

// ── Test 6: Pre-send failure returns to queued while lease valid (§3.5) ───────
console.log("\n--- Test 6: Pre-send failure returns to queued (lease valid) ---");
{
  const { fpath, db } = makeFixture("pre-send-retry");
  const today = new Date().toISOString().slice(0, 10);

  ensureBudget(db, "post", 3, 0);
  const text = "pre-send failure test post";
  const pr = payloadRef(text);
  const admitResult = admitAction(db, {
    sourceKey: `post:out:root:x:${pr}`,
    lane: "post", isRoot: true, threadRef: null,
    payloadRef: pr, payloadHash: sha256(text),
    budgetDay: today, notes: "test pre-send retry"
  });
  check("Admission for pre-send retry test succeeds", admitResult.ok, admitResult.ok ? `id=${admitResult.actionId}` : `reason=${(admitResult as any).reason}`);

  if (admitResult.ok) {
    const actionId = admitResult.actionId;

    // Row should be in 'sending' with a fresh lease
    const before = db.query("SELECT status, lease_expires_at FROM outbound_action WHERE id=?").get(actionId) as
      { status: string; lease_expires_at: string } | null;
    check("Action is in 'sending' after CAS claim", before?.status === "sending", `status=${before?.status}`);

    // Simulate pre-send failure (lease still valid) → return to queued
    const returned = retryToQueued(db, actionId, "simulated pre-send failure (network timeout before API call)");
    check("retryToQueued returns true while lease valid", returned === true, `returned=${returned}`);

    // Verify status='queued' and no lease
    const after = db.query("SELECT status, lease_expires_at FROM outbound_action WHERE id=?").get(actionId) as
      { status: string; lease_expires_at: string | null } | null;
    check("Status returned to 'queued'", after?.status === "queued", `status=${after?.status}`);
    check("lease_expires_at cleared", after?.lease_expires_at === null, `lease_expires_at=${after?.lease_expires_at}`);

    // Verify engagement_log has pre-send recovery event
    const retryLog = db.query(
      "SELECT event_type, notes FROM engagement_log WHERE action_id=? AND event_type='queued' ORDER BY id DESC LIMIT 1"
    ).get(actionId) as { event_type: string; notes: string } | null;
    check("engagement_log has retry 'queued' event", retryLog !== null, retryLog?.notes ?? "no event");
  }

  db.close();
  cleanup(fpath);
}

// ── Test 7: Ambiguous send → unknown; never auto-resent ───────────────────────
console.log("\n--- Test 7: Ambiguous send → unknown; never auto-resent ---");
{
  const { fpath, db } = makeFixture("ambiguous-send");
  const today = new Date().toISOString().slice(0, 10);

  ensureBudget(db, "post", 3, 0);
  const text = "ambiguous send test post";
  const pr = payloadRef(text);
  const sourceKey = `post:out:root:x:${pr}`;

  const admitResult = admitAction(db, {
    sourceKey,
    lane: "post", isRoot: true, threadRef: null,
    payloadRef: pr, payloadHash: sha256(text),
    budgetDay: today, notes: "test ambiguous send"
  });
  check("Admission for ambiguous-send test succeeds", admitResult.ok, admitResult.ok ? `id=${admitResult.actionId}` : `reason=${(admitResult as any).reason}`);

  if (admitResult.ok) {
    const actionId = admitResult.actionId;

    // Simulate: send was attempted but outcome is ambiguous (crash between send and record)
    // Lease expires → mark as unknown
    markUnknown(db, actionId, "provider ambiguous send: process crashed between API call and record");

    // Verify status='unknown'
    const row = db.query("SELECT status FROM outbound_action WHERE id=?").get(actionId) as
      { status: string } | null;
    check("Status is 'unknown' after ambiguous send", row?.status === "unknown", `status=${row?.status}`);

    // Try to re-admit same source_key (must be blocked by idempotency)
    const reAdmit = admitAction(db, {
      sourceKey,
      lane: "post", isRoot: true, threadRef: null,
      payloadRef: pr, payloadHash: sha256(text),
      budgetDay: today, notes: "re-admit attempt — must be blocked"
    });
    check(
      "Re-admission of unknown source_key blocked (already_exists)",
      !reAdmit.ok && (reAdmit as any).reason === "already_exists",
      reAdmit.ok ? "admitted — BUG (double-post risk)" : `reason=${(reAdmit as any).reason}`
    );

    // Verify count is still 1 (no new row)
    const count = db.query("SELECT COUNT(*) as cnt FROM outbound_action WHERE source_key=?").get(sourceKey) as
      { cnt: number };
    check("Only one outbound_action row for unknown key", count.cnt === 1, `cnt=${count.cnt}`);

    // Verify engagement_log has 'unknown' event
    const unknownLog = db.query(
      "SELECT event_type, notes FROM engagement_log WHERE action_id=? AND event_type='unknown'"
    ).get(actionId) as { event_type: string; notes: string } | null;
    check("engagement_log has 'unknown' event", unknownLog !== null, unknownLog?.notes ?? "no event");
  }

  db.close();
  cleanup(fpath);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("");
console.log("=== SUMMARY ===");
console.log(`UTC: ${new Date().toISOString()}`);
console.log(`Checks: ${passed + failed} total | ${passed} PASS | ${failed} FAIL`);
if (failed === 0) {
  console.log("PASS — All P4 post-lane fixture tests passed.");
} else {
  console.log("FAIL — Some P4 post-lane fixture tests failed. Review output above.");
}
process.exit(failed > 0 ? 1 : 0);
