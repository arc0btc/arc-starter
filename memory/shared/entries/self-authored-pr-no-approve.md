---
id: self-authored-pr-no-approve
topics: [pr-review, github, aibtc-repo-maintenance]
source: task #20451 2026-06-30
created: 2026-06-30
---

# Self-authored PR can't be approved via `gh pr review --approve`

GitHub's GraphQL API rejects `addPullRequestReview` with "Can not approve your own pull request"
when the PR author matches the reviewing account. This hits Arc directly: PRs authored by
`arc0btc` (e.g. dependency-pin fixes Arc opened itself) cannot be formally approved by Arc even
though the review task is dispatched normally.

**Fix**: pre-flight check `gh pr view NUMBER --json author` before attempting `gh pr review
--approve`. If `author.login == "arc0btc"`, skip the approve call and instead leave a `gh pr
comment` documenting the verification performed (diff matches description, claims checked against
actual file contents, etc.), then close the task as completed — the PR is still mergeable by
whoabuddy, it just lacks a formal Arc approval.

See also: `approved-pr-guard` pattern in memory/patterns.md for the reviews-list quirk
(`gh pr view --json reviews` not `gh pr reviews`).
