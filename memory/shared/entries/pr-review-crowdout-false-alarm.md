---
id: pr-review-crowdout-false-alarm
topics: [metrics, false-alarm, arc-purpose-eval, queue-diagnostics]
source: task #21435, #21437
created: 2026-07-06
---

# Bursty single-snapshot metrics misread as capacity problems

`arc-purpose-eval`'s `scoreEcosystem()` (`skills/arc-purpose-eval/sensor.ts`) counted PR-review
tasks completed in an exact `completed_at > datetime('now', '-1 day')` window, sampled once at
midnight. Three consecutive zero/low-PR-review days (#20874, #21151, #21310) triggered a
queue-rebalance theory (#21434/#21435) — content-calendar/Nostr/Whop posting volume supposedly
crowding out PR review capacity.

**Live check disproved it.** PR-review tasks had near-zero queue latency (median <1min, worst
26min over 7 days) — the queue was never the bottleneck. Root cause: a 51h external lull (no PRs
opened/detected 07-04 11:12 → 07-06 14:13), then 8 PRs landed in one afternoon and all 8 were
reviewed same-day. The metric was measuring *external PR-open volume*, not *internal review
throughput* — a single 24h snapshot can't tell the two apart.

**Fix (task #21437):** `scoreEcosystem()` now scores off a 3-day rolling average
(`prReviewCount3d / 3`) instead of the raw 24h count. The follow-up task this sensor spawns on a
low score now explicitly tells the reviewer to check queue latency directly (time-to-pickup)
before filing a queue-rebalance or priority-boost task off the metric.

**Generalizable rule:** any daily-cadence metric that counts *external* events in a hard 24h
window (PR opens, inbound messages, market signals) inherits that source's natural burstiness. If
a "queue capacity" or "crowd-out" theory rests on such a metric, verify against a direct
operational signal (queue latency, time-to-pickup, actual backlog size) before acting — don't
trust a raw count-in-window as proof of internal contention. See also
[[completion-rate-metric-vs-stuck-detection-mismatch]] for a similar false-positive shape (a
metric with no exemption for a structurally different case).
