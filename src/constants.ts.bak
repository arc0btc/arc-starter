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

/** First-month-free promo code (Whop promo `promo_zubH7b43NQHF`: 100% off first
 *  payment, new-users-only, one-per-customer, stock 50, company-wide). The ONLY
 *  friction-reducer for the $49 entry (P6). It is redeemed by CODE ENTRY at
 *  checkout — there is no URL/config field to bake it in — so it must travel in
 *  the CTA *copy*. Defined ONCE here so the sales lane (P9), the X-thread close,
 *  and the public-forum teaser all reference one canonical code (re-scope to L1
 *  at ladder rollout → P12). */
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
export const PRODUCT_PAGE_URL = `https://whop.com/harness-engineering-field-guide/?a=${PAID_ROOM_AFFILIATE}`;

/** Direct one-time checkout for the product. Attributable via `?a=arc0btc`. */
export const PRODUCT_CHECKOUT_URL = `https://whop.com/checkout/${PRODUCT_PLAN_ID}?a=${PAID_ROOM_AFFILIATE}`;
