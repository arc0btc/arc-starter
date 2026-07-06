---
id: x-read-budget-mentions-crowdout
topics: [x-api, read-budget, sensors, follower-gauge]
source: task-21454
created: 2026-07-06
---

The X read-budget reserve mechanism (`FOLLOWER_RESERVE_SLOTS` in
`skills/social-x-posting/lib/x-api.ts`) protects the follower gauge from
starvation, but a reserve only works if the *unreserved* general pool is
actually big enough for the *other* general consumers too. It isn't a
substitute for sizing the biggest consumer correctly.

Root cause found 2026-07-06 (AI-057 fix landed same day but didn't fully
resolve the "gauge on fallback" complaint from whoabuddy): the mentions-polling
sensor (`skills/social-x-posting/sensor.ts`) did an unconditional read every
claimed run regardless of whether there were new mentions (a `since_id` cursor
still costs one API call). At its original 15min cadence that's 96 reads/day —
essentially the entire `X_MAX_READS_PER_DAY` (100) by itself — leaving zero
general-pool headroom for the other legitimate general consumers (whop-sales
lead-source, north-star-gauge's own post-metrics read) all day, and only 5
reserved slots against the gauge's documented worst case of 6/day (4h cache
TTL against a 30min monitor cadence) — an off-by-one on top of the crowd-out.

Fix: widen the mentions sensor cadence (15min → 20min, 96/day → 72/day) *and*
raise the reserve to match the documented worst case (5 → 6). Both were needed
— raising the reserve alone would still starve whop-sales/north-star's general
reads; widening cadence alone would still leave the reserve one slot short.

**Audit method that found it**: don't just read the reserve-slot math in
isolation — walk every caller of the shared read-budget client
(`grep -rln "from.*x-api\|from.*social-x-posting/lib" skills/`) and check each
one's actual call frequency (`claimSensorRun` interval × reads-per-run). Two of
the six files that import the lib (`reply-watchlist-sensor.ts`,
`follow-curated.ts`) turned out to have **no active caller or sensor-discovery
path** — dead code that still imports budget-gated functions but never runs.
Don't count dormant importers toward consumption; verify each one is actually
invoked (grep for its filename elsewhere) before including it in a budget
audit.

See [[cost-efficiency-review-2026-07-06]] pattern of "the fix that doesn't
fully fix it" — always re-verify the live budget file after a mitigation lands,
don't trust the fix commit message alone.
