---
id: daily-read-blog-task-crash-recovery
topics: [arc-daily-read, arc-day-n-publishing, dispatch, recovery]
source: task:21828
created: 2026-07-09
---

**Gap:** `arc-daily-read cmdPost`'s post-drain blog-publish queuing step
(`skills/arc-daily-read/cli.ts` ~line 1592) has no idempotent self-heal path.
If it throws before `insertTaskDeduped` succeeds — e.g. #21827
([[skill-cli-src-db-dual-singleton-crash]]) — where
`src/db.ts`'s `insertTaskDeduped` was called without `initDatabase()` first —
`daily_read_log.blog_slug` stays NULL for that edition and no blog-publish
task is ever queued. Re-running `post --live` does not retry the block: the
edition is already logged, so `alreadyPostedToday()` short-circuits before
reaching the blog-queue code.

**Fix:** Added an admin recovery subcommand, `queue-blog-task --edition N
[--dry-run]`, that reads the already-logged `daily_read_log` row for edition
N and re-runs the exact same blog-queue logic (DAYN_MERGED check,
`blog_slug IS NULL` guard, `buildBlogPublishTask` + `insertTaskDeduped`,
then `UPDATE daily_read_log SET blog_slug = ?`) against it. Safe to run
against any edition — no-ops if `blog_slug` is already set, void, or
DAYN_MERGED is off. Recovered edition 5 with this (#21828 → task #21830
queued).

**Pattern:** When a queuing step lives inside a larger command's post-drain
flow and is gated by "already logged" state upstream, a targeted admin
`<action> --edition N` subcommand that operates on the persisted row (not a
fresh in-memory object) is the CLI-first way to recover — avoids raw SQL and
avoids re-triggering the whole flow (which would re-post/re-email). Consider
this shape whenever a multi-step post-log side effect can fail independently
of the steps before it.
