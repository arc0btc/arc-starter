---
id: housekeeping-archival-dirname-refactor-breakage
topics: [housekeeping, arc-link-research, refactor-risk]
source: task:25733
created: 2026-08-11
---

`skills/arc-housekeeping/cli.ts`'s `ARCHIVAL_DIRS` constant listed literal directory
names (`["reports", "research"]`) to sweep for ISO-8601-prefixed file archival. The
2026-03-04 blanket skill-rename refactor (`4ffd1a658`, "rename all 49 skills to
domain-function-action convention") did a global find-replace of `research` ->
`arc-link-research` that caught this unrelated string constant, silently redirecting
the archival check at an unused legacy top-level `arc-link-research/` dir (4 files)
instead of the real `research/` output dir. Result: `research/` grew unarchived from
March to August (218 active reports vs the intended keep-5), discovered only via a
housekeeping audit task, not any error or alert — the check just silently matched
zero relevant files every run.

**Fix**: restored `ARCHIVAL_DIRS = ["reports", "research"]` (#25733), ran `fix`,
archived 202 backlogged reports.

**Pattern**: bulk rename/refactor scripts that string-match a domain name (skill
name, dir name) can clobber unrelated literals that happen to share the string,
with no test or alert catching it — the failure mode is silent no-op, not a crash.
When doing a repo-wide rename sweep, grep the *before* name in config constants
(`ARCHIVAL_DIRS`, `WATCHED_DIRS`, similar arrays) separately and diff-review those
hits by hand rather than trusting a blanket search-replace across all file types.
