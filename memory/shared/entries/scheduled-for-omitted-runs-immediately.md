---
id: scheduled-for-omitted-runs-immediately
topics: [dispatch, task-queue, scheduling, whop, measurement]
source: task #23811 / #23816 / #23818
created: 2026-07-25
---

`arc tasks add` supports `--scheduled-for ISO_DATETIME` (and `--defer DURATION`), but it is
opt-in — a task created without either flag has `scheduled_for=NULL` and is immediately
`pending`, eligible for the very next dispatch cycle regardless of what the creating task's
`result_summary` claims. Task #23811 said "Created follow-up task #23816 scheduled for
2026-07-31" but never passed `--scheduled-for`, so #23816 dispatched same-day (2026-07-25,
~20h after baseline) instead of the intended 1-week mark.

**Why:** intent expressed only in prose (subject/description/summary text) is not enforced by
the scheduler — only the `--scheduled-for`/`--defer` flag is. A task-creation step that narrates
a future date without passing the flag silently produces an immediate-run task.

**How to apply:** when creating any "check back in N days/weeks" follow-up, always pass
`--scheduled-for` (or `--defer`) explicitly — never rely on the subject/description wording
alone. When picking up a "re-measure X" task, verify `scheduled_for` in the DB actually matches
what the parent task's summary claimed before trusting the measurement window is real.

Related, same task: **whop member_count has no per-post/per-experience metric.**
`arc skills run --name whop -- list-members` returns the whole-company member count (all
products/rooms combined); `arc-attribution`'s `free_room_joins` counts `whop_event_log`
`membership.activated` rows with 0/null `amount_cents` company-wide, not scoped to a specific
free-room experience or blog post. A prior task's "member_count=0 → member_count=4" same-day
jump (#21499) was comparing two different scopes (a free-room-specific expectation vs the
whole-company total), not real or fake growth — there is currently no way to attribute a
member join to a specific post without building a per-experience/per-post join query.
