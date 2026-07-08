// skills/arc-daily-read/lib/edition-metrics.ts
//
// arc-day-n-publishing P5: per-edition attribution instrumentation — streak (extracted, not
// re-derived), post-engagement metrics backfill, and amplification detection.
//
// Module boundary (dev-council/Fowler, P5, CONFIRMED): this lives under arc-daily-read/lib
// (not skills/arc-attribution) because it WRITES to daily_read_log, a table arc-daily-read owns
// — write-ownership wins over topical grouping. arc-attribution/lib/report.ts (the read-only
// aggregation layer) imports computeStreak() from here rather than re-implementing it, so the
// two files can never silently disagree on what the streak means.
//
// Two callers with genuinely different needs justify this as its own module rather than living
// inside cli.ts (dev-council/Fowler, CONFIRMED — failure isolation, not hypothetical reuse):
// cli.ts's own CLI subcommands (backfill-metrics/check-amplification/mark-amplification), and
// arc-daily-read/sensor.ts's tick (which needs checkAmplification() WITHOUT dragging cli.ts's
// arg-parsing/command-dispatch surface into a background sensor).

import { Database } from "bun:sqlite";
import {
  loadXCreds,
  fetchRecentPostMetrics,
  searchRecentByHandle,
  type PostTouchMetrics,
} from "../../social-x-posting/lib/x-api.ts";

// ---------------------------------------------------------------------------
// Streak (dev-council/Lamport, P5, CONFIRMED — extracted, not re-derived from prose)
// ---------------------------------------------------------------------------

/**
 * arc-day-n-publishing P1 (dev-council/Lamport+Kleppmann, design spec §3.3) — extracted
 * VERBATIM from arc-daily-read/cli.ts in P5 (dev-council/Lamport, P5, CONFIRMED: the P0/P5
 * design docs' "stop at the first void OR MISSING DAY" prose describes a fold that was never
 * actually implemented — there is no calendar-gap/missing-day detection here at all, and no
 * `'partial-degraded'` status value exists; the real value is `'partial'`). This function is
 * the ONE authoritative definition — arc-attribution/lib/report.ts imports it rather than
 * re-deriving a second, possibly-divergent fold. Folds over `(edition_n, status)` from the most
 * recent edition backwards, stopping at the first status NOT IN ('shipped','partial') — this
 * also stops at 'reserving' (an in-flight edition) and 'void'.
 */
