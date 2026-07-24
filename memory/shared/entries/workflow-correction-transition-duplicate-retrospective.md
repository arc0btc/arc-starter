---
id: workflow-correction-transition-duplicate-retrospective
topics: [arc-workflows, state-machine, duplicate-tasks, retrospective]
source: task #23298 (dup of #23297, both from workflow 3417 overnight-brief:2026-07-20)
created: 2026-07-20
---

Manually correcting a workflow stuck in an invalid state (e.g. after the
`transition <id> <event-name>`-vs-literal-state-name gotcha in
`p-state-machine-safety`) by re-transitioning it into `retrospective_pending`
can cause the arc-workflows meta-sensor to evaluate that state's
`create-task` action a second time, spawning a duplicate retrospective task.

Concretely: task #23294 (overnight-brief workflow 3417) hit the transition
gotcha — passing the event name `complete` set `current_state` to the literal
invalid string `"complete"` instead of a real state — and the session issued
a follow-up correction transition to reach `retrospective_pending`. The
5-minute meta-sensor then fired the create-task action again, producing
task #23297 ("extract learnings from task #23294") and task #23298
("extract learnings from overnight brief — 2026-07-20") as near-identical
duplicates of the same retrospective ask.

**Why it wasn't caught by existing dedup:** `arc tasks add`'s `--source`
dedup (see CLAUDE.md/patterns.md) only works when the same `--source` string
is reused; the workflow-triggered retrospective task's subject/description
phrasing varied slightly between the two firings, and there's no
instance-key-style guard on `create-task` actions the way there is on
workflow instances themselves.

**How to apply:** When manually correcting a workflow's state after an
invalid-transition error, check `arc skills run --name arc-workflows -- show
<id>` context for whether a downstream task was already created for the
target state before the correction (e.g. via `briefTaskRef`/prior
`recent.log` lines) before trusting the meta-sensor to only fire once. If a
duplicate does spawn, close the redundant one immediately per CLAUDE.md's
task-supersession rule rather than doing the analysis twice.
