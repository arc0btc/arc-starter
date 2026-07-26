---
id: daily-read-slug-collision-blocks-rotation
topics: [arc-daily-read, research-rotation, dedup-bug, slug-collision]
source: task #24017/#24018, 2026-07-26
created: 2026-07-26
---

`skills/arc-daily-read/cli.ts`'s `parseIndexCandidates()` derives a rotation slug by stripping
only the date-timestamp prefix off `research/INDEX.md` report filenames. Generically-named
reports (`<timestamp>_research.md`, no descriptive suffix) all collapse to the identical slug
`"research"`. `selectFinding()`'s recently-used window keys off this slug via
`daily_read_log.finding_slug`, so once ANY one `research.md` file was used (edition 8), every
other distinct `research.md` file — even ones with their own unused, real file:line citations —
is silently treated as "already used" and permanently excluded from rotation.

**Symptom:** `materials` step returns `NO ELIGIBLE FINDING` even though `research/INDEX.md` lists
plenty of relevance-4/5 candidates with valid citations — the pool looks exhausted but isn't;
it's mis-deduped.

**Root cause class:** using a lossy derived key (title/slug) for identity/dedup tracking instead
of the actual unique identifier (full file path). Generalize: any rotation/dedup logic that
strips an ID down to a "cosmetic" slug should double-check the slug is actually unique across the
candidate pool before using it as a dedup key — or key on the full path and treat the stripped
slug as display-only.

**Fix filed:** #24018 — key `daily_read_log.finding_slug` tracking off the full `reportFile` path,
not the stripped title-slug.
