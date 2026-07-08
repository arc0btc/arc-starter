// skills/arc-attribution/lib/report.ts
//
// MRR / attribution report — P8 (arc-demand-flywheel). Reconciles whop_sale + x402_sale +
// checkout_config + whop_event_log into ONE report so the CEO report (skills/whop/lib/events.ts)
// and the Discord north-star monitor (manage-agents ops/monitor/arc-m0-north-star.ts) can source
// the same numbers and never disagree.
//
// Two independent Whop capture paths exist and this report treats both as first-class:
//   - whop_sale: populated by arc0btc-worker's embedded-checkout webhook. Carries `a_param`
//     channel attribution + `provenance` (organic | self_funded_test). Only source of one-time
//     -sale CHANNEL attribution.
//   - whop_event_log: populated by arc-starter's own whop skill (poll lane). Ground truth for
//     Whop's own view of memberships/payments — computeRevenue() in skills/whop/lib/events.ts
//     is the canonical MRR/paying-customer calculation and this report REUSES it rather than
//     re-deriving membership logic (single source of truth for "what counts as a paying member").
//     IMPORTANT (kleppmann, dev-council 2026-07-05): whop_event_log carries NO provenance
//     column. A self-funded test Whop purchase would be indistinguishable from a real organic
//     one in computeRevenue()'s output. `mrr.provenance_caveat` below states this explicitly —
//     never call this figure "organic" without also emitting that caveat, since M0-demand is
//     this quest's binding gate and a false organic reading here would be a false M0 signal.
//
// Reconciliation: `unattributed_dollars` compares computeRevenue()'s ground truth against
// whop_sale's attributed organic rows and surfaces ANY gap (not just the total-absence case) —
// never silently dropped or double counted.
//
// Schema: this JSON is a published, cross-machine contract (the Discord monitor on a SEPARATE
// host parses `cli.ts report --json`'s stdout — it cannot import this module). `schema_version`
// must bump on any breaking field change.
//
// P5 (arc-demand-gen close-out, 2026-07-05) added `demand_gen` — the single source of truth for
// 3 of the 4 lanes that quest shipped that are Arc's OWN state (daily-read scheduling via
// hook-state, mention pre-fill + seed batch via arc.sqlite), so
// `ops/monitor/arc-demand-gen-health.ts` (manage-agents repo) has one number to read instead of
// re-deriving a second, possibly-disagreeing count. The 4th lane (x402 directory listing status)
// is deliberately NOT here — dev-council (Hohpe/Newman, 2026-07-05) flagged that scan.stacksx402.com's
// listing state is third-party-owned data, not Arc's, and belongs in the control-plane monitor
// that already owns other third-party checks (SPF/DKIM/DMARC, boundary spot-checks), not proxied
// through this VM-side revenue-reporting module. Additive field, but bumped schema_version anyway
// per this file's own rule above.

import { getDatabase, initDatabase } from "../../../src/db.ts";
import { computeRevenue, type RevenueSummary } from "../../whop/lib/events.ts";
import { getCredential } from "../../../src/credentials.ts";
import { parseSkuBacklog } from "../../arc-packaging/lib/backlog.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readCachedFollowers } from "../../../src/follower-cache.ts";
// arc-day-n-publishing P5: the SAME src-tag registry (SRC_TAGS/withSrcTag) and the SAME
// computeStreak() fold arc-daily-read/cli.ts uses — imported, never re-derived (dev-council/
// Lamport, CONFIRMED — a second, independently-written streak fold or tag-coverage check would
// silently diverge from what actually shipped).
import { SRC_TAGS } from "./src-tags.ts";
import { computeStreak } from "../../arc-daily-read/lib/edition-metrics.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../../");
const INDEX_PATH = join(ARC_STARTER_ROOT, "research/INDEX.md");
const DAILY_READ_HOOK_STATE_PATH = join(ARC_STARTER_ROOT, "db/hook-state/arc-daily-read.json");
const DAILY_READ_CLI_PATH = join(ARC_STARTER_ROOT, "skills/arc-daily-read/cli.ts");
const SUBSCRIBER_EMAIL_PATH = join(ARC_STARTER_ROOT, "skills/arc-daily-read/subscriber-email.ts");

// arc-day-n-publishing P5 (dev-council/Fowler, CONFIRMED — the header's own rule didn't
// describe its own practice): real semver from here forward. MAJOR = a field is removed,
// renamed, or changes type (a breaking change for any consumer holding this shape). MINOR = a
// field is ADDED (this file's actual, repeated practice — P5's own day_n_publishing block is
// exactly this case). PATCH = a value/calculation changes without touching the shape at all.
export const SCHEMA_VERSION = "1.2.0";

/** Age in whole hours since an ISO timestamp; Infinity if null/unparseable (never counts as
 *  "old enough" — an unknown age must never satisfy an age-based threshold). */
function hoursSinceIso(iso: string | null): number {
  if (!iso) return Infinity;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? ms / (1000 * 60 * 60) : Infinity;
}

/** arc-day-n-publishing P5 (dev-council/Newman+Hohpe, CONFIRMED): "declined" is NEVER a
 *  persisted `daily_read_log.amplified_status` value — it is DERIVED here, at read time, from
 *  age + the absence of an observation, so a late amplification is always still recoverable and
 *  the 72h threshold is a config constant, not a migration. An `amplified_note` containing
 *  "degraded" (an empty search-corpus probe — see edition-metrics.ts's checkAmplification) is
 *  EXCLUDED from the decline bucket entirely and counted as `check_degraded` instead, so a
 *  broken amplification-check pipeline is never misread as "the operator declined."
 */
