// src/follow-policy.ts
//
// The follow-policy hook (arc-x-research-channel quest, Phase 4, operator-locked
// 2026-07-13): "Arc follows every account whose research we like — and
// definitely every account whose research we USE." Wired into
// skills/arc-link-research/cli.ts's cmdProcess, right after a report is
// written — i.e. triggered by REPORT ACCEPTANCE itself, in real time, NOT a
// periodic rescan. (skills/social-engine/research-input-loop.ts already does a
// PERIODIC ≥3x-citation batch promotion into social_accounts only — it stays
// as-is, a complementary backfill path for the historical corpus; it does NOT
// do List-add or follow, and this phase does not touch it. dev-council/Fowler
// lens, 2026-07-13: this DOES mean two different promotion thresholds now
// write the same table — disclosed, not reconciled this phase, see the Phase 4
// verify artifact.)
//
// Also NOT built on skills/social-engine/follow-curated.ts, despite that
// script already containing proven follow-batch logic (X-truth dedup, 20/day
// cap, 8s spacing, social_accounts bookkeeping) — confirmed via
// memory/shared/entries/x-read-budget-mentions-crowdout.md (2026-07-06) to be
// DORMANT (no active caller, no sensor-discovery path: it's a bare script, not
// a sensor.ts). Depending on it here would silently recreate the exact
// starvation failure mode this whole quest exists to fix. The actual FOLLOW
// write goes through `followByTargetId` (skills/social-x-posting/cli.ts),
// in-process (2026-07-13 dev-council fix, Newman lens — this originally
// shelled out to `bun cli.ts follow`, which is why this comment used to say
// "reusing the technique, not the dead script"; the shell-out itself was
// replaced by an in-process function once the council found it was also
// silently swallowing the daily-cap "deferred" case, see followByTargetId's
// own doc comment).
//
// Contract: `promoteResearchSourceHandle` never throws — the ENTIRE body is
// wrapped (dev-council/Lamport lens, 2026-07-13: the original version only
// try/caught the List-add and follow steps, leaving the DB SELECT/INSERT
// unguarded — a stated contract that wasn't actually true). A follow-policy
// hiccup must never fail the research report that triggered it
// (arc-link-research's cmdProcess calls this AFTER the report file is
// already written).

import { getDatabase } from "./db.ts";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const LIST_STATE_PATH = join(ROOT, "db/hook-state/list-roster-state.json");

export interface PromoteResult {
  promoted: boolean; // true if a NEW social_accounts row was inserted this call
  listAdded: boolean;
  followAttempted: boolean;
  followed: boolean;
  reason?: string;
}

interface SocialAccountRow {
  id: number;
  targeting_status: string;
  follow_target_id: string | null;
  follow_state: string | null;
  list_member_added_at: string | null;
}

async function loadListId(): Promise<string | null> {
  try {
    const f = Bun.file(LIST_STATE_PATH);
    if (!(await f.exists())) return null;
    const state = (await f.json()) as { listId?: string };
    return state.listId ?? null;
  } catch {
    return null;
  }
}

function selectByHandle(db: ReturnType<typeof getDatabase>, handle: string): SocialAccountRow | undefined {
  return db
    .query(
      `SELECT id, targeting_status, follow_target_id, follow_state, list_member_added_at
       FROM social_accounts WHERE lower(handle) = lower(?)`,
    )
    .get(handle) as SocialAccountRow | undefined;
}

/**
 * Promote a research-source handle (first-use bar, operator-locked 2026-07-13)
 * into `social_accounts` + the private X List + a follow. Never overrides an
 * existing `targeting_status='blocked'` row — the 11 blocked rows are a real,
 * deliberate junk/bot-morphology exclusion, not a default to bypass. Best-
 * effort at every step: a List-add or follow failure is logged and reflected
 * in the returned booleans — the function itself never throws (see module
 * header).
 */
