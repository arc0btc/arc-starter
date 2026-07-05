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

**Repo-wide audit (2026-07-05, task #21266)**: checked ~60 candidate files with both a DB
query pattern and a timestamp column name. Found one more instance, a **sibling bug shape**
rather than another naive-parse: `skills/arc-self-audit/sensor.ts:47`
(`collectTaskQueueMetrics`) compared `t.started_at` (raw SQLite `"YYYY-MM-DD HH:MM:SS"`)
directly against an ISO cutoff string (`"YYYY-MM-DDTHH:MM:SS.sssZ"`) with a plain `<` string
comparison — no `Date` parse at all. Space (`0x20`) always sorts before `T` (`0x54`)
lexicographically, so the comparison was `true` for every active task regardless of real
elapsed time, making `activeStuck` always equal `activeCount`. Fixed (commit 762f90ba) by
normalizing `started_at` to ISO+Z and comparing epoch-ms instead of raw strings. **Expanded
rule**: this bug class isn't limited to `new Date()` parses — any direct string comparison
(`<`, `>`, `<=`, `>=`) between a raw SQLite datetime column and an ISO-formatted string is
equally broken and won't be caught by a `new Date(` grep. When auditing, also grep for
`_at <` / `_at >` / `_at <=` / `_at >=` comparisons against `.toISOString()` values.
No other unfixed sites found in this pass — all other candidates were either writes, external
API values, or JSON-store values already in proper ISO+Z form.
