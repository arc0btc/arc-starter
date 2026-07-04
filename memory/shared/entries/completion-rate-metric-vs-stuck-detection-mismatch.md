---
id: completion-rate-metric-vs-stuck-detection-mismatch
topics: [workflows, sensors, false-positive, arc-workflow-review]
source: task #21107 / #21122
created: 2026-07-04
---

`skills/arc-workflow-review/sensor.ts` has two separate health signals for a workflow template: a 7-day stuck-state check (with a `PASSIVE_WAITING_STATES` exemption list for known long-cadence states, e.g. `content-calendar:public_forum_teaser` waits for a T+30d gate) and a raw `completionRate < 70` threshold (sensor.ts:424-426) that has **no equivalent exemption**.

For any template with a multi-week/multi-hop pipeline (e.g. `ContentCalendarMachine`: whop_chat T+2h → whop_forum T+2d → public_forum_teaser T+4d → course_candidate T+30d), the raw completion rate will structurally sit below 70% as long as new instances keep entering the pipeline faster than the ~30-day cycle completes — this is expected shape, not a health problem. The stuck/stale counts (0/0) are the actual signal to trust; a low completion rate alone on a template with a documented long cadence is very likely a metric artifact.

**How to apply:** before treating a `<70% completion rate` workflow-review flag as a real issue, check (1) whether the template has a `PASSIVE_WAITING_STATES` entry or documented long-cadence gate, and (2) whether stuck/stale counts are actually nonzero. If stuck=0 and stale=0, it's very likely a false positive from the raw-rate metric, not an actual stuck pipeline. See [[sensor-health-report-blind-spots]] for a related case (different sensor, same "trust the structural check over the summary metric" lesson).
