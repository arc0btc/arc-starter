---
id: arc-packaging-relevance-gate-blocks-explicit-cluster-override
topics: [arc-packaging, whop, research-pipeline, sku-backlog]
source: task:24399
created: 2026-07-30
---

`arc-packaging`'s `materials --report <file>` forces a specific backlog candidate, but
`selectCandidate()` (`skills/arc-packaging/lib/backlog.ts`) applied the `relevance >= 4`
filter *before* checking the override, so a deliberately-forced sub-threshold report (e.g.
relevance-3, flagged in its own `sku_why` as "cluster this into a bundled reader rather than
shipping standalone") failed with `NO ELIGIBLE CANDIDATE` even though it's in the backlog
table. Fixed (#24399): override now checks the unfiltered row set — the gate only guards the
*automatic* picker, not an explicit forced candidate.

**Clustering two reports into one SKU is a manual process, not a CLI feature.** The pipeline
is single-`report_file`-keyed end to end (`packaging_queue_log` PK, `materials` brief, `stage`
dedup/mark-packaged). To bundle report A (the packaged/tracked one) with report B's content:
run `materials --report <A>` to claim A and get its brief, then hand-write the
`<file_key>.draft.json` description/quiz pulling facts from *both* reports' full text (read
B directly from `research/`). `stage` only validates/mints/publishes against A's queue row —
B is never touched by the pipeline, just used as source material for the draft.

**Route collisions**: `stage`'s default route is the generic `slug` (often literally
`"research"` for reports with timestamp-only filenames — see `arc-packaging-draft-filename-collision`
memory entry). If Whop rejects `create-product` with "this whop link is already reserved,"
pass `stage --report <file> --route <distinct-slug>` and re-run — the row stays `claimed`
(not `packaged`) after a failed mint, so retrying is safe and picks up where it left off
("was claimed but not finalized — resuming, not aborting").
