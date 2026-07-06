#!/usr/bin/env bun
/**
 * 015-p2-cutover-budget-ledger-backfill.ts
 * arc-posting-scheduler P2 — one-time cutover backfill for budget_ledger's 'post' lane.
 *
 * dev-council/Newman (CONFIRMED, HIGH — implementation review, most severe P2 finding):
 * cli.ts's P1 reservation guard's `todayCount` was refactored (this phase) to read
 * `budget_ledger`'s aggregate instead of `x_post_log`. budget_ledger's 'post' lane row
 * starts EMPTY for a UTC day the first time this code runs against it. If any legacy
 * post already wrote to `x_post_log` on the SAME calendar day BEFORE this code deployed
 * (the norm — content-calendar's early-UTC burst is documented in
 * docs/specs/2026-07-05-posting-scheduler-design.md §0), guard #3 and the absolute
 * DAILY_TWEET_CAP check would see phantom headroom on cutover day and could admit
 * tweets past the REAL cap. This is not a hypothetical: on 2026-07-05 (this deploy's own
 * day), x_post_log already showed 6/6 real content-calendar tweets from 00:03-00:04 UTC
 * before this migration ran.
 *
 * Fix: seed budget_ledger's ('x', <today's utc_day>, 'post') row from x_post_log's
 * actual count for that day, ONCE. Idempotent: if a row already exists for
 * (channel='x', utc_day=<today>, lane='post'), this is a no-op (does not overwrite
 * live data written by real traffic since the backfill first ran).
 *
 * Usage (on the Arc VM, run once at/after P2 cutover):
 *   export PATH="$HOME/.bun/bin:$PATH"
 *   cd ~/arc-starter
 *   bun ops-migrations/015-p2-cutover-budget-ledger-backfill.ts
 */

import { Database } from "bun:sqlite";

const DB_PATH = process.env.ARC_DB_PATH ?? "db/arc.sqlite";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function main() {
  const db = new Database(DB_PATH);

  const existing = db
    .query(`SELECT reserved_count, sent_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=date('now') AND lane='post'`)
    .get() as { reserved_count: number; sent_count: number; cap: number } | null;

  if (existing) {
    log(`budget_ledger row for lane='post'/today already exists (reserved=${existing.reserved_count}, sent=${existing.sent_count}, cap=${existing.cap}) — no-op (idempotent, not overwriting live data).`);
    db.close();
    return;
  }

  const todayCount = (db.query(`SELECT COUNT(*) as n FROM x_post_log WHERE date(posted_at)=date('now')`).get() as { n: number }).n;
  log(`x_post_log real count for today: ${todayCount}`);

  db.run(
    `INSERT INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
     VALUES ('x', date('now'), 'post', ?, ?, 6)`,
    [todayCount, todayCount]
  );

  const after = db
    .query(`SELECT * FROM budget_ledger WHERE channel='x' AND utc_day=date('now') AND lane='post'`)
    .get();
  log(`Backfilled: ${JSON.stringify(after)}`);

  db.close();
}

main();
