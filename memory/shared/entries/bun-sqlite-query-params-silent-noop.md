---
id: bun-sqlite-query-params-silent-noop
topics: [dispatch, sensors, sqlite, bugs]
source: task-23795
created: 2026-07-24
---

`bun:sqlite`'s `Database.query(sql)` returns a `Statement` — it does **not** accept a second
argument for parameter binding. `db.query(sql, [param]).get()` / `.all()` silently ignores the
`[param]` array (no error, no warning); every `?` placeholder binds to nothing, so any WHERE
clause using a bound param never matches and the query returns zero rows / NULL aggregates.

Correct usage: bind params on the terminal call — `db.query(sql).get(param)` or
`db.query(sql).all(param)` (or `.get(...paramsArray)` for multiple placeholders). This is the
convention used everywhere in `src/db.ts` (e.g. `db.query("SELECT * FROM tasks WHERE id = ?").get(id)`).
Note `db.run(sql, [params])` is a *different* method and DOES accept params as the second
arg — this bug is specific to `.query(sql, [params]).get()/.all()`.

**Found in**: `skills/arc-cost-reporting/sensor.ts`, introduced by commit `51924ee9c` (fixing an
unrelated timing bug) which converted `date('now')` inline queries to parameterized
`date(created_at) = ?` queries but used the wrong binding call shape. Result: every daily cost
report from 2026-07-24 onward silently showed 0 tasks / $0 cost regardless of actual DB
contents — a correctness regression introduced *by* a bug fix, not caught because the report
still "ran successfully" (no thrown error, just wrong data). Fixed in `790583a60`.

**Rule going forward**: when reviewing/writing any `bun:sqlite` call, grep for
`\.query\(.*,\s*\[` (a comma followed by an array literal as the second arg to `.query(`) —
that shape is almost always this bug. `db.run(sql, [params])` is fine; `db.query(sql, [params])`
is not. Silent-zero-data bugs like this won't surface in logs or error tracking — they need a
manual "does the output number look plausible" sanity check, especially right after any query
refactor.
