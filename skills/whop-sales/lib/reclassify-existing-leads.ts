#!/usr/bin/env bun
// skills/whop-sales/lib/reclassify-existing-leads.ts
//
// P5 arc-demand-flywheel (2026-07-03) — ONE-TIME reconciliation of the live
// db/whop-leads.json store against the isLikelySpam heuristic added this phase.
//
// updateLeadsFromForum/updateLeadsFromX (lead-source.ts) now filter spam/noise
// at FOLD TIME, so future refreshes never admit it — but the store already had
// spam in it before that filter existed (P0 baseline: ~92% of the 13 candidates
// were spam/reply-chain noise). This script cleans the existing store once. It
// is NOT a recurring sensor — the fold-time filter is the standing mechanism;
// this is a backfill for records that predate it.
//
// Conservative rule: a user is removed ONLY if EVERY recorded interaction for
// them is spam-flagged. A user with even one substantive interaction stays
// (never lose a real signal because one message happened to also match).
// The operator (whoabuddy) is never touched regardless.
//
// Always backs up the store first. Usage:
//   bun skills/whop-sales/lib/reclassify-existing-leads.ts [--dry-run]

import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
// Reuse the canonical loader/saver + types (dev-council kleppmann/hohpe finding,
// P5): a hand-rolled readFileSync/writeFileSync + locally-redefined types risked
// type drift AND reintroduced the exact non-atomic-write hazard saveLeadStore()
// was built to retire (temp-file-then-rename so a concurrent refresh tick or a
// crash mid-write can never observe/leave a torn store).
import { isLikelySpam, loadLeadStore, saveLeadStore } from "./lead-source.ts";
import type { RelationshipStore } from "../../whop/lib/relationships.ts";

const DRY_RUN = process.argv.includes("--dry-run");
// loadLeadStore()/saveLeadStore() resolve the canonical path themselves; this
// constant is only needed for the existsSync check and the backup copy.
const LEAD_STORE_PATH = resolve(import.meta.dir, "../../../db/whop-leads.json");

// Hardcoded, matching skills/whop-sales/sensor.ts's own OPERATOR_USER_ID —
// the operator is never a lead, spam-flagged or not.
const OPERATOR_USER_ID = "user_WQ6WyvnFOZ6bY";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [reclassify-existing-leads] ${msg}`);
}

async function main() {
  if (!existsSync(LEAD_STORE_PATH)) {
    log(`No lead store at ${LEAD_STORE_PATH} — nothing to reconcile.`);
    return;
  }

  const store: RelationshipStore = loadLeadStore();
  const beforeCount = Object.keys(store.users).length;

  const removed: Array<{ user_id: string; username: string | null; reasons: string[] }> = [];
  const kept: string[] = [];

  for (const [userId, rel] of Object.entries(store.users)) {
    if (userId === OPERATOR_USER_ID) {
      kept.push(userId);
      continue;
    }
    const interactions = rel.recent_interactions ?? [];
    if (interactions.length === 0) {
      kept.push(userId); // no content to judge — leave alone
      continue;
    }
    const verdicts = interactions.map((i) => isLikelySpam(i.snippet ?? ""));
    const allSpam = verdicts.every((v) => v.spam);
    if (allSpam) {
      const reasons = [...new Set(verdicts.map((v) => v.reason).filter((r): r is string => !!r))];
      removed.push({ user_id: userId, username: rel.username, reasons });
    } else {
      kept.push(userId);
    }
  }

  log(`Before: ${beforeCount} users. Spam-only users found: ${removed.length}.`);
  for (const r of removed) {
    log(`  ${DRY_RUN ? "[DRY-RUN] would remove" : "removing"}: ${r.username ?? r.user_id} (${r.reasons.join(", ")})`);
  }

  if (removed.length === 0) {
    log("Nothing to remove. Store unchanged.");
    return;
  }

  if (DRY_RUN) {
    log(`DRY-RUN complete: ${removed.length} would be removed, ${beforeCount - removed.length} would remain.`);
    return;
  }

  const backupPath = `${LEAD_STORE_PATH}.bak-p5-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(LEAD_STORE_PATH, backupPath);
  log(`Backed up store to ${backupPath}`);

  for (const r of removed) delete store.users[r.user_id];
  saveLeadStore(store); // atomic temp-then-rename — same primitive every other writer uses

  const afterCount = Object.keys(store.users).length;
  log(`After: ${afterCount} users (removed ${removed.length}, kept ${kept.length}). Complete.`);
}

main().catch((e) => {
  console.error("[reclassify-existing-leads] Fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
