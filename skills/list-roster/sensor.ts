// skills/list-roster/sensor.ts
//
// The roster reader (arc-x-research-channel quest, Phase 4). Reads the curated
// roster (social_accounts) directly via a private X List instead of the retired
// 96-blind-searches/day keyword rotation. List-poll was chosen over the X
// Activity API push alternative in Phase 1's console reconciliation §2
// (docs/observations/2026-07-13-x-console-reconciliation.md): cost is a wash
// ($0.005/post either way), List-poll needs ZERO new standing infrastructure
// (no persistent stream/webhook receiver to babysit) and fits this codebase's
// scheduled-poll-per-tick architecture everywhere else (candidate-maturation,
// x-news-trends). Activity API is parked as a fast-follow, not built here.
//
// Two jobs, one sensor, same run:
//   1. MEMBERSHIP SYNC — ensure the private List (created once, id persisted in
//      db/hook-state/list-roster-state.json) contains every eligible/
//      ingestion_only social_accounts row. Capped per run (MEMBER_SYNC_CAP_PER_RUN)
//      so the ~138-row ramp doesn't spike read spend past the shared $1.00/day
//      cap while Phase 3's news/trends lanes are also running — rows that
//      already have a resolved follow_target_id (32, from a prior
//      follow-curated.ts run) are synced FIRST and for FREE (no lookup read);
//      only genuinely NEW ids cost a metered $0.010 "users" read, capped.
//   2. TWEET POLL — GET /2/lists/{id}/tweets with since_id discipline, storing
//      each returned post as a candidate (source_lane="list-roster") onto the
//      Phase 2 spine. Generic candidate-maturation/sensor.ts (UNCHANGED)
//      re-scores these at 2-24h exactly as it already does for every other lane.
//
// Auth: tried OAuth 1.0a FIRST (xApiGet) — List tweets is a timeline-style read
// structurally like fetchArcMentions/searchRecentByHandle (both already work
// over OAuth 1.0a). Falls back to xApiGetAppOnly ONLY on a live 403 "OAuth 1.0a
// User Context is forbidden" (same honest-discovery pattern Phase 3 used for
// Trends/News — never assume, verify live and log which auth path actually won).

import { getDatabase } from "../../src/db.ts";
import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertCandidateIfNew, extractUrls, type KnownSourceLane } from "../../src/candidate-spine.ts";
import { loadXCreds, xApiGet, xApiGetAppOnly } from "../social-x-posting/lib/x-api.ts";
import { createXList, addListMember, resolveUserId } from "../social-x-posting/cli.ts";
import { join } from "path";
import { renameSync } from "node:fs";

const SENSOR_NAME = "list-roster";
// since_id + 24h-UTC dedup make higher-cadence polling cheap (no re-billing of
// already-seen posts) — this dial is about FRESHNESS, not cost. 4h keeps
// candidates flowing into the 2-24h maturation window promptly.
const POLL_INTERVAL_HOURS = 4;
const INTERVAL_MINUTES = POLL_INTERVAL_HOURS * 60;
const LIST_STATE_PATH = join(import.meta.dir, "../../db/hook-state/list-roster-state.json");
const LIST_LANE: KnownSourceLane = "list-roster";
// resolveUserId (skills/social-x-posting/cli.ts) bills its own "users" lane
// internally — no separate lane constant needed here, this is display-only.
const USER_LOOKUP_COST_USD = 0.01; // Phase 1 console reconciliation: user reads confirmed $0.010/resource
// Bounds ramp-up read spend: only this many NEW (no cached follow_target_id)
// username->id lookups are paid for per run. Rows with an existing
// follow_target_id sync for free and don't count against this cap.
const MEMBER_SYNC_CAP_PER_RUN = 5;
const LIST_NAME = "Arc Research Roster";
const LIST_DESCRIPTION = "Curated research-source accounts — arc-x-research-channel Phase 4";

const log = createSensorLogger(SENSOR_NAME);

