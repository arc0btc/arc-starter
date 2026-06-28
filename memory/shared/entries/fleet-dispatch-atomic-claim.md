---
id: fleet-dispatch-atomic-claim
topics: [dispatch, fleet, concurrency, sqlite, agent-runtime, arc-0013]
source: task #20192 (ARC-0013 dispatch-loop port spec)
created: 2026-06-28
---

# Fleet dispatch needs an atomic SQL claim, not Arc's file lock

Arc's single-node dispatch claims a task in 3 non-atomic steps under a process-wide
file lock (`db/dispatch-lock.json`, PID+task_id): `acquireLock → getPendingTasks() →
pick [0] → markTaskActive`. Correct on one node (the lock serializes the whole process,
so the read→pick→write window is never contended). **In a fleet it double-grabs** — two
dispatchers both see `pendingTasks[0]` and both run it. A *shared* file lock doesn't fix
it; it serializes the fleet back to one worker.

**Fix:** collapse pick+claim into one write —
`UPDATE tasks SET status='active', claimed_by=:w, claimed_at=now, attempt_count=attempt_count+1
WHERE id=(SELECT id FROM tasks WHERE status='pending' AND <scheduled-ready> ORDER BY <boosted-priority> ASC, id ASC LIMIT 1) RETURNING *;`
The DB's write serialization picks the winner; the loser's `RETURNING` is empty and retries.

**Three consequences:**
1. **Substrate matters.** The statement is only as atomic as the store. Same-host
   multi-process SQLite = WAL + `busy_timeout` + `BEGIN IMMEDIATE` is enough. **Cross-host
   fleet = needs a networked DB** (Postgres/Turso/D1); one SQLite file over a share is not
   safe. This is the #1 design decision, not an implementation detail.
2. **Crash recovery flips.** Single-node reaps *any* `active` task on boot. A fleet must not
   reap a live peer's task → use a **lease**: reclaim only if `claimed_at` older than a TTL
   (> max cycle). `claimed_by` gives the observability single-node never needed.
3. **maker≠checker comes free.** A `verify` follow-up that sets `exclude_claimant=<maker
   worker_id>` forces a *different* worker to grade it — the independent-completion gate
   (Top-5 #4) falls out of the claim column, no special-casing.

See [[escalation-ladder-arc0011]]; full spec: `agent-runtime/proposals/0013-dispatch-loop-port.md`.
