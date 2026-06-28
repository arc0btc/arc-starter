// src/constants.ts
// Shared constants used across sensors and skills.

/** Stale-cycle detection threshold (ms).
 *  Must exceed the longest possible dispatch timeout (Opus overnight = 90min)
 *  so the health sensor doesn't false-alert during a legitimately long cycle.
 *  Used by: arc-service-health sensor, dispatch.ts timeout logic. */
export const DISPATCH_STALE_THRESHOLD_MS = 95 * 60 * 1000; // 95 minutes

/** aibtcdev repos watched for PR reviews, maintenance, and mentions. */
export const AIBTC_WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/agent-news",
  "aibtcdev/loop-starter-kit",
  "aibtcdev/x402-sponsor-relay",
  "aibtcdev/tx-schemas",
] as const;

/** GitHub orgs/owners where Arc is the primary maintainer. */
export const ARC_MANAGED_ORGS = ["arc0btc"] as const;

/** GitHub orgs where Arc is a collaborator (not owner). */
export const ARC_COLLABORATIVE_ORGS = ["aibtcdev"] as const;

export type RepoClass = "managed" | "collaborative" | "external";

/** Classify a repo as managed, collaborative, or external based on owner. */
export function classifyRepo(fullName: string): RepoClass {
  const owner = fullName.split("/")[0];
  if ((ARC_MANAGED_ORGS as readonly string[]).includes(owner)) return "managed";
  if ((ARC_COLLABORATIVE_ORGS as readonly string[]).includes(owner)) return "collaborative";
  return "external";
}

// --- hash-it-out paid-room funnel (P17 affiliate → P18 public-forum funnel) ---
// The ATTRIBUTABLE paid-room CTA links. The `?a=arc0btc` referral param ties a
// subscribe to Arc's own affiliate record (aff_i9FNHW8i4sfjZi) on the paid
// "hash it out - membership" product (prod_TJknsIOzPDlQS / plan_axYMvJ4cBnq8v,
// $49/mo) — so a click→subscribe through these links increments the affiliate's
// total_referrals_count / total_revenue_usd. That counter IS the live free→paid
// conversion readout (`arc skills run --name whop -- list-affiliates`); P19's
// membership.went_valid webhook adds per-event granularity later.
//
// Defined ONCE here so the public-forum teaser (and any future synthesis/digest
// CTA) reference one canonical link rather than drifting hardcoded copies.

/** Affiliate referral param attributing paid-room conversions to Arc (P17). */
export const PAID_ROOM_AFFILIATE = "arc0btc" as const;

/** Paid-room PRODUCT page (soft CTA — see the room, then subscribe). Attributable. */
export const PAID_ROOM_PRODUCT_URL = `https://whop.com/hash-it-out-membership/?a=${PAID_ROOM_AFFILIATE}`;

/** Paid-room CHECKOUT (direct subscribe to the $49/mo plan). Attributable. */
export const PAID_ROOM_CHECKOUT_URL = `https://whop.com/checkout/plan_axYMvJ4cBnq8v?a=${PAID_ROOM_AFFILIATE}`;

/** First-month-free promo code (Whop promo `promo_lJL3irn7Gvh6`: 100% off first
 *  payment, new-users-only, one-per-customer, stock 50, scoped to $49/mo membership only).
 *  P3 (2026-06-27): old promo `promo_zubH7b43NQHF` (product=null) archived + recreated
 *  scoped to prod_TJknsIOzPDlQS. The ONLY friction-reducer for the $49 entry (P6).
 *  Redeemed by CODE ENTRY at checkout — must travel in CTA copy. One canonical def here. */
export const PROMO_CODE = "FREEMONTH" as const;

// --- hash-it-out PRODUCT SKU (P10A product-led conversion) ---
// The first one-time PRODUCT (not the $49/mo membership): a packaged research report
// sold as a standalone $9 SKU. Mirrors the PAID_ROOM_* block — same `?a=arc0btc`
// attribution so a product sale increments Arc's affiliate counter, but this is a
// ONE-TIME plan (`plan_type:"one_time"`), so the ledger classifies a buyer as a
// product CUSTOMER (events.ts MEMBERSHIP_PRODUCT_ID split), NOT a $49/mo member.
//
// Flagship #1 = "The Harness Engineering Field Guide" (packaged from the existing
// research/2026-05-19 harness-engineering report — sell the legibility + provenance,
// not the raw research). Created HIDDEN via `whop create-product`; the operator flips
// it `visible` at go-live. Minted live 2026-06-16.

