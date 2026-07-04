---
name: arc-attribution
description: MRR / attribution report reconciling Whop + x402 sales, channel attribution, and reach into one source of truth for demand-flywheel measurement
updated: 2026-07-04
tags:
  - reporting
  - attribution
  - revenue
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
```

Exit code 1 if `unattributed_dollars` is non-empty (real revenue with no channel attribution —
an operator-actionable signal, not a crash).

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

- No checkout-click/traffic-start instrumentation exists — only conversions are tracked.
- x402 amounts are on-chain base units, not cents — counted, not dollar-summed.
- 7d ship-log count remains unbuilt (no ship-board skill; structurally moot pre-$49-member).
- Email subscriber stats depend on arc-email-worker's live API availability.

## Owner / lineage

Built P8 of `arc-demand-flywheel` (2026-07-05). Reviewed by dev-council (4-lens:
kleppmann/lamport/newman/hohpe substitute).
