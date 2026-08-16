---
id: auto-queue-sensor-consumer-domain-false-positive
topics: [auto-queue, nostr, arc-skill-manager, sensor-design, false-positive]
source: task:26322
created: 2026-08-16
---

`auto-queue` sensor flags a domain "hungry" purely from completion/pending counts
(≥3 completed in 6h + ≤2 pending), with no awareness of *why* the domain's queue is
empty. Two domains are structurally always-empty-until-triggered and should NOT get
manually-seeded follow-up tasks when flagged:

- **nostr**: `skills/nostr/sensor.ts` is a pool CONSUMER, not a task generator. It only
  queues a "compose+post" task when an artifact gets tagged for the `nostr` channel by
  a producer (watch-report distillation, snippet/quote-card pipelines, etc. — see
  `recentArtifacts(type, {channel: "nostr"})`). The sensor's own comment states "empty
  pool is EXPECTED." `arc-artifacts audit --since 48` showed 12 nostr-channel
  consumptions against 26 artifacts produced in the same window — the pipeline is
  healthy, just drip-fed (1 post/5min tick, daily budget cap). Manually queuing
  "compose a nostr note" tasks bypasses the artifact-pool design and risks
  low-signal/duplicate posts with no source nugget behind them.
- **arc-skill-manager**: all task generation is sensor-driven on fixed intervals —
  memory consolidation (120min, triggered by line-count threshold), skill validation
  (360min), research decay (24h). There is no manual backlog to top up; the sensor
  fires exactly when its own thresholds are crossed.

**Rule**: before manually seeding follow-up tasks for a domain the auto-queue sensor
flags as hungry, check `skills/<domain>/sensor.ts` for whether it's demand/pool-driven
(consumer pattern) vs. backlog-driven (needs proactive task generation, e.g. PR review
queues, content calendar). If pool/interval-driven, close the auto-queue task as
completed with "domain is consumer-pattern, empty queue expected" rather than manufacture
busywork. See also [[artifact-pool-staleness-false-positive-causes]] for the related
arxiv/council staleness false-positive pattern in the same sensor family.
