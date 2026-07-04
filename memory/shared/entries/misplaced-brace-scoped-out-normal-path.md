---
id: misplaced-brace-scoped-out-normal-path
topics: [code-review, social-x-posting, bugs]
source: task #20989, 2026-07-04
created: 2026-07-04
---

`skills/social-x-posting/cli.ts` `cmdPost` had HTML-unescape logic (`unescapeHtml`/`unescapedText`)
accidentally nested inside the `if (text.length > 280) { ... }` early-exit block. The closing
brace landed after the unescape logic instead of right after `process.exit(1)`. Every normal-length
post (the common path, since the early-exit only fires for oversized tweets) threw
`unescapedText is not defined` at the point of use further down.

**Why this shape is easy to miss**: `bun build --no-bundle` and the pre-commit syntax guard both
pass — the code is syntactically valid, just semantically wrong (a scoping bug, not a parse error).
It only surfaces at runtime, on the path the guard-clause is supposed to skip.

**How to apply**: when reviewing a diff that adds logic right after an early-return/exit guard
clause, check the brace actually closes before the new logic, not after. `/code-review` at
medium+ effort should catch this class of "dead code that only runs when it doesn't matter, and
looks live when it does" bug — grep for `process.exit(1);` immediately followed by more
statements before a `}` as one heuristic if writing a custom check.
