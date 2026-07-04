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
//
// Reconciliation: if computeRevenue() finds real (non-$0) paying customers but whop_sale has 0
// organic rows, that is real revenue with no channel attribution — surfaced in
// `unattributed_dollars`, never silently dropped or double counted.

import { getDatabase, initDatabase } from "../../../src/db.ts";
import { computeRevenue, type RevenueSummary } from "../../whop/lib/events.ts";
import { getCredential } from "../../../src/credentials.ts";
import { parseSkuBacklog } from "../../arc-packaging/lib/backlog.ts";
import { join } from "node:path";
import { readCachedFollowers } from "./follower-cache.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../../");
const INDEX_PATH = join(ARC_STARTER_ROOT, "research/INDEX.md");

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
}

export interface AttributionReport {
  generated_at: string;
  mrr: {
    mrr_cents: number;
    active_members: number;
    paying_customers: number;
    paying_product_customers: number;
    source: string;
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
  };
  before_after: Array<{ metric: string; before: number | string; after: number | string }>;
  unattributed_dollars: Array<{ detail: string }>;
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
 * `selectCandidate()`'s own eligibility filter. */
function parseBacklogRemaining(): number | null {
  try {
    return parseSkuBacklog(INDEX_PATH).filter((r) => r.relevance >= 4).length;
  } catch {
    return null;
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
    const stats = (body.stats as Record<string, number> | undefined) ?? (body as Record<string, number>);
    return {
      confirmed: typeof stats.confirmed === "number" ? stats.confirmed : 0,
      pending: typeof stats.pending === "number" ? stats.pending : 0,
      error: null,
    };
  } catch (err) {
    return { confirmed: null, pending: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function computeAttributionReport(): Promise<AttributionReport> {
  initDatabase();
  const db = getDatabase();

  const revenue: RevenueSummary = computeRevenue();

  const whopSaleRows = db
    .query("SELECT provenance, price_cents, a_param FROM whop_sale")
    .all() as Array<{ provenance: string | null; price_cents: number | null; a_param: string | null }>;
  const x402SaleRows = db
    .query("SELECT provenance, amount_base_units, a_param FROM x402_sale")
    .all() as Array<{ provenance: string | null; amount_base_units: number | null; a_param: string | null }>;

  const whopProvenance = bucketProvenance(whopSaleRows);
  const x402Provenance = bucketProvenance(x402SaleRows);

  const checkoutConfigParams = new Set(
    (db.query("SELECT DISTINCT a_param FROM checkout_config").all() as Array<{ a_param: string | null }>)
      .map((r) => r.a_param)
      .filter((v): v is string => !!v),
  );
  const channelMap = new Map<string, ChannelBreakdownRow>();
  function bump(aParam: string | null, provenance: string | null, amountCents: number) {
    const channel = aParam && checkoutConfigParams.has(aParam) ? aParam : (aParam ?? "unmapped");
    if (!channelMap.has(channel)) {
      channelMap.set(channel, { channel, organic_count: 0, self_funded_test_count: 0, organic_amount_cents: 0 });
    }
    const row = channelMap.get(channel)!;
    if (provenance === "organic") {
      row.organic_count++;
      row.organic_amount_cents += amountCents;
    } else if (provenance === "self_funded_test") {
      row.self_funded_test_count++;
    }
  }
  for (const r of whopSaleRows) bump(r.a_param, r.provenance, r.price_cents ?? 0);
  // x402 amounts are on-chain base units (STX/sBTC-denominated), not cents — counted, not
  // dollar-summed here. See known_gaps.
  for (const r of x402SaleRows) bump(r.a_param, r.provenance, 0);

  const unattributedDollars: Array<{ detail: string }> = [];
  if (revenue.payingCustomers > 0 && whopProvenance.organic === 0) {
    unattributedDollars.push({
      detail: `computeRevenue() reports ${revenue.payingCustomers} paying customer(s) / $${(revenue.mrrCents / 100).toFixed(2)} MRR, but whop_sale has 0 organic rows — real revenue exists with no channel attribution. Check arc0btc-worker's checkout webhook is firing for this sale.`,
    });
  }

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

  const emailStats = await fetchEmailSubscriberStats();
  const followerCache = await readCachedFollowers();
  const backlogRemaining = parseBacklogRemaining();

  const beforeAfter: AttributionReport["before_after"] = [
    { metric: "X followers", before: P0_BASELINE.followers, after: followerCache.followers ?? "unknown (degraded)" },
    { metric: "Daily Read editions posted", before: P0_BASELINE.daily_read_editions, after: dailyReadEditions },
    { metric: "Long-form articles published (fired)", before: P0_BASELINE.articles_published, after: articlesPublished },
    { metric: "Free-room joins", before: P0_BASELINE.free_room_joins, after: freeRoomJoins },
    { metric: "One-time sales (organic)", before: P0_BASELINE.one_time_sales_organic, after: whopProvenance.organic },
    { metric: "x402 sales (self-funded test)", before: P0_BASELINE.x402_sales_self_funded, after: x402Provenance.self_funded_test },
    { metric: "x402 sales (organic)", before: P0_BASELINE.x402_sales_organic, after: x402Provenance.organic },
    { metric: "MRR (cents, organic)", before: P0_BASELINE.mrr_cents, after: revenue.mrrCents },
  ];

  return {
    generated_at: new Date().toISOString(),
    mrr: {
      mrr_cents: revenue.mrrCents,
      active_members: revenue.activeMembers,
      paying_customers: revenue.payingCustomers,
      paying_product_customers: revenue.payingProductCustomers,
      source: "computeRevenue() — skills/whop/lib/events.ts (whop_event_log ground truth)",
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
      packaging_backlog_remaining: backlogRemaining,
    },
    before_after: beforeAfter,
    unattributed_dollars: unattributedDollars,
    known_gaps: [
      "No checkout-click/traffic-start instrumentation exists anywhere — only conversions (whop_sale, x402_sale, whop_event_log) are tracked. 'Traffic' in the before/after table is therefore conversion-adjacent, not true funnel-top traffic.",
      "x402_sale amounts are on-chain base units (STX/sBTC-denominated), not cents — not folded into the $ MRR/organic-revenue totals here; see provenance.x402_sale for counts only.",
      "7d ship-log count (CEO report) remains unbuilt — no ship-board skill exists to track member ship-log posts; structurally impossible before any $49 member exists.",
      "Email subscriber counts depend on arc-email-worker's live API; email_api_error is non-null if that call failed this run.",
    ],
  };
}
