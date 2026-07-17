// skills/arc-attribution/lib/checkout-url.ts
//
// control-plane-remediation Phase 7 (track c), P6 defect row 39: a stable per-SKU checkout URL
// for the $9 tripwire. checkout_config already gives stable full_checkout_url values for FIXED
// products (membership plan, Field Guide, Daily Research Report plan) -- those Whop
// prod_XXXX/plan_YYYY ids don't rotate. The genuinely missing piece is the ROTATING $9
// daily-report SKU: arc-packaging's `stage` command mints a NEW Whop product roughly daily
// (3-SKU rolling window), so any URL embedded in a tweet/email goes stale within days.
//
// This module is a single stable INDIRECTION pointer: checkout_config's product_id=
// 'latest-report' row (seeded NULL by db/migrations/019-p7-click-attribution.ts) gets its
// full_checkout_url UPDATED -- never re-inserted -- every time arc-packaging successfully
// publishes a new $9 SKU. Any surface can then embed a URL that resolves through this pointer
// (e.g. https://arc0btc.com/go/latest-report, once the arc0btc-worker /go/:ref route is
// deployed -- see arc0btc-worker's own follow-up note) instead of a SKU-specific URL that goes
// stale.

import { getDatabase } from "../../../src/db.ts";

const LATEST_REPORT_PRODUCT_ID = "latest-report";

export function getLatestReportCheckoutUrl(): string | null {
  const db = getDatabase();
  const row = db
    .query("SELECT full_checkout_url FROM checkout_config WHERE product_id = ?")
    .get(LATEST_REPORT_PRODUCT_ID) as { full_checkout_url: string | null } | null;
  return row?.full_checkout_url ?? null;
}

/** Updates the SAME stable-pointer row's full_checkout_url (and updated_at). Never inserts a
 *  second row -- this is a single stable pointer, not a growing log of past SKUs (click_log
 *  already covers "what happened when" if that history is ever needed). Call only on a
 *  CONFIRMED-successful SKU publish; never point the stable pointer at a SKU that failed to
 *  publish (a stale-but-valid old URL is safer than a URL to a product that doesn't exist). */
export function setLatestReportCheckoutUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("url is required");
  const db = getDatabase();
  const result = db
    .query(
      `UPDATE checkout_config
       SET full_checkout_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE product_id = ?`,
    )
    .run(trimmed, LATEST_REPORT_PRODUCT_ID);
  if (result.changes === 0) {
    throw new Error(
      `checkout_config has no product_id='${LATEST_REPORT_PRODUCT_ID}' row -- run ` +
        `db/migrations/019-p7-click-attribution.ts first.`,
    );
  }
}