const DECLINE_DERIVATION_AGE_HOURS = 72;
function classifyAmplification(row: { amplified_status: string; amplified_note: string | null; posted_at: string | null }): "amplified" | "declined_derived" | "check_degraded" | "unknown" {
  if (row.amplified_status === "amplified") return "amplified";
  const degraded = row.amplified_note?.includes("degraded") ?? false;
  if (degraded) return "check_degraded";
  if (hoursSinceIso(row.posted_at) >= DECLINE_DERIVATION_AGE_HOURS) return "declined_derived";
  return "unknown";
}

// P0 baseline (2026-07-03T160204Z) — cite, don't re-derive. See
// ops/verify/arc-demand-flywheel/2026-07-03T160204Z-p0-baseline.md
// "Before/After Metric Table Skeleton" (manage-agents repo).
export const P0_BASELINE = {
  followers: 51,
  daily_read_editions: 2,
  articles_published: 0,
  free_room_joins: 1,
  one_time_sales_organic: 0,
  x402_sales_self_funded: 3,
  x402_sales_organic: 0,
  mrr_cents: 0,
} as const;

export interface ProvenanceBucket {
  organic: number;
  self_funded_test: number;
  other: number;
}

export interface ChannelBreakdownRow {
  channel: string; // a_param, or "unmapped"
  organic_count: number;
  self_funded_test_count: number;
  organic_amount_cents: number;
  /** false if any organic row folded into this total was an x402 sale (base-units, not summed
   * as cents) — i.e. organic_amount_cents may UNDERCOUNT this channel's real organic revenue.
   * See known_gaps for the full explanation. */
  organic_amount_cents_complete: boolean;
  /** count of organic rows in this channel with a NULL/zero recorded amount — a data-quality
   * signal (an attributed sale with no captured price is still worth a human look). */
  organic_rows_with_missing_amount: number;
}

