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
// do List-add or follow, and this phase does not touch it.)
//
// Also NOT built on skills/social-engine/follow-curated.ts, despite that
// script already containing proven follow-batch logic (X-truth dedup, 20/day
// cap, 8s spacing, social_accounts bookkeeping) — confirmed via
// memory/shared/entries/x-read-budget-mentions-crowdout.md (2026-07-06) to be
// DORMANT (no active caller, no sensor-discovery path: it's a bare script, not
// a sensor.ts). Depending on it here would silently recreate the exact
// starvation failure mode this whole quest exists to fix. This module follows
// DIRECTLY, at promotion time, using the same proven technique
// follow-curated.ts uses (shell out to the signed-POST cli.ts `follow`
// command) — reusing the TECHNIQUE, not the dead script.
//
// Contract: `promoteResearchSourceHandle` never throws — every internal step
// is try/caught. A follow-policy hiccup must never fail the research report
// that triggered it (arc-link-research's cmdProcess calls this AFTER the
// report file is already written).

import { getDatabase } from "./db.ts";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const SOCIAL_X_CLI = join(ROOT, "skills/social-x-posting/cli.ts");
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

/**
 * Promote a research-source handle (first-use bar, operator-locked 2026-07-13)
 * into `social_accounts` + the private X List + a follow. Never overrides an
 * existing `targeting_status='blocked'` row — the 11 blocked rows are a real,
 * deliberate junk/bot-morphology exclusion, not a default to bypass. Best-
 * effort at every step: a List-add or follow failure is logged and reflected
 * in the returned booleans, never thrown.
 */
export async function promoteResearchSourceHandle(
  handle: string,
  opts: { log?: (m: string) => void } = {},
): Promise<PromoteResult> {
  const log = opts.log ?? (() => {});
  const cleanHandle = handle.replace(/^@/, "");
  const db = getDatabase();

  let row = db
    .query(
      `SELECT id, targeting_status, follow_target_id, follow_state, list_member_added_at
       FROM social_accounts WHERE lower(handle) = lower(?)`,
    )
    .get(cleanHandle) as SocialAccountRow | undefined;

  if (row && row.targeting_status === "blocked") {
    log(`@${cleanHandle} is targeting_status='blocked' — never overriding an existing block`);
    return { promoted: false, listAdded: false, followAttempted: false, followed: false, reason: "blocked" };
  }

  let promoted = false;
  if (!row) {
    db.query(
      `INSERT INTO social_accounts
         (handle, platform, targeting_status, follow_state, is_agent, research_seed, research_seed_watermark, notes)
       VALUES (?, 'x', 'eligible', NULL, 0, 1, 'p4-followpolicy:auto',
               'promoted: research-source used in report (arc-x-research-channel Phase 4 follow policy, first-use)')`,
    ).run(cleanHandle);
    promoted = true;
    row = db
      .query(
        `SELECT id, targeting_status, follow_target_id, follow_state, list_member_added_at
         FROM social_accounts WHERE lower(handle) = lower(?)`,
      )
      .get(cleanHandle) as SocialAccountRow;
    log(`@${cleanHandle}: NEW row promoted into social_accounts (targeting_status='eligible')`);
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
        if (addResult.ok) {
          db.query(
            `UPDATE social_accounts SET list_member_added_at = ?, follow_target_id = COALESCE(follow_target_id, ?) WHERE id = ?`,
          ).run(new Date().toISOString(), userId, row.id);
          result.listAdded = true;
          log(`@${cleanHandle}: added to List ${listId}`);
        } else {
          log(`@${cleanHandle}: List add failed — ${addResult.error ?? addResult.status}`);
        }
        // Re-read so the follow step below sees the freshly-persisted follow_target_id.
        row = db
          .query(`SELECT id, targeting_status, follow_target_id, follow_state, list_member_added_at FROM social_accounts WHERE id = ?`)
          .get(row.id) as SocialAccountRow;
      }
    }
  } catch (e) {
    log(`@${cleanHandle}: List-add step threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---- Follow (directly — see module header on why NOT follow-curated.ts) ----
  try {
    if (row.follow_state === "following") {
      result.followed = true; // already following — idempotent no-op, don't re-spend the write
    } else if (!row.follow_target_id) {
      log(`@${cleanHandle}: no resolved user id — skipping follow`);
    } else {
      result.followAttempted = true;
      // process.execPath (not the bare string "bun") so this resolves correctly
      // regardless of the calling process's PATH — the same non-interactive-SSH
      // "bun not found" gotcha that bit this quest's git pre-commit hook earlier
      // today applies here too if a bare "bun" were looked up on PATH.
      const proc = Bun.spawnSync({
        cmd: [process.execPath, SOCIAL_X_CLI, "follow", "--target-id", row.follow_target_id],
        cwd: ROOT,
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = proc.stdout.toString().trim();
      let parsed: { ok?: boolean; error?: string } | null = null;
      try {
        const lastLine = out.split("\n").filter(Boolean).pop() ?? "";
        parsed = JSON.parse(lastLine);
      } catch {
        parsed = null;
      }
      if (parsed?.ok) {
        db.query(
          `UPDATE social_accounts SET follow_state='following', followed_at=?, follow_note='followed via Phase 4 follow-policy hook', updated_at=? WHERE id=?`,
        ).run(new Date().toISOString(), new Date().toISOString(), row.id);
        result.followed = true;
        log(`@${cleanHandle}: followed`);
      } else if (parsed?.error && parsed.error.includes("budget exhausted")) {
        log(`@${cleanHandle}: follow deferred — daily 20/day follow cap reached (normal, not a failure)`);
      } else {
        log(`@${cleanHandle}: follow failed — ${parsed?.error ?? proc.stderr.toString().trim().slice(0, 200)}`);
      }
    }
  } catch (e) {
    log(`@${cleanHandle}: follow step threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
