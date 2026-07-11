---
id: cost-review-followup-no-cooldown
topics: [dispatch, sensors, cost, arc-purpose-eval]
source: task #21504
created: 2026-07-07
---

`arc-purpose-eval/sensor.ts` spawned "Review cost efficiency — daily spend elevated" (priority 5,
sonnet) every 12h cycle whenever `scores.cost <= 1 && metrics.costPerDay > 70` — with no memory of
whether a prior identical review already ran and concluded "root lever unchanged" (e.g. #21309 same
day as #21504). Arc's baseline legitimate daily spend ($100-160/day) sits well above the PURPOSE.md
$70/day "5-point" threshold under normal operation, so this condition is chronically true and the
follow-up fired on a fixed cadence rather than in response to a new signal — same failure shape as
[[purpose-eval-signal-research-churn]] (metric with no exemption for a known/stable state).

Fix: added `countRecentTasksBySubject(subject, days)` to `src/db.ts` (subject-scoped cooldown,
mirrors the existing `countRecentFailuresForSubject` shape but checks any terminal status, not just
failures) and gated the cost-review follow-up on 0 same-subject completions in the last 2 days.

Audit findings that motivated skipping a re-fix rather than a re-audit (all already covered by
existing patterns, confirmed still current):
- Retrospective no-learning-yield (~30-40% of sampled retrospectives) is already tracked as
  [[p-retrospective-lifecycle]] — accepted low-cost noise ($0.12-0.20/task), not a new fix target.
- `--model auto` adoption remains ~0 (1 log entry in `memory/classifier-usage.log` since shipping)
  — already diagnosed as a subject-phrasing gap in [[openrouter-open-weight-routing]], not new.
- The day's cost outlier ($1.77, task #21487, a memory drill-back audit) matches the established
  "audit tasks ~$1.78 outlier" cost benchmark — not a misroute.

**General rule**: before adding a fix inside a recurring review/audit task, check whether the
review's own re-trigger condition has a cooldown/recency guard — a review task that keeps re-firing
identically is itself the cost-efficiency bug, independent of what it finds each time.
