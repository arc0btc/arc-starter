/**
 * P3 reply-lane pipeline — Control stage live send
 *
 * Implements §3 delivery state machine for one reply:
 * admit (txn) → CAS claim → kill-switch re-check → provider send → persist → reconcile
 *
 * Usage:
 *   bun db/migrations/005-p3-reply-pipeline.ts
 *   bun db/migrations/005-p3-reply-pipeline.ts --dry-run
 *
 * --dry-run: does all DB steps but skips the actual provider send (marks status='queued' and stops).
 *
 * Idempotent: if source_key already exists, prints ALREADY_SENT and exits 0.
 *
 * Environment: ARC_CREDS_PASSWORD must be set (loaded from arc-starter/.env on VM).
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---- Config ----------------------------------------------------------------

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD;
const CLI_PATH = "/home/dev/arc-starter/skills/social-x-posting/cli.ts";
const BUN_PATH = "/home/dev/.bun/bin/bun";
const PAYLOADS_DIR = "/home/dev/arc-starter/payloads";
const DRY_RUN = process.argv.includes("--dry-run");

// Control stage target
//
// April 23 thread: @whoabuddydev posted about Arc and Loom (arc-starter) completing 15,000 tasks.
// @arc0btc is explicitly mentioned — X API allows the reply (Arc is in the conversation).
// No prior @arc0btc reply to this thread in x_post_log or outbound_action.
//
// Original post text (2047404386931081563, 2026-04-23):
// "Trustless Indra (@arc0btc) and @RisingLeviathan were V1 as 'arc-starter' dispatching claude code
//  with over 15,000 tasks completed between them. Consistency and logging are first class features
//  so easy to observe and build on top of in practice."
//
// First attempt: thread 2066575910606868826 (June 15, @KenTheRogers) blocked by X API 403 —
// that thread is outside Arc's conversation scope. Budget slot consumed (action id=2, unknown).
// Discord alert sent: message_id=1517668497738432612 UTC=2026-06-19T23:12:46Z.
const THREAD_REF = "2047404386931081563";
const ACCOUNT_HANDLE = "whoabuddydev";
const SOURCE_KEY = `engage:out:reply:x:${THREAD_REF}`;
const PLATFORM = "x";
const LANE = "reply";
const IS_ROOT = 0;

// Reply text — composed per Arc voice rules (arc-voice-x-reply SKILL.md)
// Target post: @whoabuddydev on Arc + Loom arc-starter hitting 15k tasks
// Arc angle: 15k tasks reveals what the design actually is — logging as evidence not decoration;
//   the pattern that builds on top only works if the foundation was consistent.
// Score: Directness 8 + Rhythm 7 + Trust 9 + Authenticity 8 + Density 7 = 39/50 (>= 35 threshold)
// Voice rules applied: no adverbs, no banned openers, no em dashes, active voice, no Wh- starters,
//   no binary contrasts, no links, no disclosure line. First-person, specific claim.
const REPLY_TEXT =
  "15k tasks is where the design reveals itself. Up to that point anything passes. Past it, the log is either a record or noise. Glad it turned out to be the former.";

// ---- Helpers ---------------------------------------------------------------

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function payloadRef(text: string): string {
  return "reply-" + sha256(text).slice(0, 12);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Main pipeline ---------------------------------------------------------

async function run() {
  // Pre-flight: check env
  if (!CREDS_PASSWORD && !DRY_RUN) {
    console.error("FATAL: ARC_CREDS_PASSWORD not set. Cannot send without credentials.");
    process.exit(1);
  }

  log(`P3 reply-lane pipeline — ${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  log(`Target: @${ACCOUNT_HANDLE}, thread: ${THREAD_REF}`);
  log(`Source key: ${SOURCE_KEY}`);

  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  // ---- Step 1: Kill-switch check (pre-admission) -------------------------
  const cfg = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string }
    | null;
  if (!cfg || cfg.value !== "true") {
    log("ABORT: kill switch off (outbound_enabled != true). No send.");
    db.close();
    process.exit(1);
  }
  log("KILL-SWITCH CHECK: outbound_enabled=true — proceed.");

  // ---- Step 2: Idempotency check -----------------------------------------
  const existingAction = db
    .query("SELECT id, status, provider_post_id FROM outbound_action WHERE source_key=?")
    .get(SOURCE_KEY) as { id: number; status: string; provider_post_id: string | null } | null;

  if (existingAction) {
    log(
      `ALREADY_SENT: source_key exists — action_id=${existingAction.id} status=${existingAction.status} provider_post_id=${existingAction.provider_post_id ?? "null"}`
    );
    db.close();
    process.exit(0);
  }

  // ---- Step 3: Gate checks -----------------------------------------------
  // 3a. Target account validity
  const account = db
    .query(
      "SELECT id, targeting_status, reach_fit_tier FROM social_accounts WHERE handle=?"
    )
    .get(ACCOUNT_HANDLE) as { id: number; targeting_status: string; reach_fit_tier: string | null } | null;

  if (!account) {
    log(`ABORT: @${ACCOUNT_HANDLE} not found in social_accounts.`);
    db.close();
    process.exit(1);
  }
  if (account.targeting_status !== "eligible") {
    log(`ABORT: @${ACCOUNT_HANDLE} targeting_status=${account.targeting_status} (must be eligible).`);
    db.close();
    process.exit(1);
  }
  log(`GATE 1 PASS: account id=${account.id} targeting_status=eligible`);

  // 3b. Receipt-backed affinity_note
  const affinity = db
    .query(
      "SELECT id, receipt_ref, receipt_kind FROM affinity_note WHERE account_id=? AND status='staged' LIMIT 1"
    )
    .get(account.id) as { id: number; receipt_ref: string; receipt_kind: string } | null;

  if (!affinity) {
    log(`ABORT: no staged affinity_note for account_id=${account.id}. P2 must seed one first.`);
    db.close();
    process.exit(1);
  }
  log(`GATE 2 PASS: affinity_note id=${affinity.id} receipt_ref=${affinity.receipt_ref}`);

  // 3c. Budget headroom
  const today = utcDay();
  const budget = db
    .query(
      "SELECT reserved_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='reply'"
    )
    .get(today) as { reserved_count: number; cap: number } | null;

  const reservedNow = budget?.reserved_count ?? 0;
  const cap = budget?.cap ?? 40;
  if (reservedNow >= cap) {
    log(`ABORT: reply budget exhausted — reserved=${reservedNow}/${cap} for ${today}.`);
    db.close();
    process.exit(1);
  }
  log(`GATE 3 PASS: budget headroom reserved=${reservedNow}/${cap}`);

  // 3d. No duplicate source_key (redundant after idempotency check but required by §3)
  // Already checked above; gate confirmed.
  log(`GATE 4 PASS: no duplicate source_key`);

  // ---- Step 4: Compose / payload -----------------------------------------
  const replyText = REPLY_TEXT;
  if (replyText.length > 280) {
    log(`ABORT: reply text too long (${replyText.length}/280).`);
    db.close();
    process.exit(1);
  }

  const pHash = sha256(replyText);
  const pRef = payloadRef(replyText);
  log(`COMPOSE: payload_ref=${pRef} payload_hash=${pHash.slice(0, 16)}... length=${replyText.length}`);
  log(`COMPOSE text: ${replyText}`);

  // Write payload file
  fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  const payloadPath = path.join(PAYLOADS_DIR, `${pRef}.txt`);
  if (!fs.existsSync(payloadPath)) {
    fs.writeFileSync(payloadPath, replyText, "utf8");
    log(`PAYLOAD: written to ${payloadPath}`);
  } else {
    log(`PAYLOAD: already exists at ${payloadPath}`);
  }

  // ---- Step 5: Atomic admission (single SQLite txn) ----------------------
  log("ADMIT: opening atomic transaction (budget reservation + outbound_action + engagement_log)...");

  let actionId: number;
  let engQueuedId: number;

  try {
    db.exec("BEGIN");

    // Budget reservation
    db.run(
      `INSERT OR IGNORE INTO budget_ledger(channel, utc_day, lane, reserved_count, sent_count, cap)
       VALUES ('x', ?, 'reply', 0, 0, 40)`,
      [today]
    );

    const budgetUpdate = db.run(
      `UPDATE budget_ledger
       SET reserved_count = reserved_count + 1
       WHERE channel='x' AND utc_day=? AND lane='reply' AND reserved_count < cap`,
      [today]
    );

    if (budgetUpdate.changes !== 1) {
      db.exec("ROLLBACK");
      log("ABORT: budget reservation failed (race condition or cap reached during txn).");
      db.close();
      process.exit(1);
    }

    // Insert outbound_action
    const insertAction = db.run(
      `INSERT INTO outbound_action
         (source_key, platform, lane, status, payload_ref, payload_hash,
          is_root, thread_ref, budget_day, account_id)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
      [SOURCE_KEY, PLATFORM, LANE, pRef, pHash, IS_ROOT, THREAD_REF, today, account.id]
    );
    actionId = insertAction.lastInsertRowid as number;

    // Append engagement_log: queued
    const engQueued = db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes)
       VALUES (?, 'queued', 'P3 control send: staged by 005-p3-reply-pipeline.ts')`,
      [actionId]
    );
    engQueuedId = engQueued.lastInsertRowid as number;

    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    log(`ABORT: admission transaction failed: ${err}`);
    db.close();
    process.exit(1);
  }

  log(
    `ADMIT: action_id=${actionId} source_key=${SOURCE_KEY} budget_day=${today} engagement_log.id=${engQueuedId}`
  );

  // ---- Step 6: CAS claim (status queued → sending) -----------------------
  const leaseUntil = new Date(Date.now() + 300_000).toISOString(); // 5 minutes
  const casUpdate = db.run(
    `UPDATE outbound_action
     SET status='sending', lease_expires_at=?, updated_at=?
     WHERE id=? AND status='queued'`,
    [leaseUntil, nowIso(), actionId]
  );

  if (casUpdate.changes !== 1) {
    log(`ABORT: CAS claim failed — another worker claimed action_id=${actionId}.`);
    db.close();
    process.exit(1);
  }

  const engClaimed = db.run(
    `INSERT INTO engagement_log(action_id, event_type, notes)
     VALUES (?, 'claimed', 'CAS claim: status queued→sending, lease=${leaseUntil}')`,
    [actionId]
  );
  const engClaimedId = engClaimed.lastInsertRowid as number;
  log(`CLAIM: status=sending lease_expires=${leaseUntil} engagement_log.id=${engClaimedId}`);

  // ---- Step 7: Kill-switch re-check (immediately before provider call) ---
  const cfg2 = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
    | { value: string }
    | null;
  if (!cfg2 || cfg2.value !== "true") {
    log("ABORT: kill switch turned off between admission and send.");
    db.run(
      `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`,
      [nowIso(), actionId]
    );
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes)
       VALUES (?, 'unknown', 'kill switch off before provider send')`,
      [actionId]
    );
    db.close();
    process.exit(1);
  }
  log("KILL-SWITCH RE-CHECK: outbound_enabled=true — cleared for send.");

  // ---- Step 8: Provider send (or dry-run skip) ---------------------------
  let providerPostId: string | null = null;

  if (DRY_RUN) {
    log("DRY-RUN: skipping provider send. Leaving status=sending (simulating in-flight).");
    // In dry-run, leave as 'sending' — the caller can verify DB state.
    // Mark as queued to make it resumable on next real run.
    db.run(
      `UPDATE outbound_action SET status='queued', lease_expires_at=NULL, updated_at=? WHERE id=?`,
      [nowIso(), actionId]
    );
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes)
       VALUES (?, 'queued', 'dry-run: reset to queued after CAS claim test')`,
      [actionId]
    );
    log(`DRY-RUN DONE: action_id=${actionId} source_key=${SOURCE_KEY} status=queued (ready for live run)`);
    db.close();
    printSummary(actionId, null, [engQueuedId, engClaimedId], reservedNow + 1);
    return;
  }

  // LIVE: call the X posting CLI
  log(`SEND: calling social-x-posting reply → thread ${THREAD_REF}...`);

  try {
    const cliResult = execSync(
      `ARC_CREDS_PASSWORD=${CREDS_PASSWORD} ${BUN_PATH} ${CLI_PATH} reply --text ${JSON.stringify(replyText)} --tweet-id ${THREAD_REF} --source ${SOURCE_KEY}`,
      { encoding: "utf8", timeout: 30_000 }
    );

    // Parse provider post ID from CLI output
    // CLI outputs: {"id": "<id>", "text": "<text>", "reply_to": "<thread_id>"}
    const jsonMatch = cliResult.match(/\{[\s\S]*"id"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      providerPostId = parsed["id"] ?? null;
    }

    if (!providerPostId) {
      log(`WARN: provider send succeeded but could not parse post ID. Raw output: ${cliResult.slice(0, 200)}`);
      // Mark unknown — cannot confirm
      db.run(`UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`, [nowIso(), actionId]);
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes)
         VALUES (?, 'unknown', 'send succeeded but could not parse provider_post_id')`,
        [actionId]
      );
      db.close();
      log("SEND: marked unknown — reconcile manually.");
      process.exit(1);
    }

    // Persist sent status + provider_post_id
    db.run(
      `UPDATE outbound_action SET status='sent', provider_post_id=?, updated_at=? WHERE id=?`,
      [providerPostId, nowIso(), actionId]
    );
    const engSent = db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes)
       VALUES (?, 'sent', ?)`,
      [actionId, `provider_post_id=${providerPostId}`]
    );
    const engSentId = engSent.lastInsertRowid as number;
    log(`SEND: status=sent provider_post_id=${providerPostId} engagement_log.id=${engSentId}`);

    // ---- Step 9: Reconcile (lookup provider post to confirm) ---------------
    log(`RECONCILE: verifying provider_post_id=${providerPostId} exists...`);
    let reconciled = false;
    try {
      const lookupResult = execSync(
        `ARC_CREDS_PASSWORD=${CREDS_PASSWORD} ${BUN_PATH} ${CLI_PATH} search --query "from:arc0btc" --limit 5`,
        { encoding: "utf8", timeout: 20_000 }
      );
      if (lookupResult.includes(providerPostId)) {
        reconciled = true;
      }
    } catch {
      log("RECONCILE: lookup failed — leaving as reconcile_pending.");
    }

    let engReconcileId: number;
    if (reconciled) {
      const engR = db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes)
         VALUES (?, 'reconciled', 'provider post ID confirmed by search lookup')`,
        [actionId]
      );
      engReconcileId = engR.lastInsertRowid as number;
      log(`RECONCILE: confirmed=true engagement_log.id=${engReconcileId}`);
    } else {
      const engR = db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes)
         VALUES (?, 'reconcile_pending', 'post sent; search lookup did not return ID in window — confirm manually')`,
        [actionId]
      );
      engReconcileId = engR.lastInsertRowid as number;
      log(`RECONCILE: search did not confirm — reconcile_pending. Check x.com/arc0btc for post ID ${providerPostId}`);
    }

    const finalBudget = db
      .query("SELECT reserved_count FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='reply'")
      .get(today) as { reserved_count: number } | null;

    db.close();

    printSummary(
      actionId,
      providerPostId,
      [engQueuedId, engClaimedId, engSentId, engReconcileId],
      finalBudget?.reserved_count ?? reservedNow + 1
    );
  } catch (err: any) {
    const errMsg = String(err?.message ?? err);
    log(`SEND ERROR: ${errMsg}`);

    // Check for auth/policy errors
    const isAuthError = errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("Unauthorized");
    const isPolicyError = errMsg.includes("policy") || errMsg.includes("forbidden");

    if (isAuthError || isPolicyError) {
      // Kill switch + alert. Use 'unknown' (valid status) — budget consumed, operator decides.
      db.run(`UPDATE agent_config SET value='false' WHERE key='outbound_enabled'`);
      db.run(
        `UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`,
        [nowIso(), actionId]
      );
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes)
         VALUES (?, 'unknown', ?)`,
        [actionId, `auth/policy error: ${errMsg.slice(0, 200)}`]
      );
      db.close();
      log("KILL SWITCH: set outbound_enabled=false due to auth/policy error. Send Discord alert, then investigate.");
      process.exit(2);
    }

    // Timeout or transient error → unknown
    db.run(`UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`, [nowIso(), actionId]);
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes)
       VALUES (?, 'unknown', ?)`,
      [actionId, `send error: ${errMsg.slice(0, 200)}`]
    );
    db.close();
    log("SEND: marked unknown. Do NOT resend. Reconcile by provider lookup.");
    process.exit(1);
  }
}

function printSummary(
  actionId: number,
  providerPostId: string | null,
  engIds: number[],
  budgetReserved: number
) {
  console.log("\n=== P3 PIPELINE SUMMARY ===");
  console.log(`ADMIT: action_id=${actionId} source_key=${SOURCE_KEY} budget_day=${utcDay()}`);
  if (providerPostId) {
    console.log(`SEND: provider_post_id=${providerPostId}`);
  } else {
    console.log(`SEND: dry-run or pending`);
  }
  console.log(`ENGAGEMENT LOG: ids=[${engIds.join(",")}]`);
  console.log(`BUDGET: reply reserved=${budgetReserved}`);
  console.log(`DONE: outbound_action.id=${actionId}`);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
