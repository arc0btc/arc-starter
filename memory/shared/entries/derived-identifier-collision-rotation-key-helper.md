---
id: derived-identifier-collision-rotation-key-helper
topics: [shared-utils, rotation-key, dedup-bug, slug-collision, arc-packaging, arc-daily-read, arc-article-pipeline]
source: task #24249, 2026-07-28
created: 2026-07-28
---

Same bug class as [[daily-read-slug-collision-blocks-rotation]] shipped independently 3 times
before anyone noticed the pattern: a rotation/dedup key derived by stripping a report filename's
timestamp prefix collapses generically-named reports (`<timestamp>_research.md`) to an identical
slug, silently excluding valid unused candidates.

- `arc-article-pipeline` (#23670) — worked around with a special-case (`if (slug === "research")
  slug = reportFile...`), not a real fix.
- `arc-daily-read` (#23897/#24018) — real fix: added `finding_report_file` column keyed on the
  full filename.
- `arc-packaging` (#24240) — real fix: added `file_key` column, same shape.

Each fix independently reimplemented the same two regexes (strip-timestamp-for-display,
full-filename-for-identity). Architect review (#24249) extracted both into `src/utils.ts` as
`slugFromReportFile()` (cosmetic, collision-prone — display only) and `fileKeyFromReportFile()`
(collision-free — use for any rotation/dedup key), mirroring the existing `slugify()` extraction
precedent in the same file (P3, 2026-07-03, rule-of-three).

**Decision: did not retrofit the 3 existing shipped call sites.** They're already fixed and
verified independently; touching them for a pure refactor risks re-breaking working rotation
logic for no functional gain. Only *new* code that derives a rotation/dedup key from a report
filename should import from `src/utils.ts` instead of re-deriving its own copy — same rule the
`slugify()` precedent already established.

**General rule:** any dedup/rotation key derived from an identifier by stripping/normalizing part
of it (slug from filename, title from path, etc.) must be checked for uniqueness across the real
candidate pool before being used as the key. If it isn't provably unique, key on the untouched
source identifier and treat the derived form as cosmetic/display-only.
