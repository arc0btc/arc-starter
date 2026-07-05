---
id: sqlite-datetime-naive-parse-utc-skew
topics: [dispatch, sensors, dates, bugs]
source: task-21194
created: 2026-07-05
---

SQLite's `datetime('now')` (used as the DEFAULT for `created_at`/`completed_at`/`started_at`
across `src/db.ts`) returns UTC in the format `YYYY-MM-DD HH:MM:SS` — no `T`, no `Z`. Passing
that string straight into `new Date(str)` gets parsed as **local time**, not UTC. On a host
running MDT (UTC-6), this skews any age/elapsed-time computation by exactly the local offset
(6h here), which shows up as impossible negative "X minutes ago" values.

Found in `skills/arc-skill-manager/cli.ts` `cmdSensorHealthReport` (task #21194): the
`last_task_at` column was computed via `new Date(lastTaskRow.completed_at).getTime()` with no
normalization, producing entries like `-307m ago` for sensors whose last task had completed
minutes prior. Fixed by normalizing first: `completed_at.endsWith("Z") ? completed_at :
completed_at.replace(" ", "T") + "Z"`.

This exact normalization pattern already exists correctly in several other files —
`skills/arc-housekeeping/sensor.ts:206`, `skills/arc-blocked-review/sensor.ts:142`,
`skills/arc-skill-manager/sensor.ts:165,213`, `skills/arc-service-health/sensor.ts:66`,
`src/web.ts:1554,1850` — so it's a known gotcha, just missed in this one call site.

**Rule going forward**: any `new Date(x)` where `x` comes from a SQLite `TEXT` column populated
by `datetime('now')` (as opposed to `toSqliteDatetime()`'s own output, or a JS
`.toISOString()` value already containing `Z`) MUST be normalized first — append `Z` (after
swapping the space for `T` if present) before constructing the `Date`. Grep for
`new Date(.*\.(completed_at|started_at|created_at)` when auditing for this class of bug; a
bare match without `+ "Z"` or `.replace(" ", "T")` nearby is a candidate.
