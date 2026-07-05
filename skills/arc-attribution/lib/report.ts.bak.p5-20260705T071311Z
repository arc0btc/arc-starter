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

import { getDatabase, initDatabase } from "../../../src/db.ts";
import { computeRevenue, type RevenueSummary } from "../../whop/lib/events.ts";
import { getCredential } from "../../../src/credentials.ts";
import { parseSkuBacklog } from "../../arc-packaging/lib/backlog.ts";
import { join } from "node:path";
import { readCachedFollowers } from "../../../src/follower-cache.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../../");
const INDEX_PATH = join(ARC_STARTER_ROOT, "research/INDEX.md");

export const SCHEMA_VERSION = "1.0.0";

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

/**
 * All synchronous, arc.sqlite-only reads needed for the report, run inside ONE transaction so
 * they observe a single consistent snapshot (lamport, dev-council 2026-07-05: separate top-level
 * statements against a DB that Arc's own live dispatch loop writes every minute can otherwise
 * see read skew — e.g. a membership activated between two of this function's queries would show
 * up in one count and not another within the same emitted report). computeRevenue() is called
 * INSIDE the same transaction (same connection, synchronous call, no awaits in between) so its
 * internal reads participate in the same snapshot.
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
    result = {
      revenue,
      whopSaleRows,
      x402SaleRows,
      checkoutConfigParams,
      freeRoomJoins,
      dailyReadEditions,
      articlesPublished,
      articlesStaged,
    };
  });
  tx.deferred();
  return result;
}

export async function computeAttributionReport(): Promise<AttributionReport> {
  initDatabase();
  const db = getDatabase();

  const snap = readDbSnapshot(db);
  const { revenue, whopSaleRows, x402SaleRows, freeRoomJoins, dailyReadEditions, articlesPublished, articlesStaged } = snap;
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
    ],
  };
}