/** First product SKU (Whop product id). One-time plan; NOT the membership product. */
export const PRODUCT_ID = "prod_HTLQdLKXqPGIS" as const;

/** The product's one-time plan id (`plan_type:"one_time"`, $9). Drives direct checkout. */
export const PRODUCT_PLAN_ID = "plan_iWhn7BqRgGBtu" as const;

/** Product page (soft CTA — see the report, then buy). Attributable via `?a=arc0btc`. */
/** P3 (2026-06-27): repointed from harness-engineering-field-guide to canonical $9 tripwire (arc-research-single). */
export const PRODUCT_PAGE_URL = `https://whop.com/arc-research-single/?a=${PAID_ROOM_AFFILIATE}`;

/** Direct one-time checkout for the product. Attributable via `?a=arc0btc`. */
export const PRODUCT_CHECKOUT_URL = `https://whop.com/checkout/${PRODUCT_PLAN_ID}?a=${PAID_ROOM_AFFILIATE}`;

// --- $9 single-report tripwire SKU (P2 — three-surface pricing reconciliation) ---
// The canonical entry product per the operator-set product model (2026-06-22).
// Entry = $9 single-report tripwire; $49/mo membership unlocks all reports + ongoing stream.
// Created 2026-06-22 as prod_HD0HZ2bAfHCtF / plan_arGwx0yFBhYOL.
// Price must read identically across Whop, arc0btc.com /catalog, and x402 accepts[].
// Rollback: client.products.update('prod_HD0HZ2bAfHCtF', { visibility: 'hidden' })

/** $9 tripwire product SKU (Whop product id). One-time plan; entry to the report stream. */
export const TRIPWIRE_PRODUCT_ID = "prod_HD0HZ2bAfHCtF" as const;

/** $9 tripwire plan id (`plan_type:"one_time"`, $9). Drives direct checkout. */
export const TRIPWIRE_PLAN_ID = "plan_arGwx0yFBhYOL" as const;

/** Tripwire product page (soft CTA — see the report, then buy). Attributable via ?a=arc0btc. */
export const TRIPWIRE_PAGE_URL = `https://whop.com/arc-research-single/?a=${PAID_ROOM_AFFILIATE}`;

/** Direct one-time checkout for the tripwire. Attributable via ?a=arc0btc. */
export const TRIPWIRE_CHECKOUT_URL = `https://whop.com/checkout/${TRIPWIRE_PLAN_ID}?a=${PAID_ROOM_AFFILIATE}`;

// --- "The Loop, graded against a live 24/7 agent" SKU (2026-06-27) ---
// $9 one-time guide: Boris loop template + eric /loop+/notify + Prajwal 3-tier stack
// mapped file-by-file to Arc's sensors/dispatch/workflows + ARC-0011 ladder.
// Source report: research/2026-06-27T14:50:00Z_loop-first-workflow-three-tier-stack.md
// Minted hidden; flip to visible after operator review.

/** "The Loop" SKU product id. One-time plan, $9. */
export const LOOP_GRADED_PRODUCT_ID = "prod_iRxuQeieW4RCm" as const;

/** "The Loop" SKU plan id (`plan_type:"one_time"`, $9). Drives direct checkout. */
export const LOOP_GRADED_PLAN_ID = "plan_ZyXnqaUSV8pWY" as const;

/** "The Loop" product page. Attributable via ?a=arc0btc. */
export const LOOP_GRADED_PAGE_URL = `https://whop.com/the-loop-graded/?a=${PAID_ROOM_AFFILIATE}`;

/** "The Loop" direct checkout. Attributable via ?a=arc0btc. */
export const LOOP_GRADED_CHECKOUT_URL = `https://whop.com/checkout/${LOOP_GRADED_PLAN_ID}?a=${PAID_ROOM_AFFILIATE}`;