export interface AttributionReport {
  schema_version: string;
  /** "ok" = report computed cleanly (unattributed_dollars may still be non-empty — that is a
   * business signal, not a failure); "error" = computeAttributionReport() itself threw (see
   * cli.ts's wrapper) — consumers must check this before trusting any other field. */
  status: "ok";
  generated_at: string;
  mrr: {
    mrr_cents: number;
    active_members: number;
    paying_customers: number;
    paying_product_customers: number;
    source: string;
    /** whop_event_log (computeRevenue()'s source) has no provenance column — a self-funded
     * test Whop purchase would be indistinguishable from an organic one here. Cross-check
     * unattributed_dollars before treating mrr_cents>0 as confirmed organic M0-demand. */
    provenance_caveat: string;
  };
  provenance: {
    whop_sale: ProvenanceBucket;
    x402_sale: ProvenanceBucket;
  };
  channel_breakdown: ChannelBreakdownRow[];
  pipeline: {
    whop_sale_rows: number;
    x402_sale_organic: number;
    x402_sale_self_funded: number;
    free_room_joins: number;
    email_subscribers_confirmed: number | null;
    email_subscribers_pending: number | null;
    email_api_error: string | null;
  };
  reach: {
    followers: { current: number | null; delta_vs_p0: number | null; degraded: boolean; note: string };
    daily_read_editions_posted: number;
    articles_published: number;
    articles_staged_unfired: number;
    packaging_backlog_remaining: number | null;
    packaging_backlog_error: string | null;
  };
  before_after: Array<{ metric: string; before: number | string; after: number | string }>;
  unattributed_dollars: Array<{ detail: string; gap_count: number }>;
  known_gaps: string[];
  /** P5 (arc-demand-gen close-out): the single source of truth for the 4 lanes that quest shipped
   * (P1 daily-read scheduling, P2 x402 listing, P3 mention pre-fill, P4 seed batch). Added so
   * `ops/monitor/arc-demand-gen-health.ts` (manage-agents repo) reads these numbers rather than
   * re-deriving a second, possibly-disagreeing count — see that file's header comment. */
  demand_gen: {
    daily_read: {
      /** date string (YYYY-MM-DD, UTC) the sensor last successfully queued an edition, or null if
       * the hook-state file is missing/unreadable/never set. */
      last_queued_date: string | null;
      /** whole days between `last_queued_date` and today (UTC midnight to UTC midnight) — the
       * same durable, cron-timing-independent staleness signal
       * `ops/monitor/arc-flywheel-health.ts`'s `checkDailyReadStarvation()` already uses; null if
       * `last_queued_date` is unavailable. */
      days_stale: number | null;
      /** most recent defer reason recorded on the sensor's defer branch (e.g.
       * "cap_insufficient"), regardless of age — null if never recorded. */
      last_defer_reason: string | null;
      last_defer_at: string | null;
      last_slots_remaining: number | null;
      /** non-null only if the hook-state file couldn't be read/parsed at all (missing file is
       * NOT an error — a brand-new VM would have none yet — but a malformed file is). */
      hook_state_error: string | null;
    };
    // NOTE (dev-council, 2026-07-05, Hohpe+Newman independently, 5/5 lenses flagged the original
    // substring-match implementation as unsound): x402 listing status is intentionally NOT
    // reported here. Unlike the 3 lanes above (Arc's own hook-state file, Arc's own arc.sqlite
    // tables), whether scan.stacksx402.com lists arc0btc.com is a THIRD PARTY's data, not Arc's —
    // this module would need to know that site's URL/response shape to check it, which is
    // exactly the kind of external coupling `ops/monitor/arc-flywheel-health.ts` already keeps
    // OUT of arc-attribution for its own third-party checks (SPF/DKIM/DMARC via `dig`, boundary
    // spot-checks via `curl`, done directly in the control-plane monitor, not proxied through the
    // VM). `ops/monitor/arc-demand-gen-health.ts` performs this check directly for the same
    // reason: it can parse the real JSON response and treat network failure as "unknown," not a
    // silent false, without adding third-party HTTP latency to every attribution report run.
    mention_pipeline: {
      /** `social_accounts` rows curated as mention candidates (P3). */
      candidates_curated: number;
      /** total rows in `article_mention_log` (P3) — every pre-filled @-mention the pipeline has
       * ever recorded, across all articles. */
      mention_events_total: number;
      last_mention_article_n: number | null;
      last_mention_at: string | null;
    };
    seed_batch: {
      /** `outbound_action` rows with platform IN ('jason-x','jason-email') — the schema P4's
       * playbook names for Arc to log an operator-channel action AFTER Jason reports one back.
       * 0 is the correct, hard-gate-compliant state until that happens — not a failure signal. */
      operator_channel_actions_logged: number;
      note: string;
    };
    /** arc-day-n-publishing P5: the single source of truth for Day-N attribution — per-surface
     * `?src=` tag coverage, per-edition amplification status (observed facts + a derived
     * decline/degraded read, NEVER a persisted "declined" fact — see classifyAmplification()),
     * and a funnel snapshot built from fields THIS SAME function already computes elsewhere
     * (no re-query). `streak` is computed by the SAME `computeStreak()` arc-daily-read/cli.ts
     * itself uses — imported, not re-derived, so the two can never silently disagree. */
    day_n_publishing: {
      latest_edition_n: number | null;
      latest_status: string | null;
      streak: number;
      editions_total: number;
      subscriber_email: { sent_count: number; last_sent_at: string | null };
      amplification: { amplified: number; declined_derived: number; check_degraded: number; unknown: number };
      src_tag_coverage: {
        /** Real live-emission check: does the actual last `moltbook_post.labeled_link` row
         *  carry the `src=moltbook` substring? Not a self-reconstruction of the constant. */
        moltbook: boolean | "no_posts_yet";
        /** Deployed-source-bytes checks (dev-council/Lamport, CONFIRMED — a check that
         *  reconstructs a URL from the SAME constant it's verifying is tautological, see
         *  docs/specs/2026-07-08-day-n-attribution-design.md §5 finding #6): these read the
         *  LIVE cli.ts/subscriber-email.ts file content at runtime and regex-match the exact
         *  SRC_TAGS call-site usage — real but partial (proves the deployed call site is
         *  correct, not that a specific live tweet/email actually rendered the tag). */
        day_n_x: boolean;
        email: boolean;
        /** Derived from SRC_TAGS' own `status` field (single source, dev-council/Fowler) —
         *  never hardcoded a 2nd/3rd time. Today: blog="staged_not_deployed" (P2 hard-gate,
         *  awaiting operator prod-flip authorization); whop_free/nostr="not_wired_to_day_n"
         *  (a standing P1/P3 architectural choice, not a gap). */
        blog: "staged_not_deployed" | "not_wired_to_day_n";
        whop_free: "staged_not_deployed" | "not_wired_to_day_n";
        nostr: "staged_not_deployed" | "not_wired_to_day_n";
      };
      funnel: {
        subscribe_confirmed: number | null;
        subscribe_pending: number | null;
        whop_organic_total: number;
        x402_organic_total: number;
        channel_breakdown_ref: string;
      };
    };
  };
}

function bucketProvenance(rows: Array<{ provenance: string | null }>): ProvenanceBucket {
  const b: ProvenanceBucket = { organic: 0, self_funded_test: 0, other: 0 };
  for (const r of rows) {
    if (r.provenance === "organic") b.organic++;
    else if (r.provenance === "self_funded_test") b.self_funded_test++;
    else b.other++;
  }
  return b;
}

/** Read-only backlog count for reporting — REUSES arc-packaging/lib/backlog.ts's own
 * `parseSkuBacklog()` (the single source of truth for what's in the "not yet packaged" table;
 * dev-council already fixed a real divergent-second-implementation bug here on 2026-07-03 — do
 * not re-derive this with a second regex). Counts relevance>=4 rows only, matching
 * `selectCandidate()`'s own eligibility filter. Returns a distinct error string on failure
 * (hohpe, dev-council 2026-07-05: a bare null collapses "file missing", "parse crash", and
 * "zero eligible" into one indistinguishable state). */
