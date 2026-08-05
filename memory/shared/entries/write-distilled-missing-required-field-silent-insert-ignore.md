---
id: write-distilled-missing-required-field-silent-insert-ignore
topics: [artifacts, sqlite, bugs, distilled-nuggets]
source: task-25143
created: 2026-08-05
---

`writeDistilled()` (`src/artifacts.ts`) requires `title` and `source_path` on
`DistilledArtifact` but does not runtime-validate them the way it validates
`type`/`nugget`/`suggested_channels`/`topic`/`citation`. Omitting `title`
(e.g. writing a minimal call with just type/topic/nugget/citation/produced_at)
lets the function proceed past validation, write the JSON file to disk via
`writeFileSync` + `renameSync`, then hit `INSERT OR IGNORE ... title=NULL`
against the `title TEXT NOT NULL` column — SQLite's `OR IGNORE` swallows the
NOT NULL violation silently, so the DB row never lands but no exception is
thrown and the call returns "success."

**Consequence:** the file exists on disk but is invisible to every DB-backed
reader (`arc-artifacts list`, TTL sweep, dedup-by-basename). Worse, because the
collision-probe (`makeBasename`) checks the DB for existing basenames, not the
filesystem, a second `writeDistilled()` call with the same `produced_at`+`topic`
silently reuses basename `probe=0` again (since the DB shows no row) and
**overwrites the first file on disk** instead of getting a `__01` suffix.

**Fix applied ad hoc:** always pass `title` and `source_path` explicitly.
**Better fix (not yet filed):** `writeDistilled` should validate `title` and
`source_path` are non-empty strings the same way it validates `nugget.length`,
and/or use `INSERT` (not `OR IGNORE`) so schema violations throw instead of
silently no-op.

See [[watch-interior-distill]] for the caller context this bit (nugget
distillation task, `arc-reporting` watch report pipeline).
