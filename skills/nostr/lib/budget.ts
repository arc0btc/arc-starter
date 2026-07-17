// skills/nostr/lib/budget.ts
//
// Daily post-count budget guard for Nostr (defect-register row 12, control-plane-remediation P4).
// Nostr writes are cost-free (no per-post spend the way X's write_spend_usd tracks), so this is a
// monitorable throughput CEILING, not a spend guard — mirrors the shape of
// skills/social-x-posting/cli.ts's db/x-budget.json (date-keyed, atomic temp-and-rename write) at
// a fraction of the complexity, since there is no per-action-type breakdown or ledger
// reconciliation to do. Before this file, nothing would have flagged runaway Nostr posting from a
// sensor bug or bad candidate-selection logic (the only prior throughput governor was the 5-minute
// poll interval itself).

import { renameSync } from "node:fs";

const BUDGET_PATH = new URL("../../../db/nostr-budget.json", import.meta.url).pathname;

/** Sanity ceiling on Nostr notes/day. Mirrors X's DAILY_TWEET_CAP=6 order of magnitude — Nostr
 * has no spend to cap, so this exists purely so a runaway sensor/candidate-pool bug can't post
 * unboundedly. Not a marketing/cadence decision; raise it if legitimate volume needs more. */
export const NOSTR_DAILY_POST_CAP = 6;

export interface NostrDailyBudget {
  date: string; // YYYY-MM-DD, UTC
  posts: number;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadBudget(): Promise<NostrDailyBudget> {
  const today = todayDateStr();
  try {
    const file = Bun.file(BUDGET_PATH);
    if (await file.exists()) {
      const data = (await file.json()) as NostrDailyBudget;
      if (data.date === today) return data;
      // Day rolled over — reset (no history retention needed for a cost-free ceiling counter).
    }
  } catch {
    // corrupt/missing file, start fresh
  }
  return { date: today, posts: 0 };
}

async function saveBudget(budget: NostrDailyBudget): Promise<void> {
  const temporaryFilePath = BUDGET_PATH + ".tmp";
  await Bun.write(temporaryFilePath, JSON.stringify(budget, null, 2));
  renameSync(temporaryFilePath, BUDGET_PATH);
}

/**
 * Check whether one more Nostr post is allowed today, and if so, atomically reserve it
 * (increment + persist) before the caller queues the post task. Call this immediately before
 * `insertTaskIfNew` in the consumer sensor — if `allowed` is false, defer instead of queuing.
 */
export async function checkAndIncrementNostrBudget(): Promise<{ allowed: boolean; used: number; cap: number }> {
  const budget = await loadBudget();
  if (budget.posts >= NOSTR_DAILY_POST_CAP) {
    return { allowed: false, used: budget.posts, cap: NOSTR_DAILY_POST_CAP };
  }
  budget.posts += 1;
  await saveBudget(budget);
  return { allowed: true, used: budget.posts, cap: NOSTR_DAILY_POST_CAP };
}
