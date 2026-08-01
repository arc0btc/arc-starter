---
id: research-repos-touched-enum-not-freetext
topics: [arc-link-research, frontmatter, research-catalog, validation]
source: task-24640
created: 2026-08-01
---

`repos_touched` in research report front-matter (`skills/arc-link-research/lib/frontmatter.ts`)
is a strict enum — `arc-starter | agent-runtime | both | neither | unknown` — not free text.
`parseFrontmatter` silently coerces any value not in that set back to `"unknown"`
(`frontmatter.ts:133`), so writing something like
`repos_touched: arc-starter (src/classifier.ts, src/models.ts)` LOOKS fixed when you read the
raw file, but reindex/catalog still treats it as unknown and re-flags `sku_candidate=y` reports
with the "ground it" warning.

**Rule:** when fixing `repos_touched`, use the bare enum value only. Put the specific
files/detail in the report's Arc-Alignment prose section, never in the front-matter field.

**How to apply:** after editing `repos_touched:`, always rerun
`arc skills run --name arc-link-research -- reindex` and grep the output for the filename to
confirm the warning actually cleared, rather than trusting a visual read of the file. Also:
a task description's list of "N reports with issue X" can be stale — re-grep
(`grep -rl "repos_touched: unknown" research/*.md` filtered to `sku_candidate: y`) before
assuming the count in the task is accurate; in task #24640 the description named 4 reports but
only 1 actually had the enum-invalid value (the other 3 already had it filled correctly at time
of task creation, and only broke again due to this same enum-vs-freetext mistake mid-fix).
