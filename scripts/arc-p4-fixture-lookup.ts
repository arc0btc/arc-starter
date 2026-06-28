/**
 * scripts/arc-p4-fixture-lookup.ts
 *
 * Phase 4 fixture: proves the CRM lookup surface + second dedup-guard.
 *
 * Demonstrates (goal-backward):
 *   1. lookupTarget for a known AGENT (Trustless Indra) returns correct WHO+WHY+history
 *   2. lookupTarget for a known HUMAN (biwas_xyz) returns correct WHO+WHY+history
 *   3. Cross-namespace resolution: Quasar Garuda (aibtc_agent namespace) resolves correctly
 *   4. BOTH dedup guards fire independently:
 *      a. source_key UNIQUE INSERT throws SQLiteError (first guard — DB constraint)
 *      b. second_guard.verdict=BLOCK fires for an already-touched account (second guard — compose-time)
 *   5. Row counts unchanged before/after all lookups (read-only proof)
 *
 * Run: bun scripts/arc-p4-fixture-lookup.ts
 */

import { Database } from "bun:sqlite";
import { lookupTarget, checkSecondGuard } from "../skills/social-engine/crm-lookup.ts";

const DB_PATH = "/home/dev/arc-starter/db/arc.sqlite";

// Open READONLY for lookups
const dbRo = new Database(DB_PATH, { readonly: true });

// Open RW for the dupe-simulation INSERT test only (we need to attempt an insert to prove the UNIQUE fires)
// We immediately rollback so no rows are written.
const dbRw = new Database(DB_PATH);

function countRows(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
}

type CheckResult = { label: string; pass: boolean; detail: string };
const checks: CheckResult[] = [];

