---
id: skill-cli-src-db-dual-singleton-crash
topics: [dispatch, db, gotcha]
source: "#21827"
created: 2026-07-09
---

Skill `cli.ts` files that maintain their own local DB connection (e.g. `getDb()` opening
`new Database(DB_PATH)` directly) are a SEPARATE connection from `src/db.ts`'s module-level
`_db` singleton, which is only set by calling `initDatabase()`. If such a skill later does
`await import("../../src/db.ts")` to reuse a helper like `insertTaskDeduped`/`pendingTaskExistsForSubject`,
that helper calls `getDatabase()` internally and throws `"Database not initialized. Call
initDatabase() first."` — even though the skill's own local `db` var is open and working fine.

**Why:** two independent DB objects/singletons exist in the process; opening one does not
initialize the other. Easy to miss because the failure only fires on the code path that imports
`src/db.ts`, which may be deep in a script (e.g. a follow-up-task-queuing step after the main work
already succeeded) — so the primary action (posting, publishing, etc.) looks like it worked, but the
crash silently drops a side effect (a task that should have been queued) instead of just showing as
a log-only failure.

**How to apply:** before calling any `src/db.ts` export (`insertTask*`, `updateRow`, etc.) from a
skill's `cli.ts` via dynamic import, call that module's `initDatabase()` first. When triaging a
crash "Database not initialized" inside a skill script, always check whether the crash happened
*after* real side effects already committed (posting, sending, publishing) — those tasks/rows may
now be permanently missing a downstream step (e.g. a queued follow-up task) that won't self-heal on
retry because idempotency guards ("already posted today") will just skip the whole run.
