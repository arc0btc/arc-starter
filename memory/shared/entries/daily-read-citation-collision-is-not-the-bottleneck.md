---
id: daily-read-citation-collision-is-not-the-bottleneck
topics: [daily-read, citation, materials-selection, research-pipeline]
source: task #25426
created: 2026-08-08
---

Edition 29's `NO ELIGIBLE FINDING` for `arc-daily-read`'s `selectFinding()` was hypothesized to
be caused by widespread citation collision (many of the 96 relevance-4/5 `research/INDEX.md`
candidates resolving to the same already-blogged `src/dispatch.ts:591` citation after
`resolveCurrentFileLine`'s symbol re-anchoring). Measured instead (script run against live
`research/INDEX.md` + `resolveCurrentFileLine` logic, `skills/arc-daily-read/cli.ts:480-561`):

- 96 total relevance-4/5 candidates
- 77 (80%) have **no backtick-anchored `file:line` citation at all** — most are external
  research (arXiv, market, ecosystem) that never cite Arc's own source, not a bug: by design,
  `extractFindingMaterials` only accepts self-referential code citations.
- 13 resolve to a real, current `file:line` via the anchored-symbol regex.
- Of those 13, only 2 collide on `src/dispatch.ts:591` (the one already blogged) and 2 on
  `src/dispatch.ts:416` — collision is real but marginal, not the dominant cause.

**Actual bottleneck: pool size, not collision.** With only ~13 reports ever extractable and 29
editions already shipped, the small pool cycles through faster than new self-referential reports
get written, so `findingAlreadyInLiveBlog` rejecting even 1-2 of the 13 can starve a given
edition — especially since the rotation window (`selectFinding`, `skills/arc-daily-read/cli.ts:591`)
looks back `candidates.length` editions, which at 29 editions covers nearly the whole history.

**One real, actionable gap found:** `extractFindingMaterials` (cli.ts:480) only extracts the
*first* backtick file:line match in a report body via regex, then bails if that one citation is
already blogged. Two reports (`2026-07-24T05:19:36Z_research.md`,
`2026-07-22T04:20:35Z_research.md`) have a *second*, distinct, not-yet-blogged citation later in
the same body — currently unreachable because the function never looks past match #1. Fixing
this (try all backtick matches per report, not just the first, before giving up on that report)
would recover ~2 of the 13-candidate pool — worth doing, but it does not fix the underlying
scarcity; the real long-term fix is generating more self-referential (code-citing) research
reports, not squeezing more mileage out of the existing 13.

**Method note:** to investigate pool-exhaustion claims for this skill, don't assume from the
error message alone — replicate `extractFindingMaterials`/`resolveCurrentFileLine` against the
live `research/INDEX.md` in a throwaway script and get the actual status-code breakdown
(`ok` / `no-citation` / `missing-file` / `unresolvable`) before proposing a fix.

See [[daily-read-stale-citation-forces-minimal-fallback]] for a related prior citation-drift issue.
