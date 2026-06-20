#!/usr/bin/env bun
// skills/social-engine/follow-curated.ts
//
// Batch follow orchestrator for Arc's curated "accounts of value" (operator
// directive 2026-06-19: follow accounts that expose Arc to others → audience +
// reply-permission). ONE deduped, rate-aware path — mirrors the consolidated
// reply lane in spirit.
//
//   Source of truth (targeting): social_accounts table.
//     - targeting_status='eligible'         → followable
//     - targeting_status='blocked'          → EXCLUDED (7 junk/bot)
//     - targeting_status='ingestion_only'   → EXCLUDED (2 hype/meme; ingest, don't brand-follow)
//   Priority order: research_core (reach_fit_tier IS NULL) → A → bitcoin_thesis → B.
//
//   Dedup: X is the source of truth — GET /2/users/:id/following (paginated,
//   read-budget-aware). Cross-checked with the additive social_accounts.follow_state
//   column. Never re-follow.
//
//   Rate: small delay between follows + the existing daily "follows" budget cap
//   (20/day, in skills/social-x-posting/cli.ts BUDGET_LIMITS). On 429/restriction
//   from the follow primitive, back off and STOP cleanly; remaining work is left
//   for the next run (re-run is idempotent — already-followed are skipped).
//
//   Each successful follow is recorded to social_accounts (follow_state='following',
//   followed_at, follow_target_id) for the "follows +N" health line.
//
// The follow WRITE goes through the proven signed-POST path:
//   bun skills/social-x-posting/cli.ts follow --target-id <id>
// (reuses the existing OAuth 1.0a helper — no auth duplicated here).

import { Database } from "bun:sqlite";
import { join } from "path";
import {
  loadXCreds,
  xApiGet,
  ARC_X_USER_ID,
  type XCreds,
} from "../social-x-posting/lib/x-api.ts";

const ROOT = join(import.meta.dir, "../..");
const DB_PATH = join(ROOT, "db/arc.sqlite");
const CLI = join(ROOT, "skills/social-x-posting/cli.ts");

// Conservative pacing: don't look automated.
const DELAY_MS = 8000;
// Honor the existing follows budget (20/day). Hard self-cap as a second guard.
const SELF_CAP = 20;
const DRY_RUN = process.argv.includes("--dry-run");

