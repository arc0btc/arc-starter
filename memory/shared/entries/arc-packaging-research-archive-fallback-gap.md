---
id: arc-packaging-research-archive-fallback-gap
topics: [arc-packaging, arc-housekeeping, whop, research]
source: task:25820
created: 2026-08-11
---

`skills/arc-packaging/cli.ts`'s `composeMaterials()` and `cmdStage()` both read the
report at `join(RESEARCH_DIR, reportFile)` (i.e. `research/<file>`) with no fallback
to `research/archive/<file>`. `arc-housekeeping` sweeps `research/` on its own cadence
and moves ISO-8601-prefixed files into `research/archive/` once they age out (see
[[housekeeping-archival-dirname-refactor-breakage]]) — independent of whether
`arc-packaging`'s SKU backlog (`research/INDEX.md`) still lists the report as an
eligible, unpackaged candidate. When housekeeping wins the race, `arc-packaging`
reads a nonexistent path, `fs.existsSync` returns false, and `reportMarkdown` /
`rawReportMarkdown` silently become `""` — no error. `materials` writes a brief with
an empty report body; `stage` gets further (whop `create-product` mints a real
product + one-time plan) before whop's own SDK validation rejects the empty
`--report` file, leaving an **orphan hidden Whop product with no deliverable, and no
row in `packaging_queue_log`** (the DB write for `product_id`/`plan_id` never ran
because the CLI errored first).

**Pattern**: two skills independently racing on the same directory (one archiving,
one still expecting the file live) with no existence-check fallback turns a routine
housekeeping sweep into a silent empty-content bug several steps downstream, not a
crash at the read site. When a skill reads files from a directory another skill
periodically archives, always fall back to the archive path before assuming
"file doesn't exist yet" — don't assume same-day, same-run consistency between
independently-scheduled skills touching the same directory.

**Fix filed**: #25822 — add `research/archive/<file>` fallback to both read sites;
manually clean up orphan product `prod_r5heVkDZsudDR` / plan `plan_bY2xJ39lDeTTb`.