export function computeStreak(db: Database): number {
  const rows = db
    .query("SELECT status FROM daily_read_log ORDER BY edition_n DESC")
    .all() as { status: string }[];
  let streak = 0;
  for (const row of rows) {
    if (row.status === "shipped" || row.status === "partial") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Per-edition post-engagement metrics backfill
// ---------------------------------------------------------------------------

export interface EditionMetricsResult {
  editionN: number;
  tweetIds: string[];
  metrics: PostTouchMetrics[] | null;
  skippedReason: string | null;
}

interface EligibleEditionRow {
  edition_n: number;
  tweet_id: string | null;
}

/**
 * Backfill per-tweet engagement (like/retweet/reply counts + `impression_proxy` — X API Basic
 * tier does NOT expose true impression_count/profile-clicks; `impression_proxy` is the SAME
 * disclosed stand-in `fetchRecentPostMetrics()` already uses elsewhere, never presented as a
 * real impression count) for shipped/partial editions, merged into the EXISTING
 * `organic_reach_snapshot` JSON blob via an atomic `json_set()` partial update (dev-council/
 * Kleppmann, P5, CONFIRMED — a read-modify-write JSON.stringify overwrite here would race the
 * edition-finalize write in cli.ts, which ALSO writes this column; see that file's own P5
 * comment on the matching fix applied there).
 *
 * REUSES `fetchRecentPostMetrics()` (skills/social-x-posting/lib/x-api.ts, arc-reach-unblock
 * P5) — does not implement a second metrics fetcher.
 */
export async function backfillEditionMetrics(db: Database, editionN?: number): Promise<EditionMetricsResult[]> {
  const rows = (
    editionN !== undefined
      ? db
          .query("SELECT edition_n, tweet_id FROM daily_read_log WHERE edition_n = ? AND status IN ('shipped','partial')")
          .all(editionN)
      : db
          .query("SELECT edition_n, tweet_id FROM daily_read_log WHERE status IN ('shipped','partial') ORDER BY edition_n")
          .all()
  ) as EligibleEditionRow[];

  const creds = await loadXCreds();
  if (!creds) {
    return rows.map((r) => ({ editionN: r.edition_n, tweetIds: [], metrics: null, skippedReason: "no X credentials configured" }));
  }

  const results: EditionMetricsResult[] = [];
  for (const row of rows) {
    const tweetIdRows = db
      .query("SELECT tweet_id FROM x_post_log WHERE source LIKE ? AND tweet_id IS NOT NULL")
      .all(`daily-read:${row.edition_n}:%`) as { tweet_id: string }[];
    const tweetIds = Array.from(
      new Set([row.tweet_id, ...tweetIdRows.map((t) => t.tweet_id)].filter((id): id is string => !!id)),
    );
    if (tweetIds.length === 0) {
      results.push({ editionN: row.edition_n, tweetIds: [], metrics: null, skippedReason: "no tweet ids on record" });
      continue;
    }
    try {
      const metrics = await fetchRecentPostMetrics(tweetIds, creds);
      const fetchedAt = new Date().toISOString();
      db.run(
        `UPDATE daily_read_log
           SET organic_reach_snapshot = json_set(
             coalesce(organic_reach_snapshot, '{}'),
             '$.post_metrics', json(?),
             '$.metrics_fetched_at', ?
           )
         WHERE edition_n = ?`,
        [JSON.stringify(metrics), fetchedAt, row.edition_n],
      );
      results.push({ editionN: row.edition_n, tweetIds, metrics, skippedReason: null });
    } catch (err) {
      results.push({
        editionN: row.edition_n,
        tweetIds,
        metrics: null,
        skippedReason: `fetchRecentPostMetrics failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Amplification detection — observed facts only; "declined" is NEVER persisted here
// ---------------------------------------------------------------------------

/** Jason's own operator X account — the amplification-channel doctrine's "his X" leg (see
 * memory: project_arc_operator_amplification_channel). Named constant (dev-council/Hohpe, P5,
 * CONFIRMED) instead of an inline literal repeated at multiple call sites — the exact drift
 * risk the SRC_TAGS extraction fixes for `?src=` tags, applied here too. */
export const OPERATOR_X_HANDLE = "whoabuddydev";

/** How long an edition must be live before an absence of detected amplification counts as a
 * real "no evidence yet" reading worth checking at all (not: worth declaring declined — that's
 * derived elsewhere, never here). */
const AMPLIFICATION_ELIGIBLE_AGE_HOURS = 24;
/** Cooldown between automated checks of the SAME edition (dev-council/Hohpe+Newman+Kleppmann,
 * P5, CONFIRMED — without this, a 30-min sensor tick re-checks every still-unknown edition on
 * every tick: up to ~48 X-API searches per edition before any age threshold even matters). */
const AMPLIFICATION_CHECK_COOLDOWN_HOURS = 6;

interface CheckableEditionRow {
  edition_n: number;
  tweet_id: string | null;
  root_tweet_url: string | null;
  posted_at: string | null;
  amplified_checked_at: string | null;
}

function hoursSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / (1000 * 60 * 60);
}

export interface AmplificationCheckResult {
  checked: number;
  matched: number;
  degraded: boolean;
  detail: string;
}

/**
 * Runs AT MOST ONE `searchRecentByHandle()` call (dev-council/Hohpe+Newman+Kleppmann, P5,
 * CONFIRMED — batch, don't loop per-edition) against every edition that is (a) shipped/partial,
 * (b) `amplified_status='unknown'`, (c) `posted_at` >= 24h old, and (d) not checked within the
 * last 6h. Returns immediately (no API call) if no edition qualifies.
 *
 * Every write is an atomic compare-and-swap (`WHERE amplified_status='unknown'`) — this is the
 * ENTIRE override-protection mechanism (dev-council/Lamport+Kleppmann, P5, CONFIRMED: a
 * read-then-write app-level guard, even one gated on a sentinel string, has a race window a
 * concurrent `markAmplification()` call can land inside; a single atomic UPDATE with the
 * CAS predicate closes it by construction — once a row leaves 'unknown' via a manual write, no
 * future auto-write's WHERE clause can ever match it again). NEVER writes 'declined' — only
 * 'unknown' (with an updated `amplified_checked_at`/`amplified_note`) or 'amplified'. Callers
 * needing an effective "has this lapsed?" reading derive it at read time from
 * `amplified_checked_at`'s age and `amplified_note`'s degraded marker (see report.ts).
 */
export async function checkAmplification(db: Database): Promise<AmplificationCheckResult> {
  const candidates = (
    db
      .query(
        `SELECT edition_n, tweet_id, root_tweet_url, posted_at, amplified_checked_at
         FROM daily_read_log
         WHERE status IN ('shipped','partial') AND amplified_status = 'unknown' AND posted_at IS NOT NULL`,
      )
      .all() as CheckableEditionRow[]
  ).filter(
    (r) =>
      hoursSince(r.posted_at) >= AMPLIFICATION_ELIGIBLE_AGE_HOURS &&
      hoursSince(r.amplified_checked_at) >= AMPLIFICATION_CHECK_COOLDOWN_HOURS,
  );

  if (candidates.length === 0) {
    return { checked: 0, matched: 0, degraded: false, detail: "no editions in the actionable window (unknown, >=24h old, not checked within 6h) — no API call made" };
  }

  const creds = await loadXCreds();
  if (!creds) {
    return { checked: 0, matched: 0, degraded: false, detail: "no X credentials configured — skipped" };
  }

  const searchResult = await searchRecentByHandle(OPERATOR_X_HANDLE, creds, { maxResults: 25 });
  const corpusEmpty = searchResult.tweets.length === 0;
  const nowIso = new Date().toISOString();
  let matched = 0;

  for (const edition of candidates) {
    const evidence = corpusEmpty
      ? null
      : searchResult.tweets.find(
          (t) =>
            (edition.tweet_id && t.text.includes(edition.tweet_id)) ||
            (edition.root_tweet_url && t.text.includes(edition.root_tweet_url)),
        );

    if (evidence) {
      matched++;
      db.run(
        `UPDATE daily_read_log SET amplified_status='amplified', amplified_source='auto',
           amplified_checked_at=?, amplified_note=?
         WHERE edition_n=? AND amplified_status='unknown'`,
        [nowIso, `auto:matched tweet ${evidence.id} @ ${evidence.created_at}`, edition.edition_n],
      );
    } else if (corpusEmpty) {
      // dev-council/Hohpe, P5, CONFIRMED: an empty corpus (0 tweets returned from the handle at
      // all) is a plumbing-fault signature (handle renamed/private/API shift), not a real "no
      // evidence" reading — must never be counted toward decline derivation.
      db.run(
        `UPDATE daily_read_log SET amplified_checked_at=?, amplified_note=?
         WHERE edition_n=? AND amplified_status='unknown'`,
        [nowIso, "auto:degraded, 0 tweets from handle", edition.edition_n],
      );
    } else {
      db.run(
        `UPDATE daily_read_log SET amplified_checked_at=?, amplified_note=?
         WHERE edition_n=? AND amplified_status='unknown'`,
        [nowIso, `auto:checked, 0 matches in ${searchResult.tweets.length}-tweet corpus`, edition.edition_n],
      );
    }
  }

  return {
    checked: candidates.length,
    matched,
    degraded: corpusEmpty,
    detail: corpusEmpty
      ? `searched from:${OPERATOR_X_HANDLE}, corpus EMPTY (0 tweets) — degraded probe, ${candidates.length} edition(s) left unresolved, none counted toward decline`
      : `searched from:${OPERATOR_X_HANDLE}, ${searchResult.tweets.length}-tweet corpus, ${matched}/${candidates.length} edition(s) matched`,
  };
}

/**
 * Manual override — the operator's own report always wins. Writes UNCONDITIONALLY (no CAS
 * guard needed here: this IS the final authority the auto-checker's `WHERE
 * amplified_status='unknown'` predicate is designed to defer to once this lands).
 */
export function markAmplification(db: Database, editionN: number, status: "amplified" | "unknown", note: string): void {
  db.run(
    `UPDATE daily_read_log SET amplified_status=?, amplified_source='manual', amplified_checked_at=?, amplified_note=?
     WHERE edition_n=?`,
    [status, new Date().toISOString(), note, editionN],
  );
}
