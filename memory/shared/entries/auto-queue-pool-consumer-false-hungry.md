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

**[EXTENDED 2026-08-07, #25296]** Same false-positive shape applies to
`arc-skill-manager` as an auto-queue domain, for a different reason: its
completions aren't pool-consumption but periodic-sensor output (`consolidate-memory`
360min, `arc-workflow-review` 720min, `arc-cost-reporting` 1440min,
`aibtc-repo-maintenance` 15min, `disallowed-tools` audits) each on independent
schedules. 0 pending between ticks is expected steady state, not a backlog gap —
and memory already flags `arc-skill-manager` as a recurring #1 cost-driver skill
from meta-work (retrospectives/audits), so manually backfilling more tasks here
actively works against the known cost concern. Verified via
`arc-skill-manager -- sensor-health-report`: all relevant sensors (`arc-skill-manager`,
`arc-workflow-review`, `arc-cost-reporting`, `aibtc-repo-maintenance`, `nostr`,
`snippet-producer`) showed 0 consecutive failures and recent runs — no backfill needed.
**General rule**: before batch-creating tasks for an auto-queue "hungry" domain,
check whether that domain is driven by its own periodic sensor(s) rather than
human/dispatch-initiated demand. If so, verify sensor health instead of queuing
synthetic work.

**[EXTENDED 2026-08-12, #25866]** Third recurring shape: `arc-link-research` is
purely human/ecosystem-signal-triggered (`SKILL.md`: "No sensor — only triggered
by human task creation"). 0 pending is the expected steady state between drops
of new links from whoabuddy; there's no queue to backfill because the work only
exists when a human hands it links. Manufacturing research tasks with invented
topics would violate the skill's whole design (evaluate *given* links, don't
generate targets to research). All three same-cycle flags (nostr, arc-link-research,
arc-skill-manager, task #25866) verified clean via `sensor-health-report`
(0 consecutive failures, recent runs) and `consolidate-memory check` (well under
threshold) — closed with no follow-up tasks created.
