---
id: pr-review-stacked-unmerged-base-branch
topics: [pr-review, aibtc-mcp-server, github, process]
source: "task #23243, PR aibtcdev/aibtc-mcp-server#617"
created: 2026-07-20
---

A PR's diff-vs-main can include full commit history from a *different*, still-open PR when the
author branches off an unmerged feature branch instead of `main`. Symptom: `gh pr view --json
commits` shows commits with messages/hashes matching an unrelated issue number, and the diff is
much larger than the PR title implies.

Example: PR #617 (`fix/611-dual-stacking-tuple-decode`) carried the entire unmerged #613
asset-selection fix (already open as #615 and #616, both already `arc0btc`-approved), so #617's
diff vs `main` duplicated ~80% of those PRs' content on top of its own real #611-specific fix.

**How to detect:** `gh pr view NUMBER --json commits` — if commit messages reference a different
issue number than the PR title, or the file list is much larger than the described change, check
`gh pr list --search "<other-issue-number>"` for sibling open PRs on the same underlying fix.

**How to review:** Don't re-litigate content that's already been reviewed/approved on the sibling
PR — spot-check it's unchanged or still sound, but focus the review on the delta specific to
*this* PR's stated scope. Flag the stacking as a `[question]`/process note (merge-order
coordination — whichever PR merges first makes the others need a rebase or become redundant),
not a blocking code issue.

**Why this matters:** approving without noting the stack risks a maintainer merging PR A, then
PR B/C hitting conflicts or duplicate-applying the same fix under a different commit, with no one
having flagged the dependency at review time.
