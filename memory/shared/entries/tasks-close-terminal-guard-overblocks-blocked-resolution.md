---
id: tasks-close-terminal-guard-overblocks-blocked-resolution
topics: [dispatch, tasks-close, terminal-guard, arc-blocked-review]
source: task:22503
created: 2026-07-13
---

`cmdTasksClose`'s terminal guard (`src/cli.ts:380`, commit a3f29176 / #22006) rejects
`arc tasks close` on any task with `status IN ('completed','failed','blocked')`. The guard's
justification — re-closing resets `completed_at`, causing reappearance in time-windowed
reports — only applies to `completed`/`failed` (both set `completed_at`). `markTaskBlocked`
(`src/db.ts:1267`) never touches `completed_at`, so a blocked task has `completed_at = NULL`.
Lumping `blocked` into the reject-list blocks the *legitimate* first-time resolution
`blocked → completed/failed`, not just illegitimate re-closes.

**Symptom**: a reviewer trying to close a genuinely-resolved blocked task (per
arc-blocked-review's own generated instructions: "if verification confirms a task's blocker
is resolved, close it now") gets `Error: task #N is already terminal (status=blocked)` and
can't act — the task stays blocked forever and keeps getting re-flagged by
arc-blocked-review's stale-threshold signal (no cooldown once a task has both a stale reason
and a signal reason, see `skills/arc-blocked-review/sensor.ts:193-206`), generating repeat
review cost with no path to close the loop. Case: task #22086 (Daily Read Edition 8),
investigated via #22503, fix filed as #22505.

**Diagnostic**: before assuming `completed_at`/`status` inconsistency when you see this error,
check the actual row — `completed_at` is very likely still NULL for a blocked task; the error
message text is boilerplate shared across all three statuses, not evidence of the specific
condition it describes.

**Fixed** 2026-07-13, #22505, commit 71d6f298: `src/cli.ts:380` guard now only rejects
`status IN ('completed','failed')`. `blocked → completed/failed` first-time resolution
works via `arc tasks close` again. `blocked → blocked` re-blocking was never broken since
`markTaskBlocked` doesn't touch `completed_at`. #22086 itself intentionally left blocked —
resolving it needs whoabuddy confirmation it's superseded by editions 9/10/11, not just the
code fix.

See [[reservation-leak-window-open-not-closed-sweep]] for another case where a similarly
broad-brush guard needed narrowing to the specific condition it was meant to prevent.
