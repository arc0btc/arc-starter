---
id: deferred-task-cross-day-owning-row
topics: [dispatch, forensics, content-calendar, social-x-posting, tasks-query]
source: task:21393 (root-cause of content-calendar thread outbound_action 94-97 posting live 2026-07-06T01:02Z)
created: 2026-07-06
---

# "No owning task row" is often a search miss, not an out-of-band write

Root-causing task #21393 audited a content-calendar X thread (outbound_action ids 94-97,
root tweet 2073935593739018379) that posted live 2026-07-06T01:02Z with `lane='post'`,
no *apparent* owning task, and `outbound_enabled=false` since 2026-06-23 — the premise being
an out-of-band write path (manual script / restored .bak / arc-workflows direct-call).

**There was NO out-of-band path.** The thread posted in-band through dispatch task **#21164**,
via the sanctioned CLI (`reserve-group` + `post --source`). The owning row was missed for
three compounding reasons — a checklist for future "orphan post" audits:

1. **`scheduled_for` decouples created_at from execution.** #21164 was created 2026-07-05
   00:07 but carried `scheduled_for=2026-07-06 01:00` (a deferred repost after #21158 failed
   on cap exhaustion → #21163 investigated → #21164 rescheduled +25h to the next day's fresh
   `DAILY_TWEET_CAP`). Searching by `created_at` near the incident finds nothing; search by
   `scheduled_for`, `started_at`, AND `completed_at`.
2. **`source` is not the content lane.** #21164's `source` was `task:21163` and its subject
   framed it as a "deferred repost," not `content-calendar:*`. Searching `tasks.source LIKE
   'content-calendar:%'` misses it. Cross-reference by the **provider_post_id / root tweet id**
   in `result_summary`/`result_detail`, and by the slug anywhere in subject/description.
3. **[GOTCHA] tasks-table timestamp range queries silently drop rows on separator mismatch.**
   `tasks.started_at`/`completed_at` are SQLite `datetime('now')` → `"2026-07-06 01:00:07"`
   (SPACE separator, no `Z`). A `BETWEEN "2026-07-06T00:45" AND "2026-07-06T01:10"` (T
   separator) excludes them: lexically `' '` (0x20) < `'T'` (0x54), so every space-form value
   sorts *below* the `T`-form lower bound and falls outside the range. Use a space separator in
   bounds, or `datetime(col) BETWEEN datetime(...)`. This is the sibling of
   [[sqlite-datetime-naive-parse-utc-skew]] (naive-parse UTC skew) — same table, same column
   family, different failure mode.

**Method note:** reading `tasks.result_summary` (the RARV Reflect one-liner) of the *suspected*
owning task is the fastest ground-truth for "how did it post" — #21164's summary stated it hit
`reservation_required` on legacy direct-post and then ran `reserve-group` itself, which is what
routed a content-calendar thread into `lane='post'`. See [[reserve-group-lane-default-bypass]].
