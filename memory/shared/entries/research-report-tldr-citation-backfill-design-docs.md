---
id: research-report-tldr-citation-backfill-design-docs
topics: [arc-daily-read, arc-link-research, research-reports, citations]
source: task:26032
created: 2026-08-13
---

# Backfilling TL;DR + file:line citations into research reports

`arc-daily-read`'s `extractFindingMaterials()` (skills/arc-daily-read/cli.ts:480) only accepts a
report as a candidate finding if it has BOTH a `## TL;DR` or `### TL;DR` heading with a bolded
bullet AND at least one real `` `path/to/file.ext:LINE` `` citation that resolves against a file
that actually exists under `ARC_STARTER_ROOT` (see `resolveCurrentFileLine`,
skills/arc-daily-read/cli.ts:566). Reports written before this contract existed, or written by
`arc-link-research` for non-code sources (design docs, specs, tweets), commonly lack one or both
and are silently invisible to the daily-read pool — not an error, just excluded.

**Two citation shapes it recognizes**, both inside backticks:
- Anchored: `` `symbolName`, `file.ts:123` `` — re-resolves the symbol's *current* declaration
  line via grep at selection time (drift-proof, per #25329). Preferred when the finding is about a
  real function/const/class.
- Bare: `` `file.ts:123` `` — accepted as-is if the line number is still in-bounds. No drift
  protection, but works for `.md` files too (the extension whitelist is
  `ts|tsx|js|md|json`), which enables **self-citation**: a design/spec doc can cite its own
  `file:line` for a real, verifiable-in-repo claim when there is no implementation to point at.

**When backfilling a relevance>=4 report that's missing this contract:**
1. Check whether the report's subject has a live implementation (`grep -rl <keyword> src/ skills/`).
   If yes, cite the real function with the anchored form — stronger ("tested against live agent")
   than a self-citation. Example: the council DSL specs (`agent-council-dsl-grammar-v1.md`,
   `agent-council-dsl-spec.md`) cite `skills/council-dsl/validator.ts`'s `tally`/`validate`.
2. If it's genuinely design-only/not-yet-built (e.g. `arc-action-gate-design.md`, still unimplemented
   as of 2026-08-13), don't fabricate a citation into unrelated code that doesn't actually do what
   the doc describes — that misrepresents state. Self-cite the doc's own most concrete/measured
   claim line instead (bare form, `.md` extension is accepted).
3. Add the `## TL;DR` heading with one bolded (`**...**`) bullet containing the citation, near the
   top, before the first `## ` section — `extractFindingMaterials` stops scanning at the next `## `.
4. After editing, re-run `arc skills run --name arc-link-research -- reindex` and sanity-check with
   `bun skills/arc-daily-read/cli.ts materials` (writes a real edition-N.json brief as a side
   effect — expected, not a bug; `db/daily-read-materials/*.json` isn't git-tracked).

Note: `research/` is entirely `.gitignore`d (`.gitignore:23`) — edits to report files are
local-only state, not committed.