function log(m: string) {
  console.error(`[${new Date().toISOString()}] [follow-curated] ${m}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Priority rank: lower = followed first.
function tierRank(tier: string | null): number {
  if (tier === null || tier === "") return 0; // research_core
  if (tier === "A") return 1;
  if (tier === "bitcoin_thesis") return 2;
  if (tier === "B") return 3;
  return 9;
}

interface Row {
  id: number;
  handle: string;
  reach_fit_tier: string | null;
  follow_state: string | null;
  follow_target_id: string | null;
}

/** Fetch Arc's current following set from X (paginated, read-budget-aware).
 * Returns lowercased usernames + ids actually followed. */
async function fetchFollowing(creds: XCreds): Promise<{ usernames: Set<string>; ids: Set<string> }> {
  const usernames = new Set<string>();
  const ids = new Set<string>();
  let token: string | undefined;
  let pages = 0;
  do {
    const params: Record<string, string> = { max_results: "1000", "user.fields": "username" };
    if (token) params["pagination_token"] = token;
    const resp = await xApiGet(`/users/${ARC_X_USER_ID}/following`, creds, params);
    const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const u of data) {
      if (u["username"]) usernames.add(String(u["username"]).toLowerCase());
      if (u["id"]) ids.add(String(u["id"]));
    }
    const meta = (resp["meta"] as Record<string, unknown> | undefined) ?? {};
    token = meta["next_token"] ? String(meta["next_token"]) : undefined;
    pages++;
    if (pages > 10) break; // safety
  } while (token);
  log(`X following snapshot: ${usernames.size} accounts across ${pages} page(s)`);
  return { usernames, ids };
}

async function main() {
  const creds = await loadXCreds();
  if (!creds) {
    log("X creds unavailable — aborting (no follows attempted)");
    process.exit(1);
  }

  const db = new Database(DB_PATH);

  // 1) X truth for dedup
  const following = await fetchFollowing(creds);

  // 2) Eligible roster in priority order (blocked + ingestion_only excluded by WHERE)
  const rows = db
    .query(
      `SELECT id, handle, reach_fit_tier, follow_state, follow_target_id
       FROM social_accounts
       WHERE targeting_status = 'eligible' AND platform = 'x'`,
    )
    .all() as Row[];
  rows.sort((a, b) => tierRank(a.reach_fit_tier) - tierRank(b.reach_fit_tier) || a.handle.localeCompare(b.handle));

  const result = {
    followed: [] as { handle: string; tier: string; target_id: string }[],
    already_following: [] as string[],
    skipped_db_state: [] as string[],
    failures: [] as { handle: string; status: number | null; error: string }[],
    remaining: [] as string[],
    rate_limited_stop: false,
  };

  let doneThisRun = 0;

  for (const r of rows) {
    const h = r.handle.toLowerCase();
    const tier = r.reach_fit_tier ?? "research_core";

    // Dedup A: already-following per X (authoritative)
    if (following.usernames.has(h) || (r.follow_target_id && following.ids.has(r.follow_target_id))) {
      result.already_following.push(r.handle);
      // keep DB in sync if it didn't know
      if (r.follow_state !== "following" && !DRY_RUN) {
        db.run(
          `UPDATE social_accounts SET follow_state='following', followed_at=COALESCE(followed_at, ?), updated_at=? WHERE id=?`,
          [new Date().toISOString(), new Date().toISOString(), r.id],
        );
      }
      continue;
    }
    // Dedup B: DB already marks it followed (defensive)
    if (r.follow_state === "following") {
      result.skipped_db_state.push(r.handle);
      continue;
    }

    // Cap reached → leave the rest for next run
    if (doneThisRun >= SELF_CAP) {
      result.remaining.push(r.handle);
      continue;
    }

    if (result.rate_limited_stop) {
      result.remaining.push(r.handle);
      continue;
    }

    if (DRY_RUN) {
      log(`[dry-run] would follow @${r.handle} (${tier})`);
      result.followed.push({ handle: r.handle, tier, target_id: r.follow_target_id ?? "?" });
      doneThisRun++;
      continue;
    }

    // 3) Follow via the proven signed-POST CLI path. Pass --username so the CLI
    //    resolves+follows in one shot; capture JSON.
    log(`Following @${r.handle} (${tier})...`);
    const proc = Bun.spawnSync({
      cmd: ["bun", CLI, "follow", "--username", r.handle],
      cwd: ROOT,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString().trim();
    let parsed: any = null;
    try {
      const lastLine = out.split("\n").filter(Boolean).pop() ?? "";
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.ok) {
      const targetId = String(parsed.target_id ?? "");
      db.run(
        `UPDATE social_accounts SET follow_state='following', followed_at=?, follow_target_id=?, follow_note=?, updated_at=? WHERE id=?`,
        [
          new Date().toISOString(),
          targetId,
          `followed ok (following=${parsed.following})`,
          new Date().toISOString(),
          r.id,
        ],
      );
      result.followed.push({ handle: r.handle, tier, target_id: targetId });
      doneThisRun++;
    } else {
      const status = parsed?.status ?? null;
      const err = parsed?.error ?? proc.stderr.toString().trim().slice(0, 200) ?? "unknown";
      // Budget-exhausted message from cli.ts checkBudget → stop, leave remaining
      const budgetExhausted = typeof err === "string" && err.includes("budget exhausted");
      if (status === 429 || status === 403 || budgetExhausted) {
        result.rate_limited_stop = true;
        log(`Rate-limit/restriction/budget hit on @${r.handle} (status=${status}) — backing off, stopping run`);
        result.remaining.push(r.handle);
        // record the attempt note but not as following
        db.run(
          `UPDATE social_accounts SET follow_note=?, updated_at=? WHERE id=?`,
          [`stopped: ${String(err).slice(0, 120)}`, new Date().toISOString(), r.id],
        );
        continue;
      }
      // Other failure (e.g. user_not_found) — record, keep going
      db.run(
        `UPDATE social_accounts SET follow_state='failed', follow_note=?, updated_at=? WHERE id=?`,
        [String(err).slice(0, 160), new Date().toISOString(), r.id],
      );
      result.failures.push({ handle: r.handle, status, error: String(err).slice(0, 160) });
    }

    await sleep(DELAY_MS);
  }

  db.close();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  log(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
