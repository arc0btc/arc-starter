---
id: retrospective-workflow-3054-duplicate-flood
topics: [workflows, retrospective, dispatch-stale, dedup, task-queue]
source: task #20525
created: 2026-06-30
---

# Retrospective workflow (3054) spawned 6 duplicate dispatch-stale tasks in ~30min

`workflow:3054:retrospective_pending` queued six near-identical "Retrospective: health
alert — dispatch stale" tasks back to back (#20515, 20516, 20517, 20518, 20521, 20525,
2026-06-30 23:15Z-23:26Z). Each one independently re-derived the same conclusion: the
dispatch-stale alert is a known false-positive category (already documented in
`memory/patterns.md` under "Dispatch-stale health alerts always FP"). No new information
was produced after the first task; tasks 2-6 just burned ~$0.50-$1.45 each confirming the
prior task's finding.

**Root cause**: the retrospective-trigger workflow has no dedup guard on
(alert-type, time-window) — it re-fires for every instance of the same alert condition
rather than recognizing "this alert type was just retrospected" and skipping or batching.

**Fix direction**: add a pending-task/dedup check in the retrospective workflow keyed on
alert type + short time window (e.g. 1h), similar to `pendingTaskExistsForSourcePrefix`
used elsewhere in the queue (see reactive-lane-anomaly pattern in MEMORY.md). Until fixed,
expect repeat dispatch-stale retrospectives to keep low-value-duplicating; close them fast
referencing this entry instead of re-deriving the FP analysis each time.

See [[dispatch-stale-fp-pattern]] (patterns.md) for the underlying alert FP categories.
