---
id: whop-route-reserved-generic-slug
topics: [arc-packaging, whop, gotcha]
source: task #21425, commit 9c9d6939
created: 2026-07-06
---

`whop create-product --route <slug>` can fail with `400 "This whop link is already reserved
for another creator"` even on the FIRST attempt to mint a product — this is a global Whop
namespace collision, not a local `packaging_queue_log` bug. It hits hardest for reports whose
filename has no descriptive part after the ISO-timestamp prefix (e.g.
`2026-06-23T13:33:01Z_research.md` auto-derives the generic slug/route `research`, which is
already taken company-wide on Whop).

`arc-packaging materials --slug <x>` looked like the fix but does nothing once a row exists —
`packaging_queue_log` is keyed by `report_file` (PK) and `materials` does `INSERT OR IGNORE`,
so a re-run with a new `--slug` silently writes a new brief file but leaves the DB row's
`route` (and the `stage`-loaded draft filename, keyed on the ORIGINAL `row.slug`) unchanged.

Fix shipped: `stage --route <slug>` overrides just the Whop route (not the draft-lookup slug),
persisted via `UPDATE packaging_queue_log SET route = ...` — no raw SQL needed, no need to
touch the draft/materials filenames. See `skills/arc-packaging/cli.ts` `cmdStage`.
