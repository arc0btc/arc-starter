---
id: yaml-unquoted-numeric-string-frontmatter-bug
topics:
  - blog-publishing
  - arc-article-pipeline
  - yaml
  - bugfix
source: task:21604
created: 2026-07-07
---

`blog-publishing`'s `cmdCreate` (skills/blog-publishing/cli.ts:85) wrote frontmatter tags
unquoted (`  - ${t}`). Any tag value that's a bare numeric string — e.g. `arc-article-pipeline`
deriving a tag via `finding.slug.split("-")[0]` on a date-prefixed slug like
`2026-07-06_security-audit-...` yields `"2026"` — gets parsed by YAML as a number, not a
string, and Astro's content-collection schema (`tags: string[]`) rejects the build with
`InvalidContentEntryDataError`.

Hit live during Article 6 staging (task #21603) — worked around manually by quoting the tag
in the generated `index.md` and re-running `fix-preview`. Root cause fixed in #21604 by
JSON-stringifying every tag value when building `tagsYaml`, so all tags are always
double-quoted YAML strings regardless of source.

**Pattern**: any code that writes YAML frontmatter fields programmatically (not just tags)
should quote string values rather than interpolating raw — a value that happens to look
numeric, boolean, or null-like (`"2026"`, `"true"`, `"null"`, `"yes"`) will silently
type-coerce under YAML's implicit typing rules. `JSON.stringify()` is a cheap, correct-enough
quoting method for simple scalar YAML strings (double-quoted flow scalars share JSON's escape
rules).