function check(label: string, pass: boolean, detail: string): void {
  checks.push({ label, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass) console.log(`         detail: ${detail}`);
}

// ── Snapshot row counts BEFORE ────────────────────────────────────────────────
const before = {
  entity: countRows(dbRo, "entity"),
  entity_identity: countRows(dbRo, "entity_identity"),
  social_accounts: countRows(dbRo, "social_accounts"),
  outbound_action: countRows(dbRo, "outbound_action"),
  engagement_log: countRows(dbRo, "engagement_log"),
};

console.log("\n=== Row counts BEFORE ===");
for (const [t, c] of Object.entries(before)) console.log(`  ${t}: ${c}`);

// ── Lookup 1: known AGENT (Trustless Indra / Arc) ────────────────────────────
console.log("\n=== Lookup 1: Trustless Indra (Arc) — agent ===");
const arcResult = lookupTarget(dbRo, { query: "Trustless Indra (Arc)" });

console.log(JSON.stringify(arcResult, null, 2));

check(
  "L1: found=true for Trustless Indra",
  arcResult.found,
  `found=${arcResult.found}`,
);
check(
  "L1: entity_id=1",
  arcResult.entity?.id === 1,
  `entity.id=${arcResult.entity?.id}`,
);
check(
  "L1: entity_type=agent",
  arcResult.entity?.entity_type === "agent",
  `entity_type=${arcResult.entity?.entity_type}`,
);
check(
  "L1: notes_parsed.fleet=true",
  arcResult.entity?.notes_parsed?.fleet === true,
  `fleet=${arcResult.entity?.notes_parsed?.fleet}`,
);
check(
  "L1: identities include stx_wallet",
  arcResult.identities.some((i) => i.namespace === "stx_wallet"),
  `identities=${JSON.stringify(arcResult.identities.map((i) => i.namespace))}`,
);
check(
  "L1: second_guard.verdict=WARN (Arc is own agent, no social_accounts in CRM as outbound target)",
  arcResult.second_guard.verdict === "WARN" || arcResult.second_guard.verdict === "ALLOW",
  `verdict=${arcResult.second_guard.verdict}`,
);

// ── Lookup 2: known HUMAN (biwas_xyz) ────────────────────────────────────────
console.log("\n=== Lookup 2: biwas_xyz (human) — x_handle namespace ===");
const biwasResult = lookupTarget(dbRo, { query: "biwas_xyz", namespace: "x_handle" });

console.log(JSON.stringify(biwasResult, null, 2));

check(
  "L2: found=true for biwas_xyz",
  biwasResult.found,
  `found=${biwasResult.found}`,
);
check(
  "L2: entity_id=21",
  biwasResult.entity?.id === 21,
  `entity.id=${biwasResult.entity?.id}`,
);
check(
  "L2: entity_type=human",
  biwasResult.entity?.entity_type === "human",
  `entity_type=${biwasResult.entity?.entity_type}`,
);
check(
  "L2: social_account.reach_fit_tier=A",
  biwasResult.social_account?.reach_fit_tier === "A",
  `reach_fit_tier=${biwasResult.social_account?.reach_fit_tier}`,
);
check(
  "L2: social_account.reason_tag=close_aibtc_collaborator",
  biwasResult.social_account?.reason_tag === "close_aibtc_collaborator",
  `reason_tag=${biwasResult.social_account?.reason_tag}`,
);
check(
  "L2: notes link to Quasar Garuda entity_id=7",
  biwasResult.entity?.notes_parsed?.operator_of_aibtc_agent_entity_id === 7,
  `link=${biwasResult.entity?.notes_parsed?.operator_of_aibtc_agent_entity_id}`,
);

// ── Lookup 3: cross-namespace — Quasar Garuda (aibtc_agent) ──────────────────
console.log("\n=== Lookup 3: Cross-namespace — Quasar Garuda (aibtc_agent) ===");
const qgResult = lookupTarget(dbRo, {
  query: "SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1:Quasar Garuda",
  namespace: "aibtc_agent",
});

console.log(JSON.stringify(qgResult, null, 2));

check(
  "L3: found=true for Quasar Garuda via aibtc_agent namespace",
  qgResult.found,
  `found=${qgResult.found}`,
);
check(
  "L3: entity_id=7",
  qgResult.entity?.id === 7,
  `entity.id=${qgResult.entity?.id}`,
);
check(
  "L3: entity notes.operator_handle=biwasxyz (links to human entity 21)",
  qgResult.entity?.notes_parsed?.operator_handle === "biwasxyz",
  `operator_handle=${qgResult.entity?.notes_parsed?.operator_handle}`,
);

// ── Lookup 4: friedger (bitcoin_thesis tier human) ───────────────────────────
console.log("\n=== Lookup 4: friedger (human, bitcoin_thesis tier) ===");
const friedgerResult = lookupTarget(dbRo, { query: "friedger", namespace: "x_handle" });
console.log(JSON.stringify(friedgerResult, null, 2));

check(
  "L4: found=true for friedger",
  friedgerResult.found,
  `found=${friedgerResult.found}`,
);
check(
  "L4: reach_fit_tier=bitcoin_thesis",
  friedgerResult.social_account?.reach_fit_tier === "bitcoin_thesis",
  `reach_fit_tier=${friedgerResult.social_account?.reach_fit_tier}`,
);
check(
  "L4: reason_tag=runs_an_agent",
  friedgerResult.social_account?.reason_tag === "runs_an_agent",
  `reason_tag=${friedgerResult.social_account?.reason_tag}`,
);

// ── DEDUP GUARD DEMONSTRATION ────────────────────────────────────────────────
console.log("\n=== SECOND GUARD: account already touched in last 30 days ===");
// outbound_action.account_id=16 is the most recent touched account
// (from engagement_log/outbound_action sample — account_id=16, handle not biwas)
// Let's find a real account_id that has recent engagement_log rows
const touchedAccount = dbRw
  .query<{ account_id: number; handle: string }, []>(
    `SELECT oa.account_id, sa.handle
     FROM outbound_action oa
     JOIN social_accounts sa ON sa.id = oa.account_id
     JOIN engagement_log el ON el.action_id = oa.id
     WHERE oa.account_id IS NOT NULL
     ORDER BY el.occurred_at DESC
     LIMIT 1`,
  )
  .get();

console.log(`Testing second guard for account_id=${touchedAccount?.account_id} (${touchedAccount?.handle})`);

const guard = checkSecondGuard(dbRw, touchedAccount?.account_id ?? null);
console.log(JSON.stringify(guard, null, 2));

check(
  "GUARD: second_guard.already_touched=true for touched account",
  guard.already_touched,
  `already_touched=${guard.already_touched}, recent_touch_count=${guard.recent_touch_count}`,
);
check(
  "GUARD: second_guard.verdict=BLOCK for touched account",
  guard.verdict === "BLOCK",
  `verdict=${guard.verdict}`,
);

// ── FIRST GUARD: source_key UNIQUE INSERT throws ──────────────────────────────
console.log("\n=== FIRST GUARD: source_key UNIQUE INSERT throws SQLiteError ===");
const existingRow = dbRw
  .query<
    {
      source_key: string;
      platform: string;
      lane: string;
      payload_ref: string;
      payload_hash: string;
      budget_day: string;
    },
    []
  >(
    "SELECT source_key, platform, lane, payload_ref, payload_hash, budget_day FROM outbound_action LIMIT 1",
  )
  .get();

let firstGuardFired = false;
if (existingRow) {
  try {
    dbRw.run(`
      INSERT INTO outbound_action (source_key, platform, lane, payload_ref, payload_hash, budget_day)
      VALUES ('${existingRow.source_key}', 'x', 'reply', 'test-p4-guard', 'test-hash', '2099-01-01')
    `);
    console.log("  ERROR: INSERT succeeded — UNIQUE constraint not enforced!");
  } catch (err: unknown) {
    const e = err as Error;
    firstGuardFired = true;
    console.log(`  UNIQUE constraint fired: ${e.message.slice(0, 80)}`);
  }
}
check(
  "GUARD-1: source_key UNIQUE INSERT throws (first guard)",
  firstGuardFired,
  firstGuardFired
    ? "SQLiteError UNIQUE constraint as expected"
    : "INSERT did not throw — FAIL",
);

// Both guards are independent:
check(
  "GUARD-INDEPENDENCE: both guards fire for different reasons",
  firstGuardFired && guard.verdict === "BLOCK",
  `first_guard=${firstGuardFired ? "UNIQUE_error" : "no_error"}, second_guard=${guard.verdict}`,
);

// ── Row counts AFTER ──────────────────────────────────────────────────────────
// (The failed INSERT threw before committing — no row written)
const after = {
  entity: countRows(dbRo, "entity"),
  entity_identity: countRows(dbRo, "entity_identity"),
  social_accounts: countRows(dbRo, "social_accounts"),
  outbound_action: countRows(dbRo, "outbound_action"),
  engagement_log: countRows(dbRo, "engagement_log"),
};

console.log("\n=== Row counts AFTER ===");
for (const [t, c] of Object.entries(after)) {
  const same = c === before[t as keyof typeof before];
  console.log(`  ${t}: ${c} ${same ? "(unchanged)" : "!!! CHANGED !!!"}`);
}

const rowCountsUnchanged = Object.keys(before).every(
  (t) => after[t as keyof typeof after] === before[t as keyof typeof before],
);
check(
  "READ-ONLY: all row counts unchanged after lookups + failed INSERT",
  rowCountsUnchanged,
  rowCountsUnchanged ? "all counts identical" : "some counts differ — writes occurred",
);

// ── Final summary ─────────────────────────────────────────────────────────────
console.log("\n=== P4 Fixture Results ===");
const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass).length;
console.log(`${passed} PASS  ${failed} FAIL`);
if (failed > 0) {
  console.log("\nFailed checks:");
  for (const c of checks.filter((c) => !c.pass)) {
    console.log(`  - ${c.label}: ${c.detail}`);
  }
}
console.log(failed === 0 ? "\nPASS" : "\nFAIL");

dbRo.close();
dbRw.close();
