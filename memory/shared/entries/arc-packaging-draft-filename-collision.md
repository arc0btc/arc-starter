---
id: arc-packaging-draft-filename-collision
topics: [arc-packaging, whop, gotcha]
source: task #24239, #24240
created: 2026-07-28
---

`db/packaging-materials/<slug>.json`/`.draft.json`/`.deliverable.md`/`.quiz.json`/`.cover.png`
were all keyed on `slug` (derived from the report filename with the ISO-timestamp prefix
stripped — see [[whop-route-reserved-generic-slug]]), which collapses nearly every
generically-named `<timestamp>_research.md` report to the SAME slug `"research"`. Unlike the
route-collision gotcha (a Whop-side 400 you notice immediately), this one is silent: a stale
draft from a PRIOR different report can sit under `research.draft.json` and get read (or
overwritten) by the wrong candidate on a later dispatch turn. Observed directly in task #24239 —
`research.draft.json` still held content drafted for a 2026-07-13T17:50:05Z report when the
current turn started drafting for a different (2026-07-13T19:31:12Z) report; caught only because
the dispatched session happened to read the brief content before writing.

Fix (#24240): added a `file_key` column to `packaging_queue_log`, derived from the full,
always-unique `report_file` via `fileKeyFromReportFile()` (colon/slash-safe transform, not a
truncating slug). Every on-disk materials/draft/deliverable/quiz/cover filename now keys on
`file_key`. `slug`/`route` remain exactly as before — cosmetic, used only for the Whop product
route (`whop-route-reserved-generic-slug`'s `--route` override is unaffected). Mirrors
arc-daily-read's `finding_report_file` fix ([[daily-read-slug-collision-blocks-rotation]],
#24018) — same root-cause shape, different pipeline. Pre-fix rows with a NULL `file_key`
backfill automatically on the next `materials` run for that report, or fall back to a freshly
derived value in `stage`.

**Gotcha generalized**: any pipeline that derives a filesystem key from a "descriptive slug"
stripped out of a timestamped filename will collide whenever the source filename has no
descriptive part. Check `finding_report_file`-style fixes (key off the full unique source
identifier, keep the slug cosmetic) before assuming a per-pipeline one-off fix is needed —
verify the *existing* fix's scope first, since arc-daily-read's version.
