---
id: daily-eval-duplicate-task-same-day
topics: [arc-purpose-eval, sensors, task-dedup, dispatch]
source: task 23145 (dup of 23138)
created: 2026-07-19
arc_relevance: 3
---

`arc-purpose-eval`'s sensor filed two eval-shaped tasks for the same day: #23138 (2.29/5,
computed at ~cycle time with real cost data, S:1 O:5 E:1 C:1 Ad:4 Co:1 Se:3) and #23145
(2.75/5 pre-LLM-score, computed later in the day off a narrower/emptier measurement window —
S:1 O:5 E:1 C:5). #23138 ran first and already flagged #23145 as pending-duplicate in its
own summary but did not close it. By the time #23145 executed, #23138 had already updated
`memory/MEMORY.md`'s rolling `daily-eval` line — so #23145 closing "completed" and overwriting
that line again would just replay near-identical Adaptation/Collaboration/Security reasoning
under a different (noisier) Cost/Signal snapshot, with no new signal.

**Root cause (not yet fixed):** the sensor's per-day dedup key isn't tight enough — it let a
second `PURPOSE eval: ...` subject task queue up same-day alongside an unclosed/uncounted one.
Needs a same-day existing-pending-eval-task check before creating a second one (mirrors the
`arc tasks add --source` dedup gotcha, but this sensor doesn't use a stable `--source` suffix
per day).

**Handling when this recurs:** the later-numbered duplicate should close as
`completed --summary "superseded by task #<earlier_id>, which already scored and updated
MEMORY.md's daily-eval line"` rather than re-running the full narrative/DSL-council flow and
overwriting the rolling line a second time. Do not treat the second task's different numeric
inputs as grounds to "correct" the first eval unless the first eval's inputs were actually
wrong — a same-day rescoring itself is not new information.

**Fix filed:** none yet — flag for a follow-up task to add a same-day pending-task guard to
`skills/arc-purpose-eval/sensor.ts` before creating a new `PURPOSE eval:` task.
