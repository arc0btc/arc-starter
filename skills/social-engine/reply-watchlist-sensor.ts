/**
 * skills/social-engine/reply-watchlist-sensor.ts
 *
 * One-shot watchlist reply-guy sensor for arc-m0-sales-push P1.
 * NOTE: P4 autonomy gap — real-time tweet scanning requires persistent loop.
 * This is the conservative ramp implementation for P1.
 *
 * Usage:
 *   bun skills/social-engine/reply-watchlist-sensor.ts [--dry-run]
 */

import { Database } from "bun:sqlite";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const DRY_RUN = process.argv.includes("--dry-run");

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [reply-watchlist-sensor] ${msg}`);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

interface WatchlistAccount {
  id: number;
  handle: string;
  reach_fit_tier: string | null;
}

function repliedToAuthorToday(db: Database, accountId: number): boolean {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db.query(`
    SELECT oa.id FROM outbound_action oa
    WHERE oa.account_id=? AND oa.lane='reply' AND oa.created_at >= ?
    AND oa.status IN ('sent', 'queued', 'claiming')
  `).get([accountId, since]) as { id: number } | null;
  return row !== null;
}

function getRemainingBudget(db: Database): number {
  const today = utcDay();
  const capRow = db.query("SELECT value FROM agent_config WHERE key='reply_daily_cap'").get() as { value: string } | null;
  const cap = capRow ? parseInt(capRow.value, 10) : 5;
  const ledger = db.query(
    "SELECT reserved_count FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='reply'"
  ).get(today) as { reserved_count: number } | null;
  const used = ledger?.reserved_count ?? 0;
  return Math.max(0, cap - used);
}

async function run() {
  log(`Starting${DRY_RUN ? " (DRY-RUN)" : ""}`);

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  // Check kill switch
  const ksRow = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
  if (ksRow?.value === "false") {
    log("Kill switch OFF — outbound_enabled=false. Exiting.");
    db.close();
    return;
  }

  // Get watchlist accounts (follow_state='following' AND targeting_status='eligible')
  const accounts = db.query(`
    SELECT id, handle, reach_fit_tier
    FROM social_accounts
    WHERE follow_state='following'
    AND targeting_status='eligible'
    ORDER BY id
  `).all() as WatchlistAccount[];

  log(`Found ${accounts.length} watchlist accounts`);

  const budget = getRemainingBudget(db);
  log(`Reply budget remaining: ${budget}`);

  if (budget === 0) {
    log("Reply budget exhausted for today. Exiting.");
    db.close();
    return;
  }

  let processed = 0;
  for (const account of accounts) {
    if (processed >= budget) {
      log(`Budget reached (${budget}). Stopping.`);
      break;
    }

    if (repliedToAuthorToday(db, account.id)) {
      log(`@${account.handle}: already replied today (per-author 24h dedup). Skipping.`);
      continue;
    }

    // P4 autonomy gap: real-time tweet scanning would go here.
    // For P1: log the account as scanned; replies are fired by manual targeting
    // (see ops/verify artifact for which threads were replied to).
    log(`@${account.handle} (tier=${account.reach_fit_tier ?? "none"}): scanned — P4 autonomy gap: real-time tweet search pending autonomous loop`);
    processed++;
  }

  log(`Sensor scan complete. Accounts scanned: ${processed}. P1 conservative ramp: manual targeting. See ops/verify for reply log.`);
  db.close();
}

run().catch((e) => {
  console.error("[reply-watchlist-sensor] Fatal:", e.message);
  process.exit(1);
});
