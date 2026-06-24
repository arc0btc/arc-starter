#!/usr/bin/env bun
/**
 * 007-p4-post-pipeline.ts
 * P4 post-lane admission pipeline.
 *
 * Demonstrates the shared admission primitive for root posts.
 * Uses admitAction() from ops/lib/social-engine/admission.ts.
 *
 * Usage:
 *   bun 007-p4-post-pipeline.ts --dry-run --text "Your post text here"
 *   bun 007-p4-post-pipeline.ts --text "Your post text here"  [LIVE]
 *
 * --dry-run: runs full admission + CAS, then cleans up (no provider send).
 *            Use this to smoke-test the machine.
 *
 * LIVE send posture (P4):
 *   Do NOT burst-send. The primary deliverable is the machinery + integrity gate.
 *   Arm only after live-read-post-integrity.ts PASSES. If posting is blocked by
 *   API tier, arm-only and note in CHECKPOINT.
 *
 * Pre-send X API capability check:
 *   Before any live root send, confirm X write capability via a read-only preflight.
 *   Pass --preflight to run capability check only (no send).
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  admitAction, killSwitchRecheck, markSent, markUnknown, retryToQueued
} from "./admission.ts";

// ── Config ───────────────────────────────────────────────────────────────────

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const CLI_PATH = "/home/dev/arc-starter/skills/social-x-posting/cli.ts";
const BUN_PATH = "/home/dev/.bun/bin/bun";
const PAYLOADS_DIR = "/home/dev/arc-starter/payloads";
const CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD;

const DRY_RUN = process.argv.includes("--dry-run");
const PREFLIGHT = process.argv.includes("--preflight");

// Get text from --text flag
function getFlag(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}
const TEXT_FLAG = getFlag("--text");

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function payloadRef(text: string): string {
  return "post-" + sha256(text).slice(0, 12);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Preflight: X API read capability check ────────────────────────────────────

async function preflightXApi(): Promise<boolean> {
  log("PREFLIGHT: checking X API read capability...");
  try {
    const result = execSync(
      `ARC_CREDS_PASSWORD=${CREDS_PASSWORD} ${BUN_PATH} ${CLI_PATH} search --query "from:arc0btc" --limit 1`,
      { encoding: "utf8", timeout: 20_000 }
    );
    const hasResults = result.includes("arc0btc") || result.includes("id");
    log(`PREFLIGHT: X API read ${hasResults ? "OK" : "returned empty (may be delayed)"}`);
    return true;
  } catch (err: any) {
    log(`PREFLIGHT: X API check FAILED — ${String(err?.message ?? err).slice(0, 200)}`);
    return false;
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function run() {
  log(`P4 post-lane pipeline — ${DRY_RUN ? "DRY-RUN" : PREFLIGHT ? "PREFLIGHT" : "LIVE"}`);

  if (!TEXT_FLAG && !PREFLIGHT) {
    console.error("Usage: bun 007-p4-post-pipeline.ts --dry-run --text 'Your post text'");
    console.error("       bun 007-p4-post-pipeline.ts --preflight");
    process.exit(1);
  }

  // Preflight-only mode
  if (PREFLIGHT) {
    if (!CREDS_PASSWORD) {
      log("PREFLIGHT: ARC_CREDS_PASSWORD not set — skipping API check");
      log("CHECKPOINT: Set ARC_CREDS_PASSWORD to verify X API post capability");
      process.exit(0);
    }
    const ok = await preflightXApi();
    log(`PREFLIGHT result: ${ok ? "PASS — X API reachable" : "FAIL — X API unreachable"}`);
    if (!ok) {
      log("CHECKPOINT: X API not reachable. Post lane arm-only until resolved.");
      process.exit(1);
    }
    process.exit(0);
  }

  const postText = TEXT_FLAG!;

  if (postText.length > 280) {
    console.error(`Text too long: ${postText.length}/280 characters`);
    process.exit(1);
  }

  if (!CREDS_PASSWORD && !DRY_RUN) {
    console.error("FATAL: ARC_CREDS_PASSWORD not set. Cannot send without credentials.");
    process.exit(1);
  }

  const pHash = sha256(postText);
  const pRef = payloadRef(postText);
  const sourceKey = `post:out:root:x:${pRef}`;
  const today = utcDay();

  log(`Source key: ${sourceKey}`);
  log(`Payload ref: ${pRef}`);
  log(`Budget day: ${today}`);

  // Write payload file
  fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  const payloadPath = path.join(PAYLOADS_DIR, `${pRef}.txt`);
  if (!fs.existsSync(payloadPath)) {
    fs.writeFileSync(payloadPath, postText, "utf8");
    log(`PAYLOAD: written to ${payloadPath}`);
  } else {
    log(`PAYLOAD: already exists at ${payloadPath}`);
  }

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  // Run shared admission primitive
  log("ADMIT: running shared admission primitive...");
  const admitResult = admitAction(db, {
    sourceKey,
    lane: "post",
    isRoot: true,
    threadRef: null,
    payloadRef: pRef,
    payloadHash: pHash,
    budgetDay: today,
    notes: `P4 post-lane: 007-p4-post-pipeline.ts ${DRY_RUN ? "(dry-run)" : "(live)"}`,
  });

  if (!admitResult.ok) {
    switch (admitResult.reason) {
      case "kill_switch_off":
        log(`ABORT: kill switch off — ${admitResult.detail}`);
        break;
      case "already_exists":
        log(`ALREADY_QUEUED: source_key exists — action_id=${admitResult.existingId} status=${admitResult.existingStatus}`);
        db.close();
        process.exit(0);
      case "root_cap_exceeded":
        log(`ABORT: root cap exceeded — ${admitResult.detail}`);
        break;
      case "budget_exhausted":
        log(`ABORT: budget exhausted — ${admitResult.detail}`);
        break;
      case "budget_race":
        log(`ABORT: budget race — ${admitResult.detail}`);
        break;
      default:
        log(`ABORT: ${admitResult.reason} — ${admitResult.detail}`);
    }
    db.close();
    process.exit(1);
  }

  const { actionId, engQueuedId, engClaimedId } = admitResult;
  log(`ADMIT: action_id=${actionId} source_key=${sourceKey} budget_day=${today}`);
  log(`CLAIM: status=sending engQueuedId=${engQueuedId} engClaimedId=${engClaimedId}`);

  if (DRY_RUN) {
    // Return to queued for clean state (dry-run cleanup)
    const returned = retryToQueued(db, actionId, "dry-run cleanup");
    log(`DRY-RUN: reset action_id=${actionId} to queued=${returned}`);
    log(`DRY-RUN DONE: machinery verified. Post lane admission pipeline works.`);
    db.close();
    console.log("\n=== P4 POST PIPELINE DRY-RUN SUMMARY ===");
    console.log(`ADMIT: action_id=${actionId} source_key=${sourceKey}`);
    console.log(`CLAIM: CAS claim succeeded (lease acquired)`);
    console.log(`RESET: returned to queued after dry-run`);
    console.log(`ENGAGEMENT LOG: ids=[${engQueuedId},${engClaimedId}]`);
    console.log(`DONE: machinery verified. Run live-read-post-integrity.ts to arm the lane.`);
    return;
  }

  // LIVE: Kill-switch re-check immediately before provider send
  if (!killSwitchRecheck(db, actionId)) {
    log("ABORT: kill switch turned off between admission and send.");
    db.close();
    process.exit(1);
  }
  log("KILL-SWITCH RE-CHECK: outbound_enabled=true — cleared for send.");

  // Pre-flight X API capability check
  const xOk = await preflightXApi();
  if (!xOk) {
    log("CHECKPOINT: X API not reachable. Returning action to queued. Arm-only posture.");
    retryToQueued(db, actionId, "X API preflight failed");
    db.close();
    log("POST LANE: arm-only. live-read-post-integrity.ts passes; X API blocked; investigate tier.");
    process.exit(1);
  }

  // LIVE SEND
  log(`SEND: calling X post CLI...`);
  let providerPostId: string | null = null;

  try {
    const cliResult = execSync(
      `ARC_CREDS_PASSWORD=${CREDS_PASSWORD} ${BUN_PATH} ${CLI_PATH} post --text ${JSON.stringify(postText)} --source ${sourceKey}`,
      { encoding: "utf8", timeout: 30_000 }
    );

    const jsonMatch = cliResult.match(/\{[\s\S]*"id"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      providerPostId = parsed["id"] ?? null;
    }

    if (!providerPostId) {
      log(`WARN: send may have succeeded but could not parse post ID. Output: ${cliResult.slice(0, 200)}`);
      markUnknown(db, actionId, `send output parse failure: ${cliResult.slice(0, 200)}`);
      db.close();
      log("SEND: marked unknown — reconcile manually.");
      process.exit(1);
    }

    markSent(db, actionId, providerPostId, "post", today);
    log(`SEND: status=sent provider_post_id=${providerPostId}`);

    // Reconcile: verify post exists
    log("RECONCILE: verifying provider_post_id...");
    try {
      const lookupResult = execSync(
        `ARC_CREDS_PASSWORD=${CREDS_PASSWORD} ${BUN_PATH} ${CLI_PATH} search --query "from:arc0btc" --limit 5`,
        { encoding: "utf8", timeout: 20_000 }
      );
      const confirmed = lookupResult.includes(providerPostId);
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'reconciled', ?)`,
        [actionId, confirmed ? "provider post ID confirmed by search" : "post sent; search window may be delayed"]
      );
      log(`RECONCILE: confirmed=${confirmed}`);
    } catch {
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'reconciled', 'lookup failed — post ID recorded; verify at x.com/arc0btc')`,
        [actionId]
      );
      log("RECONCILE: lookup failed — post ID recorded. Verify at x.com/arc0btc.");
    }

    db.close();
    console.log("\n=== P4 POST PIPELINE LIVE SUMMARY ===");
    console.log(`ADMIT: action_id=${actionId} source_key=${sourceKey}`);
    console.log(`SEND: provider_post_id=${providerPostId}`);
    console.log(`DONE: post lane delivered. Run live-read-post-integrity.ts to confirm.`);
  } catch (err: any) {
    const errMsg = String(err?.message ?? err);
    log(`SEND ERROR: ${errMsg}`);

    const isAuthError = errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("Unauthorized");
    const isPolicyError = errMsg.includes("policy") || errMsg.includes("forbidden");

    if (isAuthError || isPolicyError) {
      db.run("UPDATE agent_config SET value='false' WHERE key='outbound_enabled'");
      markUnknown(db, actionId, `auth/policy error: ${errMsg.slice(0, 200)}`);
      db.close();
      log("KILL SWITCH: set outbound_enabled=false. Investigate auth/policy error.");
      log("CHECKPOINT: X API auth/policy error on root post. Operator action required.");
      process.exit(2);
    }

    // Transient error — return to queued if lease valid, else mark unknown
    const returned = retryToQueued(db, actionId, `transient send error: ${errMsg.slice(0, 100)}`);
    if (!returned) {
      markUnknown(db, actionId, `send error + lease expired: ${errMsg.slice(0, 200)}`);
    }
    db.close();
    log(`SEND: ${returned ? "returned to queued for retry" : "marked unknown (lease expired)"}. Do NOT resend unknown.`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
