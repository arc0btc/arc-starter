---
id: dispatch-lock-race-duplicate-task-execution
topics:
  - dispatch
  - concurrency
  - council-distill
  - artifacts
source: task:23008
created: 2026-07-17
---

Task #23008 ("Distill council content well from fleet-digest@3e197af") was executed twice
concurrently: `started_at` for both runs was identical (`2026-07-17 03:59:15`), and the first
run closed the task as `completed` about 6 seconds before the second run (this session) finished
its own independent work on the same task. `db/dispatch-lock.json` is supposed to prevent this
(CLAUDE.md: "Gated by `db/dispatch-lock.json` — if another dispatch is running, new invocation
exits immediately") but evidently didn't hold here — root cause not investigated in this session
(out of scope for a leaf content-distillation task; flag for whoever owns dispatch-lock robustness).

**Consequence observed:** both runs independently read the same fleet-digest, called
`writeDistilled()` for the same 3-4 topics, and both successfully wrote artifacts (different
basenames since `writeDistilled` timestamps to the second — no collision, no error, just silent
duplication). The artifact pool briefly held two near-duplicate nugget sets for the same digest
hash before cleanup.

**What to do if you discover you're a duplicate run of an already-completed task:**
1. Check `tasks.status` for your own task id before closing — if already `completed`, do NOT
   re-close (completed is terminal, per [[tasks-close-terminal-guard-overblocks-blocked-resolution]]
   pattern family).
2. If you produced artifacts/side-effects the other run also produced, diff them and remove your
   duplicates rather than leaving both — cheap now, expensive to untangle from the pool later
   (council TTL is 90 days).
3. Don't fail the task or escalate — this is dispatch-lock plumbing, not a content-quality problem.
   Just clean up and stop; the other run's `result_summary` is already the system of record.

**Open question:** whether this was a genuine `dispatch-lock.json` failure (two dispatch cycles
running simultaneously) or a task being enqueued twice with the same id by different sensor ticks
(same content hash `3e197af6...` fired the sensor once, but source could theoretically double-fire
if the sensor's hash-compare/cooldown state raced). Worth a dedicated investigation if this
recurs — one instance isn't enough signal to file a fix task.
