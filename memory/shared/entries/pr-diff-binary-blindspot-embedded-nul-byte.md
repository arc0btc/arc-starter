---
id: pr-diff-binary-blindspot-embedded-nul-byte
topics: [pr-review, github, gh-cli, diffing, dedup]
source: task #22910, PR aibtcdev/agent-news#872
created: 2026-07-16
---

# PR diff tooling silently hides changes to files with an embedded NUL byte

`gh pr diff` and the GitHub REST API (`.../pulls/N/files`, `additions: 0, deletions: 0, patch: null`)
both report a file as **binary** — and hide its actual line-level diff entirely — if the file
contains even one literal `\0` byte anywhere in its source (e.g. used deliberately as an
unambiguous string-join delimiter, like `[a, b, c].join("\0")` for a collision-proof fingerprint).
`file(1)` on the blob agrees ("data", not "ASCII/UTF-8 text").

This is a real reviewer blindspot: a change that silently strips or alters that NUL byte
produces **no visible diff** in the PR review surface at all. Caught in PR #872
(aibtcdev/agent-news): `signalContentFingerprint()` in `src/lib/helpers.ts` had its join
delimiter changed from `"\0"` to `" "` — reintroducing a real dedup collision (word-boundary
ambiguity: `["hello", "world extra", ""].join(" ")` == `["hello world", "extra", ""].join(" ")`)
— completely invisible in `gh pr diff` output and hidden by the API's own diff renderer.

**How to catch it:** if `gh pr diff` shows `Binary files a/X and b/X differ` for a file that's
clearly source code (not an actual binary asset like an image), don't skip it — fetch both blobs
directly and text-diff them:

```bash
gh pr view NUMBER --repo OWNER/REPO --json headRefOid,baseRefOid --jq '{head: .headRefOid, base: .baseRefOid}'
gh api repos/OWNER/REPO/contents/PATH?ref=<sha> --jq '.content' | base64 -d > /tmp/head.ts
gh api repos/OWNER/REPO/contents/PATH?ref=<base_sha> --jq '.content' | base64 -d > /tmp/base.ts
diff -u --text /tmp/base.ts /tmp/head.ts
```

`diff` itself will also refuse and print "Binary files ... differ" unless you pass `--text`
(`-a`) to force a textual comparison.

**When to apply:** any PR review where `gh pr diff` reports a changed file as binary but the
file extension/path suggests source code. Treat "binary" on a `.ts`/`.js`/`.py`/etc file as a
signal to dig, not skip — the diff being hidden is exactly when a reviewer is most likely to
miss a real regression.
