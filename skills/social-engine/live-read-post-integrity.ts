#!/usr/bin/env bun
/**
 * live-read-post-integrity.ts
 * P4 verify: Read-only integrity gate for the post lane.
 *
 * This script MUST PASS before outbound_enabled is permitted for the post lane.
 * It runs against the live arc.sqlite (read-only — no writes).
 *
 * Checks:
 * 1. No root cap breach (today's root posts <= root_daily_cap=3)
 * 2. No continuation cap breach (per-thread continuations <= max_continuations=2)
 * 3. No expired unhandled leases in post lane
 * 4. No unbounded deferred set (no action stuck at max_defer_count without terminal skip)
 * 5. outbound_enabled = true in agent_config
 * 6. Post lane config values present in agent_config (all 4 required keys)
 *
 * On PASS: prints "PASS — post lane integrity verified" + arms post lane notice.
 * On FAIL: prints "FAIL — <failing checks>". Post lane must not be armed.
 *
 * Usage:
 *   ARC_DB_PATH=/home/dev/arc-starter/db/arc.sqlite bun live-read-post-integrity.ts
 */

import { Database } from "bun:sqlite";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const UTC_NOW = new Date().toISOString();
const TODAY = UTC_NOW.slice(0, 10);

let passed = 0;
let failed = 0;
const evidenceIds: string[] = [];

function check(label: string, result: boolean, detail: string = "") {
  const status = result ? "PASS" : "FAIL";
  const mark = result ? "+" : "!";
  console.log(`[${status}] ${mark} ${label}${detail ? " — " + detail : ""}`);
  if (result) passed++;
  else failed++;
}