export async function promoteResearchSourceHandle(
  handle: string,
  opts: { log?: (m: string) => void } = {},
): Promise<PromoteResult> {
  const log = opts.log ?? (() => {});
  const cleanHandle = handle.replace(/^@/, "");

  try {
    const db = getDatabase();

    let row = selectByHandle(db, cleanHandle);

    if (row && row.targeting_status === "blocked") {
      log(`@${cleanHandle} is targeting_status='blocked' — never overriding an existing block`);
      return { promoted: false, listAdded: false, followAttempted: false, followed: false, reason: "blocked" };
    }

    let promoted = false;
    if (!row) {
      // dev-council 2026-07-13 (Kleppmann lens, CONFIRMED TOCTOU): two reports
      // citing the same brand-new handle, processed concurrently, could both
      // see "no row" and both INSERT — the loser would throw on
      // `UNIQUE(handle)`, violating this function's never-throws contract.
      // `INSERT OR IGNORE` + an unconditional re-SELECT makes the loser
      // converge on the WINNER's row instead of erroring; `promoted` is
      // derived from `changes` (1 = this call actually inserted it, 0 =
      // another concurrent call already did — still a legitimate row to
      // proceed with for the List-add/follow steps below).
      const insertResult = db
        .query(
          `INSERT OR IGNORE INTO social_accounts
             (handle, platform, targeting_status, follow_state, is_agent, research_seed, research_seed_watermark, notes)
           VALUES (?, 'x', 'eligible', NULL, 0, 1, 'p4-followpolicy:auto',
                   'promoted: research-source used in report (arc-x-research-channel Phase 4 follow policy, first-use)')`,
        )
        .run(cleanHandle);
      promoted = insertResult.changes > 0;
      row = selectByHandle(db, cleanHandle);
      if (!row) {
        // Should be unreachable (INSERT OR IGNORE + immediate re-SELECT on
        // the same connection), but never throw past this point — degrade.
        log(`@${cleanHandle}: could not read back social_accounts row after insert — aborting promotion`);
        return { promoted: false, listAdded: false, followAttempted: false, followed: false, reason: "row_readback_failed" };
      }
      log(
        promoted
          ? `@${cleanHandle}: NEW row promoted into social_accounts (targeting_status='eligible')`
          : `@${cleanHandle}: row already existed (concurrent promotion won the race) — proceeding with it`,
      );
    }

    const result: PromoteResult = { promoted, listAdded: false, followAttempted: false, followed: false };

    // ---- List add ----
    try {
      const listId = await loadListId();
      if (!listId) {
        log(`list-roster not initialized yet (no db/hook-state/list-roster-state.json) — skipping List add`);
      } else if (row.list_member_added_at) {
        result.listAdded = true; // already a member — idempotent no-op
      } else {
        const { addListMember, resolveUserId } = await import("../skills/social-x-posting/cli.ts");
        let userId = row.follow_target_id;
        if (!userId) userId = await resolveUserId(cleanHandle);
        if (!userId) {
          log(`@${cleanHandle}: could not resolve a user id — skipping List add and follow`);
        } else {
          const addResult = await addListMember(listId, userId);
          // dev-council (Lamport lens, CONFIRMED): gate on the ACTUAL
          // membership confirmation (`alreadyMember` = `is_member===true`),
          // not merely `ok` (HTTP 2xx) — see addListMember's doc comment.
          if (addResult.ok && addResult.alreadyMember) {
            db.query(
              `UPDATE social_accounts SET list_member_added_at = ?, follow_target_id = COALESCE(follow_target_id, ?) WHERE id = ?`,
            ).run(new Date().toISOString(), userId, row.id);
            result.listAdded = true;
            log(`@${cleanHandle}: added to List ${listId}`);
          } else {
            log(`@${cleanHandle}: List add not confirmed — ${addResult.error ?? addResult.status ?? "ok=true but is_member!==true"}`);
          }
          // Re-read so the follow step below sees the freshly-persisted follow_target_id.
          row = selectByHandle(db, cleanHandle.toLowerCase()) ?? row;
        }
      }
    } catch (e) {
      log(`@${cleanHandle}: List-add step threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    // ---- Follow, in-process (directly — see module header on why NOT follow-curated.ts) ----
    try {
      if (row.follow_state === "following") {
        result.followed = true; // already following — idempotent no-op, don't re-spend the write
      } else if (!row.follow_target_id) {
        log(`@${cleanHandle}: no resolved user id — skipping follow`);
      } else {
        result.followAttempted = true;
        const { followByTargetId } = await import("../skills/social-x-posting/cli.ts");
        const followResult = await followByTargetId(row.follow_target_id);
        if (followResult.ok) {
          db.query(
            `UPDATE social_accounts SET follow_state='following', followed_at=?, follow_note='followed via Phase 4 follow-policy hook', updated_at=? WHERE id=?`,
          ).run(new Date().toISOString(), new Date().toISOString(), row.id);
          result.followed = true;
          log(`@${cleanHandle}: followed`);
        } else if (followResult.deferred) {
          log(`@${cleanHandle}: follow deferred — daily 20/day follow cap reached (normal, not a failure)`);
        } else {
          log(`@${cleanHandle}: follow failed — ${followResult.error ?? followResult.status}`);
        }
      }
    } catch (e) {
      log(`@${cleanHandle}: follow step threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    return result;
  } catch (e) {
    // Outermost guard (dev-council/Lamport lens) — makes the "never throws"
    // contract actually true, not just true for the two inner try/catches.
    log(`@${cleanHandle}: promoteResearchSourceHandle threw at the top level (non-fatal, caller's report is unaffected): ${e instanceof Error ? e.message : String(e)}`);
    return { promoted: false, listAdded: false, followAttempted: false, followed: false, reason: "unexpected_error" };
  }
}