interface ListState {
  listId: string;
  createdAt: string;
  sinceId?: string;
  // dev-council 2026-07-13 (Lamport lens, CONFIRMED liveness bug): without
  // this, a handle that permanently fails (X-suspended, or the List owner
  // rejects the add — both observed live this session) sorts back to the
  // SAME query position every run and re-consumes a MEMBER_SYNC_CAP_PER_RUN
  // slot forever, starving the resolvable remainder — a stall, not just slow
  // progress, once enough dead handles accumulate at the front of the
  // alphabetical/free-first ordering. Persisted across runs so a failure is
  // paid for (in read/write cost) at most once, ever, not once per run.
  failedHandles?: string[];
}

async function loadListState(): Promise<ListState | null> {
  try {
    const f = Bun.file(LIST_STATE_PATH);
    if (!(await f.exists())) return null;
    return (await f.json()) as ListState;
  } catch {
    return null;
  }
}

async function saveListState(state: ListState): Promise<void> {
  const temporaryPath = LIST_STATE_PATH + ".tmp";
  await Bun.write(temporaryPath, JSON.stringify(state, null, 2) + "\n");
  renameSync(temporaryPath, LIST_STATE_PATH);
}

interface RosterRow {
  id: number;
  handle: string;
  follow_target_id: string | null;
  list_member_added_at: string | null;
}

