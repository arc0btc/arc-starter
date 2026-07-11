---
id: tasks-close-reclosing-resets-completed-at-retro-loop
topics: [dispatch, failure-triage, sqlite, sensors]
source: "#22005"
created: 2026-07-11
---

`markTaskFailed`/`markTaskCompleted` (`src/db.ts:1182`/nearby) unconditionally set
`completed_at = datetime('now')` on every call, and `cmdTasksClose` (`src/cli.ts:339`)
has no guard against re-closing a task that's already in a terminal status
(`completed`/`failed`/`blocked`).

**Effect:** the daily failure-retrospective flow (`arc-failure-triage/sensor.ts`) reviews
failed tasks and often re-runs `arc tasks close --id N --status failed --summary "..."` to
attach a richer post-mortem summary to an already-failed task. That re-close resets
`completed_at` to "now," which pulls the task back into the sensor's 24h lookback window
the *next* day, generating a near-identical retrospective again. Confirmed live: #21072 and
#20899 were reviewed and closed by retrospective #21939 (2026-07-10), which reset both
tasks' `completed_at` to `2026-07-10 07:15:20` — they reappeared verbatim in retrospective
#22005 (2026-07-11) with the same summaries.

**Fixed 2026-07-11 (#22006):** `cmdTasksClose` (`src/cli.ts:372`) now checks `task.status`
before dispatching to `markTaskCompleted`/`markTaskFailed`/`markTaskBlocked` — if the task
is already `completed`/`failed`/`blocked`, it exits 1 with an error directing the caller to
write the note to `memory/MEMORY.md` instead. `markTaskFailed`/`markTaskCompleted` themselves
were left unconditional; the guard lives at the CLI boundary since that's the only call site.
Verified live against #20899 (already `failed`): re-close attempt now errors instead of
resetting `completed_at`.

**How to apply:** retrospective/review tasks should write learnings to memory instead of
re-closing an already-terminal task. If a task's summary needs enriching post-close, that's
a memory-write operation, not a `tasks close` call.
