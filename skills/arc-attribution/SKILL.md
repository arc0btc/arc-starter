---
name: arc-attribution
description: MRR / attribution report reconciling Whop + x402 sales, channel attribution, and reach into one source of truth for demand-flywheel measurement
updated: 2026-07-17
tags:
  - reporting
  - attribution
  - revenue
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
---

# arc-attribution

MRR / attribution report — the single source of truth for demand-flywheel measurement (P8,
arc-demand-flywheel quest). Reconciles Whop + x402 sales, channel attribution, and reach
(followers, daily-read editions, articles, packaging backlog, email subscribers) into one report
so the CEO report (`skills/whop/lib/events.ts formatReadout()`) and the Discord north-star monitor
(manage-agents `ops/monitor/arc-m0-north-star.ts`) never disagree — both source their numbers from
`computeAttributionReport()`.

No `sensor.ts` — this is a query tool invoked by other skills/scripts and by the operator, not an
autonomous lane.

## Usage

```bash
bun skills/arc-attribution/cli.ts report            # human-readable
bun skills/arc-attribution/cli.ts report --json      # machine-readable
bun skills/arc-attribution/cli.ts record-click --ref <code> --surface <s> --target <url> [--note <text>]
```

Exit code 1 if `unattributed_dollars` is non-empty (real revenue with no channel attribution —
an operator-actionable signal, not a crash). `record-click` exits 2 on a validation failure
(missing flag, or a `ref_code` that matches neither a known `SRC_TAGS` tag nor an existing
`checkout_config.a_param`).

## Click attribution (control-plane-remediation Phase 7, track c)

`click_log` (`db/migrations/019-p7-click-attribution.ts`) records observed clicks. `ref_code`
shares the SAME namespace as `whop_sale.a_param` / `x402_sale.a_param` / `checkout_config.a_param`
— `lib/click-log.ts`'s `recordClick()` validates against that shared namespace (an existing
`SRC_TAGS` tag or `checkout_config.a_param` value) so this table can't silently fill with
unjoinable ref codes. `computeAttributionReport()`'s `click_attribution` field joins `click_log`
to `whop_sale`/`x402_sale` by `ref_code == a_param`, inside the same snapshot transaction as
every other query in this report (see `report.ts`'s `matched_whop_sales`/`matched_x402_sales` —
a coarse "sale row with this a_param at/after first click" signal, not a per-click foreign key).

**Ingestion this phase is manual/CLI-only** — `record-click` is the only writer. Two follow-ups
are named, not built, this phase:

1. A public `/go/:ref` redirect (`arc0btc-worker`, the live CF Worker at
   `~/arc-starter/github/arc0btc/arc0btc-worker`) that logs a click and 302-redirects, unifying
   `?src=` and `?a=` at redirect time. Code + a passing vitest test exist; NOT deployed this
   phase (explicit no-Cloudflare-deploy constraint on this phase — dry-run build only, see
   `deploy:dry`/`deploy:production:dry`).
2. A KV-to-`click_log` sync step so real `/go/:ref` click traffic lands in this table
   automatically once (1) is deployed. Not built — `record-click` stays the only ingestion path
   until it exists.

`lib/checkout-url.ts` is the companion piece for P6 defect row 39 (stable per-SKU checkout URL):
`checkout_config`'s `product_id='latest-report'` row is a single stable pointer that
`arc-packaging`'s `stage` command updates (never re-inserts) on every successful $9 SKU publish,
so a surface can embed one durable URL instead of a SKU-specific one that goes stale as the
rolling window rotates.

## Two Whop capture paths — read before touching this code

- `whop_sale` (arc.sqlite) — populated by **arc0btc-worker's** embedded-checkout webhook. Carries
  `a_param` channel attribution + `provenance` (`organic` | `self_funded_test`). The only source
  of one-time-sale CHANNEL attribution.
- `whop_event_log` (arc.sqlite) — populated by **arc-starter's own whop skill** (poll lane,
  `skills/whop/sensor.ts`). Ground truth for Whop's own view of memberships/payments.
  `computeRevenue()` in `skills/whop/lib/events.ts` is the canonical MRR/paying-customer
  calculation — this report REUSES it rather than re-deriving membership logic. Do not
  reimplement membership detection here; import `computeRevenue()`.

These two paths can diverge (different systems, different triggers). `unattributed_dollars` is
the guard: if `computeRevenue()` ever reports real paying customers with 0 matching organic
`whop_sale` rows, the report surfaces it loudly instead of a silent mismatch.

## Follower count caching

`lib/follower-cache.ts` wraps `skills/social-engine/north-star-gauge.ts` with a 20h TTL cache
(`db/hook-state/arc-attribution-follower-cache.json`) so this report and the CEO report's
"audience growth" line never spend more than one X API read per TTL window between them, and
both show the identical follower number.

## Known gaps (see `known_gaps` in every report output)

- Real click volume does not flow into `click_log` automatically yet — see "Click attribution"
  above (both named follow-ups outstanding). `click_attribution` only reflects manual
  `record-click` calls until they land.
- `matched_whop_sales`/`matched_x402_sales` in `click_attribution` is a coarse timestamp-ordering
  signal, not a true per-click foreign-key join.
- x402 amounts are on-chain base units, not cents — counted, not dollar-summed.
- 7d ship-log count remains unbuilt (no ship-board skill; structurally moot pre-$49-member).
- Email subscriber stats depend on arc-email-worker's live API availability.

## Owner / lineage

Built P8 of `arc-demand-flywheel` (2026-07-05). Reviewed by dev-council (4-lens:
kleppmann/lamport/newman/hohpe substitute). Click attribution + stable checkout-URL pointer added
control-plane-remediation Phase 7 (track c), 2026-07-17.
