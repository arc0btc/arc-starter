#!/usr/bin/env bun
/**
 * live-read-control-reply.ts
 * P3 verify: Control reply round-trip — read-only query against live arc.sqlite.
 *
 * Proves:
 * 1. Exactly ONE outbound_action with source_key='engage:out:reply:x:2047404386931081563'
 * 2. status='sent', provider_post_id IS NOT NULL (the actual X post ID)
 * 3. Exactly ONE budget_ledger row for (x, today, reply) with reserved_count >= 1
 * 4. engagement_log contains: queued + claimed + sent + reconciled for this action_id
 *
 * Note on action_id=2 (unknown): This is the first attempt (thread 2066575910606868826,
 * blocked by X API 403 — outside Arc's conversation scope). Per §3, budget consumed,
 * status=unknown. Discord alert sent: message_id=1517668497738432612.
 *
 * Run: cd /home/whoabuddy/manage-agents && bun ops/verify/social-engine/live-read-control-reply.ts
 * Reads arc.sqlite from VM — must run on management host with access to arc.sqlite copy,
 * OR run the --vm version via SSH on the VM.
 *
 * For VM run:
 *   ssh dev@192.168.1.10 '/home/dev/.bun/bin/bun /home/dev/arc-starter/skills/social-engine/live-read-control-reply.ts'
 */

import { Database } from "bun:sqlite";

// When run on host, we need the DB path; when run on VM, default to live path.
const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const EXPECTED_SOURCE_KEY = "engage:out:reply:x:2047404386931081563";
const EXPECTED_THREAD_REF = "2047404386931081563";

let passed = 0;
let failed = 0;

function check(label: string, result: boolean, detail: string = "") {
  const status = result ? "PASS" : "FAIL";
  const mark = result ? "+" : "!";
  console.log(`[${status}] ${mark} ${label}${detail ? " — " + detail : ""}`);
  if (result) passed++;
  else failed++;
}

console.log("=== arc-social-engine P3 live-read-control-reply ===");
console.log(`UTC: ${new Date().toISOString()}`);
console.log(`DB: ${DB_PATH}`);
console.log("");

const db = new Database(DB_PATH, { readonly: true });

// ── 1. Outbound action exists and is singular ─────────────────────────────────
const actions = db
  .query("SELECT id, source_key, status, provider_post_id, thread_ref, budget_day, account_id FROM outbound_action WHERE source_key=?")
  .all(EXPECTED_SOURCE_KEY) as Array<{
    id: number;
    source_key: string;
    status: string;
    provider_post_id: string | null;
    thread_ref: string | null;
    budget_day: string;
    account_id: number | null;
  }>;

check(
  "Exactly ONE outbound_action for control source_key",
  actions.length === 1,
  `found=${actions.length}, source_key=${EXPECTED_SOURCE_KEY}`
);

const action = actions[0];
if (!action) {
  console.log("\nFATAL: No control action found. Cannot continue.");
  db.close();
  process.exit(1);
}

// ── 2. Status is 'sent' ───────────────────────────────────────────────────────
check(
  "Control action status='sent'",
  action.status === "sent",
  `status=${action.status}`
);

// ── 3. Provider post ID is set ────────────────────────────────────────────────
const hasProviderId = action.provider_post_id !== null && action.provider_post_id.length > 0;
check(
  "provider_post_id is set (not null)",
  hasProviderId,
  hasProviderId ? `provider_post_id=${action.provider_post_id}` : "null"
);

// ── 4. Thread ref matches ─────────────────────────────────────────────────────
check(
  `thread_ref=${EXPECTED_THREAD_REF}`,
  action.thread_ref === EXPECTED_THREAD_REF,
  `actual=${action.thread_ref}`
);

// ── 5. Budget ledger has a reply reservation for today ────────────────────────
const today = new Date().toISOString().slice(0, 10);
const budget = db
  .query("SELECT reserved_count, sent_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='reply'")
  .get(today) as { reserved_count: number; sent_count: number; cap: number } | null;

check(
  "budget_ledger reply row exists for today",
  budget !== null,
  budget ? `reserved=${budget.reserved_count}/${budget.cap} sent=${budget.sent_count}` : "no row"
);

if (budget) {
  check(
    "budget_ledger reserved_count >= 1 (control reply reservation present)",
    budget.reserved_count >= 1,
    `reserved_count=${budget.reserved_count}`
  );
  check(
    "budget_ledger sent_count >= 1 (control reply debited)",
    budget.sent_count >= 1,
    `sent_count=${budget.sent_count}`
  );
}

// ── 6. engagement_log has required events ─────────────────────────────────────
const events = db
  .query("SELECT id, event_type, notes FROM engagement_log WHERE action_id=? ORDER BY id")
  .all(action.id) as Array<{ id: number; event_type: string; notes: string | null }>;

const eventTypes = events.map((e) => e.event_type);
const hasQueued = eventTypes.includes("queued");
const hasClaimed = eventTypes.includes("claimed");
const hasSent = eventTypes.includes("sent");
const hasReconciled = eventTypes.includes("reconciled");

check(
  "engagement_log has 'queued' event",
  hasQueued,
  `events=[${eventTypes.join(",")}]`
);
check("engagement_log has 'claimed' event (CAS)", hasClaimed, `events=[${eventTypes.join(",")}]`);
check("engagement_log has 'sent' event", hasSent, `events=[${eventTypes.join(",")}]`);
check(
  "engagement_log has 'reconciled' event",
  hasReconciled,
  `events=[${eventTypes.join(",")}]`
);

// ── 7. No duplicate source_key ────────────────────────────────────────────────
const allSameKey = db
  .query("SELECT COUNT(*) as cnt FROM outbound_action WHERE source_key=?")
  .get(EXPECTED_SOURCE_KEY) as { cnt: number };
check(
  "UNIQUE constraint: only 1 row for this source_key",
  allSameKey.cnt === 1,
  `count=${allSameKey.cnt}`
);

// ── 8. kill switch state ──────────────────────────────────────────────────────
const killSwitch = db
  .query("SELECT value FROM agent_config WHERE key='outbound_enabled'")
  .get() as { value: string } | null;
check(
  "kill switch outbound_enabled=true (not tripped)",
  killSwitch?.value === "true",
  `value=${killSwitch?.value ?? "missing"}`
);

db.close();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("");
console.log("=== SUMMARY ===");
console.log(`UTC: ${new Date().toISOString()}`);
console.log(`Checks: ${passed + failed} total | ${passed} PASS | ${failed} FAIL`);
if (failed === 0) {
  console.log("");
  console.log("Evidence:");
  console.log(`  provider_post_id: ${action.provider_post_id}`);
  console.log(`  outbound_action.id: ${action.id}`);
  console.log(`  source_key: ${action.source_key}`);
  console.log(`  engagement_log events: [${eventTypes.join(",")}]`);
  console.log(`  engagement_log ids: [${events.map((e) => e.id).join(",")}]`);
  if (budget) {
    console.log(`  budget reserved=${budget.reserved_count}/${budget.cap} sent=${budget.sent_count}`);
  }
  console.log("");
  console.log("PASS — Control reply round-trip verified.");
}
process.exit(failed > 0 ? 1 : 0);