export default async function listRosterSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log(`run started (cadence: ${POLL_INTERVAL_HOURS}h)`);

    const creds = await loadXCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    // ---- 1. Ensure the List exists ----
    let state = await loadListState();
    if (!state) {
      log(`no List recorded — creating "${LIST_NAME}"...`);
      const list = await createXList(LIST_NAME, LIST_DESCRIPTION);
      state = { listId: list.id, createdAt: new Date().toISOString() };
      await saveListState(state);
      log(`List created: id=${state.listId}`);
    } else {
      log(`using existing List id=${state.listId}`);
    }

    // ---- 2. Membership sync (capped, free-rows first, dead-handle-excluded) ----
    const db = getDatabase();
    const failedHandles = new Set((state.failedHandles ?? []).map((h) => h.toLowerCase()));
    // Over-fetch (150 > the whole ~138-row roster) so filtering OUT already-known-dead
    // handles never starves the batch of real candidates to try this run.
    const allRows = db
      .query(
        `SELECT id, handle, follow_target_id, list_member_added_at
         FROM social_accounts
         WHERE targeting_status IN ('eligible','ingestion_only')
           AND list_member_added_at IS NULL
         ORDER BY (follow_target_id IS NULL) ASC, handle ASC
         LIMIT 150`,
      )
      .all() as RosterRow[];
    const rows = allRows.filter((r) => !failedHandles.has(r.handle.toLowerCase()));
    const skippedDead = allRows.length - rows.length;

    let freeAdds = 0;
    let paidLookups = 0;
    let membersAdded = 0;
    let newlyFailed = 0;
    for (const row of rows) {
      let userId = row.follow_target_id;
      const isFreeRow = userId !== null;
      if (!userId) {
        if (paidLookups >= MEMBER_SYNC_CAP_PER_RUN) continue; // cap reached — leave for next run
        userId = await resolveUserId(row.handle);
        paidLookups++;
        if (!userId) {
          log(`  resolveUserId failed for @${row.handle} — marking dead, will not retry`);
          failedHandles.add(row.handle.toLowerCase());
          newlyFailed++;
          continue;
        }
      }

      const addResult = await addListMember(state.listId, userId);
      // dev-council (Lamport lens, CONFIRMED): gate on the ACTUAL membership
      // confirmation (`alreadyMember` = `is_member===true`, see addListMember's
      // doc comment), not merely `ok` (HTTP 2xx) — a 200-with-unconfirmed
      // response must not be recorded as a confirmed member.
      if (addResult.ok && addResult.alreadyMember) {
        db.query(
          `UPDATE social_accounts SET list_member_added_at = ?, follow_target_id = COALESCE(follow_target_id, ?) WHERE id = ?`,
        ).run(new Date().toISOString(), userId, row.id);
        membersAdded++;
        if (isFreeRow) freeAdds++;
      } else {
        // Both a hard error (addResult.ok===false, e.g. the two real 403/400
        // rejections observed live this session) AND an ok-but-unconfirmed
        // response are treated as "won't succeed on retry" — a List-add
        // rejection is a property of the (List, account) pair, not a transient
        // hiccup, so retrying next run would just waste the same read/write again.
        log(`  addListMember not confirmed for @${row.handle}: ${addResult.error ?? addResult.status ?? "ok=true but is_member!==true"} — marking dead, will not retry`);
        failedHandles.add(row.handle.toLowerCase());
        newlyFailed++;
      }
    }

    if (newlyFailed > 0) {
      state.failedHandles = Array.from(failedHandles);
      await saveListState(state);
    }

    const remaining = db
      .query(
        `SELECT COUNT(*) as c FROM social_accounts WHERE targeting_status IN ('eligible','ingestion_only') AND list_member_added_at IS NULL`,
      )
      .get() as { c: number };
    log(
      `membership sync: ${membersAdded} added this run (${freeAdds} free via cached id, ${paidLookups} paid lookup(s) @ $${USER_LOOKUP_COST_USD}), ${remaining.c} still unsynced (${failedHandles.size} permanently dead, ${skippedDead} skipped this run as known-dead)`,
    );

    // ---- 3. Tweet poll (since_id-disciplined) ----
    // Wrapped in its OWN try/catch (dev-council/Newman-style guard, matching
    // x-news-trends' per-lane isolation): a read-budget exhaustion or transient
    // API failure on THIS step must not discard the membership-sync work
    // already committed to social_accounts above, or make a partially-useful
    // run report as a bare "error" with no visibility into what DID succeed.
    let tweetsSeen = 0;
    let candidatesStored = 0;
    let authPathUsed = "oauth1.0a";
    let sinceIdAfter = state.sinceId;
    try {
      const queryParams: Record<string, string> = {
        max_results: "100",
        "tweet.fields": "created_at,author_id,public_metrics",
        expansions: "author_id",
        "user.fields": "username",
      };
      if (state.sinceId) queryParams["since_id"] = state.sinceId;

      let result: Record<string, unknown>;
      try {
        result = await xApiGet(`/lists/${state.listId}/tweets`, creds, queryParams, { lane: LIST_LANE });
      } catch (e) {
        const message = (e as Error).message;
        if (message.includes("403") && message.toLowerCase().includes("oauth 1.0a user context is forbidden")) {
          log(`OAuth 1.0a rejected for list tweets (${message}) — retrying via OAuth 2.0 App-Only`);
          authPathUsed = "oauth2-app-only";
          result = await xApiGetAppOnly(`/lists/${state.listId}/tweets`, creds, queryParams, { lane: LIST_LANE });
        } else {
          throw e;
        }
      }

      const tweets = (result["data"] as Array<Record<string, unknown>> | undefined) ?? [];
      tweetsSeen = tweets.length;
      const includes = (result["includes"] as Record<string, unknown> | undefined) ?? {};
      const users = (includes["users"] as Array<Record<string, unknown>> | undefined) ?? [];
      const userMap = new Map<string, string>();
      for (const u of users) {
        if (u["id"] && u["username"]) userMap.set(String(u["id"]), String(u["username"]));
      }
      const meta = (result["meta"] as Record<string, unknown> | undefined) ?? {};
      const newestId = meta["newest_id"] ? String(meta["newest_id"]) : undefined;

      for (const t of tweets) {
        const tweetId = String(t["id"]);
        const authorId = t["author_id"] ? String(t["author_id"]) : undefined;
        const authorUsername = authorId ? userMap.get(authorId) ?? "unknown" : "unknown";
        const text = String(t["text"] ?? "");
        const inserted = insertCandidateIfNew({
          tweet_id: tweetId,
          source_lane: LIST_LANE,
          first_seen: new Date().toISOString(),
          author_id: authorId,
          text_snippet: text,
          urls: extractUrls(text),
          discovery_context: `List: @${authorUsername} post`,
        });
        if (inserted) candidatesStored++;
      }

      if (newestId) {
        state.sinceId = newestId;
        sinceIdAfter = newestId;
        await saveListState(state);
      }
      log(
        `tweet poll (auth: ${authPathUsed}): ${tweetsSeen} tweet(s) returned, ${candidatesStored} candidate(s) stored, since_id -> ${sinceIdAfter ?? "none"}`,
      );
    } catch (e) {
      log(`warn: tweet poll failed (membership sync above still stands): ${(e as Error).message}`);
    }

    log(`completed: list=${state.listId}, members_added=${membersAdded}, tweets=${tweetsSeen}, candidates=${candidatesStored}`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