function parseBacklogRemaining(): { count: number | null; error: string | null } {
  try {
    return { count: parseSkuBacklog(INDEX_PATH).filter((r) => r.relevance >= 4).length, error: null };
  } catch (err) {
    return { count: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchEmailSubscriberStats(): Promise<{ confirmed: number | null; pending: number | null; error: string | null }> {
  try {
    const apiBaseUrl = await getCredential("email", "api_base_url");
    const adminKey = await getCredential("email", "admin_api_key");
    if (!apiBaseUrl || !adminKey) {
      return { confirmed: null, pending: null, error: "email credentials not configured" };
    }
    const res = await fetch(`${apiBaseUrl}/api/subscribers/stats`, {
      headers: { "X-Admin-Key": adminKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { confirmed: null, pending: null, error: `HTTP ${res.status}` };
    const body = (await res.json()) as Record<string, unknown>;
    // Live shape confirmed 2026-07-05: {"ok":true,"data":{"pending":N,"confirmed":N,...}}.
    // Also accept a bare top-level {confirmed,pending} or {stats:{...}} shape defensively —
    // whichever is actually present, never guess a nesting that doesn't exist.
    const stats =
      (body.data as Record<string, unknown> | undefined) ??
      (body.stats as Record<string, unknown> | undefined) ??
      body;
    // newman, dev-council 2026-07-05: a missing/renamed key must surface as null (unknown),
    // never as a silent 0 — a 0 is a claim ("we checked, there are none"), null is honest doubt.
    return {
      confirmed: typeof stats.confirmed === "number" ? stats.confirmed : null,
      pending: typeof stats.pending === "number" ? stats.pending : null,
      error: typeof stats.confirmed === "number" && typeof stats.pending === "number"
        ? null
        : `unexpected response shape from /api/subscribers/stats: ${JSON.stringify(body).slice(0, 200)}`,
    };
  } catch (err) {
    return { confirmed: null, pending: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Whole UTC-midnight-to-UTC-midnight days between a YYYY-MM-DD date string and now — identical
 * formula to `ops/monitor/arc-flywheel-health.ts`'s `daysSinceUtcDateString()` (manage-agents
 * repo; can't be imported cross-repo, reimplemented here intentionally kept in lockstep). Returns
 * null (not NaN) if `dateStr` doesn't parse to a real date — a malformed hook-state value must
 * surface as "unknown," never silently serialize as a number-shaped non-number (dev-council,
 * Lamport, 2026-07-05: `JSON.stringify(NaN) === "null"` would otherwise make a garbage string and
 * an honestly-absent value indistinguishable on the wire, and diverge between this JSON path and
 * cli.ts's human-readable `?? "?"` path, which prints literal "NaN"). */
function daysSinceUtcDateString(dateStr: string, nowUtc: Date): number | null {
  const then = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(then)) return null;
  const today = new Date(`${nowUtc.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.round((today - then) / 86_400_000);
}

interface DailyReadHookState {
  last_defer_reason?: string;
  last_defer_at?: string;
  last_slots_remaining?: number;
  last_queued_date?: string;
  [key: string]: unknown;
}

/** Reads `arc-daily-read`'s hook-state file directly (this runs ON the VM — no SSH needed, unlike
 * the manage-agents monitor's equivalent read). Never throws: a missing/malformed file surfaces
 * as `hook_state_error`, not a crash of the whole report (P5, arc-demand-gen).
 *
 * HONEST LIMIT (dev-council, Lamport/Kleppmann, 2026-07-05): this file read happens AFTER
 * `readDbSnapshot()`'s transaction has already committed, at a distinct wall-clock instant from
 * the DB snapshot and from `generated_at`. Arc's dispatch loop can write a `daily_read_log` row
 * and this hook-state file at different moments; a run landing between those two writes will
 * report a `daily_read_editions_posted` count and a `last_queued_date` that describe different
 * instants. This is consistent with how `fetchEmailSubscriberStats()`/`readCachedFollowers()`
 * already behave (independent best-effort point reads, not covered by the SQLite snapshot
 * guarantee) — not a regression, but worth stating plainly rather than implying the whole report
 * is one atomic snapshot. The DB-only consistency guarantee is exactly that: DB-only. */
function readDailyReadHookState(): AttributionReport["demand_gen"]["daily_read"] {
  try {
    const raw = readFileSync(DAILY_READ_HOOK_STATE_PATH, "utf8");
    const state = JSON.parse(raw) as DailyReadHookState;
    const nowUtc = new Date();
    const rawLastQueuedDate = typeof state.last_queued_date === "string" ? state.last_queued_date : null;
    const daysStale = rawLastQueuedDate ? daysSinceUtcDateString(rawLastQueuedDate, nowUtc) : null;
    // Invariant: days_stale is null IFF last_queued_date is unavailable — a present-but-unparseable
    // date string (daysSinceUtcDateString returned null despite a non-null input) must NOT be
    // reported as a valid date either; both collapse to the honest-unknown state together.
    const lastQueuedDateValid = rawLastQueuedDate !== null && daysStale !== null;
    return {
      last_queued_date: lastQueuedDateValid ? rawLastQueuedDate : null,
      days_stale: daysStale,
      last_defer_reason: typeof state.last_defer_reason === "string" ? state.last_defer_reason : null,
      last_defer_at: typeof state.last_defer_at === "string" ? state.last_defer_at : null,
      last_slots_remaining: typeof state.last_slots_remaining === "number" ? state.last_slots_remaining : null,
      hook_state_error: rawLastQueuedDate !== null && !lastQueuedDateValid
        ? `last_queued_date "${rawLastQueuedDate}" is not a parseable date`
        : null,
    };
  } catch (err) {
    // A missing file (ENOENT) is expected on a fresh install, not a real error — but we can't
    // tell the difference from a malformed-JSON error without inspecting the code, and both are
    // equally "we don't know the real state" from this report's point of view. Surface it plainly
    // rather than guessing; a human reading `hook_state_error` can tell ENOENT from a parse error.
    return {
      last_queued_date: null,
      days_stale: null,
      last_defer_reason: null,
      last_defer_at: null,
      last_slots_remaining: null,
      hook_state_error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * All synchronous, arc.sqlite-only reads needed for the report, run inside ONE transaction so
 * they observe a single consistent snapshot (lamport, dev-council 2026-07-05: separate top-level
 * statements against a DB that Arc's own live dispatch loop writes every minute can otherwise
 * see read skew — e.g. a membership activated between two of this function's queries would show
 * up in one count and not another within the same emitted report). computeRevenue() is called
 * INSIDE the same transaction (same connection, synchronous call, no awaits in between) so its
 * internal reads participate in the same snapshot.
 *
 * VERIFIED (dev-council, Kleppmann, 2026-07-05, flagged as an unconfirmed assumption in the
 * original comment; confirmed this phase): `src/db.ts`'s `getDatabase()` returns a cached
 * module-level singleton (`_db`), never a fresh connection — `skills/whop/lib/events.ts`'s
 * `computeRevenue()` calls the identical `getDatabase()` accessor (confirmed by direct grep of
 * that file), so it participates in this same transaction/connection. The snapshot guarantee
 * this comment describes actually holds.
 */
function readDbSnapshot(db: ReturnType<typeof getDatabase>) {
  let result!: {
    revenue: RevenueSummary;
    whopSaleRows: Array<{ provenance: string | null; price_cents: number | null; a_param: string | null }>;
    x402SaleRows: Array<{ provenance: string | null; amount_base_units: number | null; a_param: string | null }>;
    checkoutConfigParams: string[];
    freeRoomJoins: number;
    dailyReadEditions: number;
    articlesPublished: number;
    articlesStaged: number;
    mentionCandidatesCurated: number;
    mentionEventsTotal: number;
    lastMention: { article_n: number; created_at: string } | null;
    seedBatchActionsLogged: number;
    dayNStreak: number;
    dayNEditionsTotal: number;
    dayNLatest: { edition_n: number; status: string } | null;
    dayNAmplificationRows: Array<{ amplified_status: string; amplified_note: string | null; posted_at: string | null }>;
    dayNEmailSentCount: number;
    dayNEmailLastSentAt: string | null;
    dayNMoltbookLabeledLink: string | null;
    dayNMoltbookPostExists: boolean;
  };
  const tx = db.transaction(() => {
    const revenue = computeRevenue();
    const whopSaleRows = db
      .query("SELECT provenance, price_cents, a_param FROM whop_sale")
      .all() as typeof result.whopSaleRows;
    const x402SaleRows = db
      .query("SELECT provenance, amount_base_units, a_param FROM x402_sale")
      .all() as typeof result.x402SaleRows;
    const checkoutConfigParams = (
      db.query("SELECT DISTINCT a_param FROM checkout_config").all() as Array<{ a_param: string | null }>
    )
      .map((r) => r.a_param)
      .filter((v): v is string => !!v);
    const freeRoomJoins = (
      db
        .query(
          "SELECT COUNT(*) c FROM whop_event_log WHERE type='membership.activated' AND (amount_cents IS NULL OR amount_cents=0)",
        )
        .get() as { c: number }
    ).c;
    const dailyReadEditions = (db.query("SELECT COUNT(*) c FROM daily_read_log").get() as { c: number }).c;
    const articlesPublished = (
      db.query("SELECT COUNT(*) c FROM article_queue_log WHERE status='published'").get() as { c: number }
    ).c;
    const articlesStaged = (
      db.query("SELECT COUNT(*) c FROM article_queue_log WHERE status='staged'").get() as { c: number }
    ).c;
    // P5 (arc-demand-gen close-out) — P3's mention pre-fill + P4's seed-batch signals, read in
    // the same snapshot transaction as everything else above (lamport/dev-council's
    // read-skew-avoidance pattern applies equally to these new tables). DISCLOSED, not fixed
    // (dev-council, Fowler, 2026-07-05): unlike `readDailyReadHookState()`'s explicit
    // missing-file tolerance, these 3 queries assume `social_accounts`/`article_mention_log`/
    // `outbound_action` already exist — consistent with every other query in this transaction
    // (e.g. `daily_read_log`, `article_queue_log` above make the identical assumption), so this
    // is not a new risk this phase introduces, just an existing pattern extended to 3 more
    // tables. A genuinely fresh VM predating P1-P4's migrations would see this whole report fail
    // with `status:"error"` rather than degrade gracefully — real, but out of this phase's scope.
    const mentionCandidatesCurated = (
      db.query("SELECT COUNT(*) c FROM social_accounts WHERE mention_candidate=1").get() as { c: number }
    ).c;
    const mentionEventsTotal = (
      db.query("SELECT COUNT(*) c FROM article_mention_log").get() as { c: number }
    ).c;
    const lastMention = db
      .query("SELECT article_n, created_at FROM article_mention_log ORDER BY created_at DESC LIMIT 1")
      .get() as { article_n: number; created_at: string } | null;
    const seedBatchActionsLogged = (
      db
        .query("SELECT COUNT(*) c FROM outbound_action WHERE platform IN ('jason-x','jason-email')")
        .get() as { c: number }
    ).c;
    // arc-day-n-publishing P5 (dev-council/Kleppmann, CONFIRMED — these DB-derived fields must
    // be read INSIDE this same snapshot transaction, matching the P3 mention-pipeline fields'
    // own precedent above, not added as a separate query after this transaction closes).
    const dayNStreak = computeStreak(db);
    const dayNEditionsTotal = dailyReadEditions; // same table, already counted above — reuse.
    const dayNLatest = db
      .query("SELECT edition_n, status FROM daily_read_log ORDER BY edition_n DESC LIMIT 1")
      .get() as { edition_n: number; status: string } | null;
    const dayNAmplificationRows = db
      .query(
        "SELECT amplified_status, amplified_note, posted_at FROM daily_read_log WHERE status IN ('shipped','partial')",
      )
      .all() as Array<{ amplified_status: string; amplified_note: string | null; posted_at: string | null }>;
    const dayNEmailAgg = db
      .query(
        "SELECT COUNT(*) c, MAX(subscriber_email_sent_at) last FROM daily_read_log WHERE subscriber_email_sent=1",
      )
      .get() as { c: number; last: string | null };
    const moltbookRow = db
      .query("SELECT labeled_link FROM moltbook_post ORDER BY id DESC LIMIT 1")
      .get() as { labeled_link: string | null } | null;
    result = {
      revenue,
      whopSaleRows,
      x402SaleRows,
      checkoutConfigParams,
      freeRoomJoins,
      dailyReadEditions,
      articlesPublished,
      articlesStaged,
      mentionCandidatesCurated,
      mentionEventsTotal,
      lastMention,
      seedBatchActionsLogged,
      dayNStreak,
      dayNEditionsTotal,
      dayNLatest,
      dayNAmplificationRows,
      dayNEmailSentCount: dayNEmailAgg.c,
      dayNEmailLastSentAt: dayNEmailAgg.last,
      dayNMoltbookLabeledLink: moltbookRow?.labeled_link ?? null,
      dayNMoltbookPostExists: moltbookRow !== null,
    };
  });
  tx.deferred();
  return result;
}

export async function computeAttributionReport(): Promise<AttributionReport> {
  initDatabase();
  const db = getDatabase();

  const snap = readDbSnapshot(db);
  const {
    revenue,
    whopSaleRows,
    x402SaleRows,
    freeRoomJoins,
    dailyReadEditions,
    articlesPublished,
    articlesStaged,
    mentionCandidatesCurated,
    mentionEventsTotal,
    lastMention,
    seedBatchActionsLogged,
    dayNStreak,
    dayNEditionsTotal,
    dayNLatest,
    dayNAmplificationRows,
    dayNEmailSentCount,
    dayNEmailLastSentAt,
    dayNMoltbookLabeledLink,
    dayNMoltbookPostExists,
  } = snap;
  const checkoutConfigParams = new Set(snap.checkoutConfigParams);

  const whopProvenance = bucketProvenance(whopSaleRows);
  const x402Provenance = bucketProvenance(x402SaleRows);

  const channelMap = new Map<string, ChannelBreakdownRow>();
  function bump(aParam: string | null, provenance: string | null, amountCents: number, isComplete: boolean) {
    const channel = aParam && checkoutConfigParams.has(aParam) ? aParam : (aParam ?? "unmapped");
    if (!channelMap.has(channel)) {
      channelMap.set(channel, {
        channel,
        organic_count: 0,
        self_funded_test_count: 0,
        organic_amount_cents: 0,
        organic_amount_cents_complete: true,
        organic_rows_with_missing_amount: 0,
      });
    }
    const row = channelMap.get(channel)!;
    if (provenance === "organic") {
      row.organic_count++;
      row.organic_amount_cents += amountCents;
      if (!isComplete) row.organic_amount_cents_complete = false;
      if (isComplete && amountCents === 0) row.organic_rows_with_missing_amount++;
    } else if (provenance === "self_funded_test") {
      row.self_funded_test_count++;
    }
  }
  for (const r of whopSaleRows) bump(r.a_param, r.provenance, r.price_cents ?? 0, r.price_cents !== null);
  // x402 amounts are on-chain base units (STX/sBTC-denominated), not cents — counted, not
  // dollar-summed here; marks the channel's $ total incomplete rather than lying with a 0.
  for (const r of x402SaleRows) bump(r.a_param, r.provenance, 0, false);

  // kleppmann/lamport, dev-council 2026-07-05: surface the ACTUAL gap between ground-truth
  // paying customers and attributed organic whop_sale rows, not just the total-absence case
  // (the original version only fired when organic===0, missing a partial-attribution gap).
  const unattributedDollars: AttributionReport["unattributed_dollars"] = [];
  const attributionGap = revenue.payingCustomers - whopProvenance.organic;
  if (attributionGap > 0) {
    unattributedDollars.push({
      gap_count: attributionGap,
      detail: `computeRevenue() reports ${revenue.payingCustomers} paying customer(s) total (source of truth: whop_event_log) but whop_sale has only ${whopProvenance.organic} organic row(s) — ${attributionGap} paying customer(s) have no channel attribution. Check arc0btc-worker's checkout webhook is firing for every sale. (Coarse count-based signal — whop_sale rows and computeRevenue()'s distinct-user counts are not guaranteed 1:1, so treat this as "investigate," not an exact dollar figure.)`,
    });
  }
  for (const row of channelMap.values()) {
    if (row.organic_rows_with_missing_amount > 0) {
      unattributedDollars.push({
        gap_count: row.organic_rows_with_missing_amount,
        detail: `channel "${row.channel}" has ${row.organic_rows_with_missing_amount} organic whop_sale row(s) with a NULL/zero price_cents — attributed but amountless, showing as $0 in channel_breakdown. Needs a data-quality look.`,
      });
    }
  }

  const emailStats = await fetchEmailSubscriberStats();
  const followerCache = await readCachedFollowers();
  const backlog = parseBacklogRemaining();
  const dailyReadHookState = readDailyReadHookState();

  // arc-day-n-publishing P5: amplification counts are DERIVED here (never read off a persisted
  // "declined" column — none exists, see classifyAmplification()'s doc comment).
  const amplificationCounts = { amplified: 0, declined_derived: 0, check_degraded: 0, unknown: 0 };
  for (const row of dayNAmplificationRows) amplificationCounts[classifyAmplification(row)]++;

  // src_tag_coverage (dev-council/Lamport, CONFIRMED — must check REAL deployed artifacts, not
  // a self-reconstruction of the same SRC_TAGS constant; see the interface doc comment above).
  let dayNXTagDeployed = false;
  let emailTagDeployed = false;
  try {
    const cliSource = readFileSync(DAILY_READ_CLI_PATH, "utf8");
    dayNXTagDeployed = /SRC_TAGS\.DAY_N_X\.tag/.test(cliSource);
  } catch { /* file unreadable — stays false, a real FAIL signal for the monitor */ }
  try {
    const emailSource = readFileSync(SUBSCRIBER_EMAIL_PATH, "utf8");
    emailTagDeployed = /SRC_TAGS\.EMAIL\.tag/.test(emailSource);
  } catch { /* file unreadable — stays false */ }
  const moltbookTagLive: boolean | "no_posts_yet" = !dayNMoltbookPostExists
    ? "no_posts_yet"
    : (dayNMoltbookLabeledLink?.includes(`src=${SRC_TAGS.MOLTBOOK.tag}`) ?? false);

  // dev-council/Fowler, CONFIRMED: derive the honest non-live-state strings from SRC_TAGS' own
  // `status` field (one source), not a 2nd/3rd hardcoded literal — if a tag's status ever
  // changes (e.g. blog goes "live" after the P2 prod-flip authorization), this follows without
  // a second edit site.
  function nonLiveStateLabel(status: "live" | "staged" | "reserved"): "staged_not_deployed" | "not_wired_to_day_n" {
    return status === "staged" ? "staged_not_deployed" : "not_wired_to_day_n";
  }

  const beforeAfter: AttributionReport["before_after"] = [
    { metric: "X followers", before: P0_BASELINE.followers, after: followerCache.followers ?? "unknown (degraded)" },
    { metric: "Daily Read editions posted", before: P0_BASELINE.daily_read_editions, after: dailyReadEditions },
    { metric: "Long-form articles published (fired)", before: P0_BASELINE.articles_published, after: articlesPublished },
    { metric: "Free-room joins", before: P0_BASELINE.free_room_joins, after: freeRoomJoins },
    { metric: "One-time sales (organic)", before: P0_BASELINE.one_time_sales_organic, after: whopProvenance.organic },
    { metric: "x402 sales (self-funded test)", before: P0_BASELINE.x402_sales_self_funded, after: x402Provenance.self_funded_test },
    { metric: "x402 sales (organic)", before: P0_BASELINE.x402_sales_organic, after: x402Provenance.organic },
    { metric: "MRR (cents, per whop_event_log — see provenance_caveat)", before: P0_BASELINE.mrr_cents, after: revenue.mrrCents },
  ];

  return {
    schema_version: SCHEMA_VERSION,
    status: "ok",
    generated_at: new Date().toISOString(),
    mrr: {
      mrr_cents: revenue.mrrCents,
      active_members: revenue.activeMembers,
      paying_customers: revenue.payingCustomers,
      paying_product_customers: revenue.payingProductCustomers,
      source: "computeRevenue() — skills/whop/lib/events.ts (whop_event_log ground truth)",
      provenance_caveat:
        "whop_event_log has no provenance column — this figure is Whop's own captured truth, NOT independently confirmed organic. Cross-check unattributed_dollars: if it is non-empty, some of this revenue lacks channel attribution and its organic/self-funded status is unconfirmed.",
    },
    provenance: { whop_sale: whopProvenance, x402_sale: x402Provenance },
    channel_breakdown: Array.from(channelMap.values()),
    pipeline: {
      whop_sale_rows: whopSaleRows.length,
      x402_sale_organic: x402Provenance.organic,
      x402_sale_self_funded: x402Provenance.self_funded_test,
      free_room_joins: freeRoomJoins,
      email_subscribers_confirmed: emailStats.confirmed,
      email_subscribers_pending: emailStats.pending,
      email_api_error: emailStats.error,
    },
    reach: {
      followers: {
        current: followerCache.followers,
        delta_vs_p0: followerCache.followers !== null ? followerCache.followers - P0_BASELINE.followers : null,
        degraded: followerCache.degraded,
        note: followerCache.note,
      },
      daily_read_editions_posted: dailyReadEditions,
      articles_published: articlesPublished,
      articles_staged_unfired: articlesStaged,
      packaging_backlog_remaining: backlog.count,
      packaging_backlog_error: backlog.error,
    },
    before_after: beforeAfter,
    unattributed_dollars: unattributedDollars,
    known_gaps: [
      "No checkout-click/traffic-start instrumentation exists anywhere — only conversions (whop_sale, x402_sale, whop_event_log) are tracked. 'Traffic' in the before/after table is therefore conversion-adjacent, not true funnel-top traffic.",
      "x402_sale amounts are on-chain base units (STX/sBTC-denominated), not cents — not folded into channel_breakdown's organic_amount_cents (see organic_amount_cents_complete per row) or the $ MRR total; see provenance.x402_sale for counts only.",
      "7d ship-log count (CEO report) remains unbuilt — no ship-board skill exists to track member ship-log posts; structurally impossible before any $49 member exists.",
      "Email subscriber counts depend on arc-email-worker's live API; email_api_error is non-null if that call failed or returned an unexpected shape this run.",
      "mrr.mrr_cents is Whop's own captured truth (whop_event_log), not independently provenance-confirmed — see mrr.provenance_caveat.",
      "Arc's x402 rail is still unlisted on scan.stacksx402.com — P2 (arc-demand-gen) hit a schema mismatch with the crawler and did not fix arc0btc-worker's response shape; carry-forward, not yet built. Checked directly by ops/monitor/arc-demand-gen-health.ts (manage-agents repo), not this report — it's third-party-owned data, not Arc's own state.",
      "demand_gen.seed_batch.operator_channel_actions_logged has been 0 since P4 (arc-demand-gen) shipped its playbook — this is the expected, hard-gate-compliant state (no bulk send occurred), not a broken lane; it will only move once Jason reports an operator-channel action back for Arc to log.",
      "demand_gen.seed_batch counts outbound_action rows by a hardcoded platform IN ('jason-x','jason-email') list (dev-council, Kleppmann, 2026-07-05) — a real future-proofing gap: a third operator channel added later would silently undercount unless this list is also updated, or the schema evolves to a data-side is_operator_channel flag instead. Not fixed this phase (P4 built no insert path yet — 0 rows exist to migrate); flagged for whoever adds the next channel.",
      // arc-day-n-publishing P5 (dev-council, all 15 findings applied — see
      // docs/specs/2026-07-08-day-n-attribution-design.md §5):
      "No top-of-funnel click tracking exists anywhere — the day_n_publishing.funnel block starts at /subscribe (real confirmed/pending counts), not at 'click'. Building real click tracking needs a redirect/shortener service, a site-level build out of this quest's scope.",
      "Follows cannot be split per-lane (reply-lane vs Day-N vs quote-tweets) — readCachedFollowers() caches a point-in-time COUNT, not a follower LIST to diff against. Evaluated this phase (dev-council/Newman): no existing follower-list-fetch function, and X API Basic tier's followers-list endpoint is severely rate-limited — not a cheap add to an already-large phase. Only a total follower-count delta (reach.followers.delta_vs_p0) is available as a proxy.",
      "src_tag_coverage.whop_free/nostr are 'not_wired_to_day_n' by design, not by gap: P1 retired the free-room CTA from the Day-N X thread in favor of $9/subscribe-only, and Nostr syndicates from a separate LLM-artifact pool unrelated to Day-N blog content. A standing architectural choice inherited from P1/P3, not a P5 regression.",
      "?src= (this file's first-party channel tag) and ?a= (Whop's own affiliate-attribution param, see checkout_config/channel_breakdown) are DISJOINT attribution namespaces that do not compose across the arc0.me->Whop hop — there is no way today to answer 'did this src=day-n-x click become that Whop purchase.' Unifying them (or proving ?src= survives the hop) is a prerequisite for true click->purchase attribution, not solved this phase (dev-council/Hohpe).",
    ],
    demand_gen: {
      daily_read: dailyReadHookState,
      mention_pipeline: {
        candidates_curated: mentionCandidatesCurated,
        mention_events_total: mentionEventsTotal,
        last_mention_article_n: lastMention?.article_n ?? null,
        last_mention_at: lastMention?.created_at ?? null,
      },
      seed_batch: {
        operator_channel_actions_logged: seedBatchActionsLogged,
        note:
          "0 is expected/correct until Jason reports an operator-channel (X reply or email) action back to Arc per the P4 playbook (docs/specs/2026-07-05-arc-demand-gen-operator-playbook.md Part A §5) — Arc then logs the row. A non-zero value here is real signal the playbook is being used, not a bug. Counted via a hardcoded platform-value list, see known_gaps.",
      },
      day_n_publishing: {
        latest_edition_n: dayNLatest?.edition_n ?? null,
        latest_status: dayNLatest?.status ?? null,
        streak: dayNStreak,
        editions_total: dayNEditionsTotal,
        subscriber_email: { sent_count: dayNEmailSentCount, last_sent_at: dayNEmailLastSentAt },
        amplification: amplificationCounts,
        src_tag_coverage: {
          moltbook: moltbookTagLive,
          day_n_x: dayNXTagDeployed,
          email: emailTagDeployed,
          blog: nonLiveStateLabel(SRC_TAGS.BLOG.status),
          whop_free: nonLiveStateLabel(SRC_TAGS.WHOP_FREE.status),
          nostr: nonLiveStateLabel(SRC_TAGS.NOSTR.status),
        },
        funnel: {
          subscribe_confirmed: emailStats.confirmed,
          subscribe_pending: emailStats.pending,
          whop_organic_total: whopProvenance.organic,
          x402_organic_total: x402Provenance.organic,
          channel_breakdown_ref: "see top-level channel_breakdown for per-a_param detail",
        },
      },
    },
  };
}
