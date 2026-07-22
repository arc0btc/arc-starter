---
id: auto-queue-pool-consumer-false-hungry
topics: [auto-queue, nostr, sensors, task-queue]
source: task:23531
created: 2026-07-22
---

`auto-queue`'s hungry-domain heuristic (≥3 completed in 6h + ≤2 pending) misfires
on pool-consumer domains like `nostr`. The `nostr-consumer` sensor (`skills/nostr/sensor.ts`)
creates exactly one task per unconsumed artifact tagged for the `nostr` channel
(producer: `snippet-producer`), gated by a daily budget, then that task completes
immediately — so 0 pending between ticks is the *expected steady state*, not a
supply gap.

**Why:** manually batch-creating "post to Nostr" tasks for a pool-consumer domain
either duplicates the sensor's exactly-once `--source nostr:<artifact-id>` ledger
(no-ops) or forces posts with no real artifact backing them (breaks the
"content-driven, not quota-driven" design).

**How to apply:** when `auto-queue` flags a pool-consumer domain (nostr today;
likely also any future producer→consumer artifact-channel pair, e.g. whop-forum/
public-forum/x consumers) as hungry, do NOT queue synthetic work items. Instead
verify the *producer* side is still feeding the pool (e.g. task #23536 checks
`snippet-producer` cadence) and treat the domain's 0-pending state as healthy.