function getConfigValue(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM agent_config WHERE key=?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

function getConfigInt(db: Database, key: string, fallback: number): number {
  const v = getConfigValue(db, key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

console.log("=== arc-social-engine live-read-post-integrity ===");
console.log(`UTC: ${UTC_NOW}`);
console.log(`DB: ${DB_PATH}`);
console.log("");

// Open read-only (no WAL changes needed — just reads)
const db = new Database(DB_PATH, { readonly: true });

// ── Check 1: No root cap breach ──────────────────────────────────────────────
console.log("--- Check 1: Root cap (today's roots <= root_daily_cap) ---");
{
  const rootDailyCap = getConfigInt(db, "root_daily_cap", 3);
  const rootCount = db
    .query(
      `SELECT COUNT(*) as cnt FROM outbound_action
       WHERE lane='post' AND is_root=1 AND budget_day=?
         AND status IN ('queued','sending','sent')`
    )
    .get(TODAY) as { cnt: number };

  const isOk = rootCount.cnt <= rootDailyCap;
  check(
    `Root count today (${rootCount.cnt}) <= cap (${rootDailyCap})`,
    isOk,
    `roots=${rootCount.cnt}/${rootDailyCap} for ${TODAY}`
  );
  if (!isOk) {
    evidenceIds.push(`root_cap_breach: ${rootCount.cnt}/${rootDailyCap} on ${TODAY}`);
  }
}

// ── Check 2: No continuation cap breach ──────────────────────────────────────
console.log("\n--- Check 2: Continuation cap (per-thread <= max_continuations) ---");
{
  const maxCont = getConfigInt(db, "max_continuations", 2);
  const threads = db
    .query(
      `SELECT thread_ref, COUNT(*) as cnt FROM outbound_action
       WHERE lane='post' AND is_root=0 AND thread_ref IS NOT NULL
         AND status IN ('queued','sending','sent')
       GROUP BY thread_ref
       HAVING COUNT(*) > ?`
    )
    .all(maxCont) as { thread_ref: string; cnt: number }[];

  const isOk = threads.length === 0;
  check(
    `No thread exceeds max_continuations (${maxCont})`,
    isOk,
    isOk ? "all threads within cap" : `BREACH: ${threads.map(t => `${t.thread_ref}=${t.cnt}`).join(", ")}`
  );
  if (!isOk) {
    threads.forEach(t => evidenceIds.push(`cont_cap_breach: thread=${t.thread_ref} cnt=${t.cnt}/${maxCont}`));
  }
}

// ── Check 3: No expired unhandled leases ─────────────────────────────────────
console.log("\n--- Check 3: No expired unhandled leases in post lane ---");
{
  const expired = db
    .query(
      `SELECT id, source_key, lease_expires_at FROM outbound_action
       WHERE lane='post' AND status='sending'
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at < datetime('now')`
    )
    .all() as { id: number; source_key: string; lease_expires_at: string }[];

  const isOk = expired.length === 0;
  check(
    `No expired leases in sending status`,
    isOk,
    isOk ? "no expired leases" : `${expired.length} expired: ${expired.map(r => `id=${r.id}`).join(", ")}`
  );
  if (!isOk) {
    expired.forEach(r => evidenceIds.push(`expired_lease: action_id=${r.id} expired=${r.lease_expires_at}`));
  }
}

// ── Check 4: No unbounded deferred set ───────────────────────────────────────
console.log("\n--- Check 4: No unbounded deferred set ---");
{
  const maxDefer = getConfigInt(db, "max_defer_count", 3);

  // Count deferred (queued with defer_count > 0)
  const deferredCount = db
    .query(
      `SELECT COUNT(*) as cnt FROM outbound_action
       WHERE lane='post' AND status='queued' AND defer_count > 0`
    )
    .get() as { cnt: number };

  // Check for stuck rows: defer_count >= max_defer_count but NOT skipped
  const stuck = db
    .query(
      `SELECT id, source_key, defer_count, status FROM outbound_action
       WHERE lane='post' AND defer_count >= ? AND status != 'skipped'`
    )
    .all(maxDefer) as { id: number; source_key: string; defer_count: number; status: string }[];

  const stuckOk = stuck.length === 0;
  const deferWarn = deferredCount.cnt > 10;

  check(
    `No stuck deferred actions (defer_count >= max but not skipped)`,
    stuckOk,
    stuckOk ? `deferred_total=${deferredCount.cnt}` : `${stuck.length} stuck: ${stuck.map(r => `id=${r.id} cnt=${r.defer_count}`).join(", ")}`
  );
  if (deferWarn && stuckOk) {
    console.log(`  [WARN] High deferred count: ${deferredCount.cnt} actions deferred (>10 threshold)`);
  }
  if (!stuckOk) {
    stuck.forEach(r => evidenceIds.push(`stuck_deferred: action_id=${r.id} defer_count=${r.defer_count} status=${r.status}`));
  }
}

// ── Check 5: outbound_enabled = true ─────────────────────────────────────────
console.log("\n--- Check 5: outbound_enabled = true ---");
{
  const enabled = getConfigValue(db, "outbound_enabled");
  const isOk = enabled === "true";
  check(
    `outbound_enabled is 'true'`,
    isOk,
    `outbound_enabled=${enabled ?? "missing"}`
  );
  if (!isOk) evidenceIds.push(`kill_switch_off: outbound_enabled=${enabled}`);
}

// ── Check 6: Post lane config values present ─────────────────────────────────
console.log("\n--- Check 6: Post lane config values present in agent_config ---");
{
  const requiredKeys = ["root_daily_cap", "max_continuations", "claim_lease_seconds", "max_defer_count"];
  let allPresent = true;
  const vals: string[] = [];

  for (const key of requiredKeys) {
    const val = getConfigValue(db, key);
    const present = val !== null;
    if (!present) {
      allPresent = false;
      evidenceIds.push(`missing_config: ${key}`);
    }
    vals.push(`${key}=${val ?? "MISSING"}`);
  }

  check(
    `All 4 post lane config keys present`,
    allPresent,
    vals.join(", ")
  );
}

db.close();

// ── Verdict ───────────────────────────────────────────────────────────────────
console.log("");
console.log("=== VERDICT ===");
console.log(`UTC: ${new Date().toISOString()}`);
console.log(`Checks: ${passed + failed} total | ${passed} PASS | ${failed} FAIL`);

if (failed === 0) {
  console.log("");
  console.log("PASS — post lane integrity verified.");
  console.log(`POST LANE ARMED: outbound_enabled=true; post lane is permitted for up to root_daily_cap=3 roots/day.`);
  console.log(`Evidence IDs: ${evidenceIds.length === 0 ? "none (clean)" : evidenceIds.join("; ")}`);
  console.log(`UTC: ${new Date().toISOString()}`);
  process.exit(0);
} else {
  console.log("");
  console.log("FAIL — post lane NOT armed. Resolve failing checks before enabling post lane.");
  console.log(`Failing evidence: ${evidenceIds.join("; ")}`);
  console.log(`UTC: ${new Date().toISOString()}`);
  process.exit(1);
}
