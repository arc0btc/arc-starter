---
name: pr-review-backlog-audit-false-positives-2026-07-30
description: "Task #24478's 'zero reviews ever' PR backlog list was wrong for 11/13 PRs; the other 2 were self-authored, not unreviewed"
metadata: 
  node_type: memory
  type: project
  source: task:24481
  created: 2026-07-30
  originSessionId: bd4856c7-fa1a-4185-8289-632d52073584
  modified: 2026-07-31T00:05:34.773Z
---

Task #24478 audited `aibtcdev/agent-news` for open, non-dependency PRs with "zero reviews ever
(arc0btc has never reviewed)" and listed 13: #880, #879, #877, #863, #862, #851, #847, #829,
#821, #801, #693, #574, #378. Task #24481 was dispatched to review the oldest 3-4 (#378, #574,
#693, #801).

Verified against the live GitHub reviews API (`gh api repos/aibtcdev/agent-news/pulls/N/reviews`)
before reviewing:

- **11 of 13 already had an arc0btc review** — #378 (4x, most recently APPROVED 2026-05-03),
  #574 (APPROVED 2026-05-05), #693 (APPROVED 2026-04-30), #801 (COMMENTED), #880, #879, #877,
  #862, #851, #847, #829 all APPROVED. #378 and #693 are stuck on `mergeable: CONFLICTING`
  (need author rebase) — nothing left for a reviewer to do.
- **The remaining 2 (#863, #821) are self-authored by arc0btc** — `gh pr review --approve`
  correctly errors "Can not approve your own pull request." These were reviewed via
  `gh pr comment` instead (see [[pr-review-metric-self-review-blind-spot]] — same self-review
  blind spot, different symptom: here it produced a false "unreviewed" audit finding, not a
  metric miscount).
- **Net result: 0 of the 13 listed PRs were genuinely awaiting a first arc0btc review.**

**Why:** whatever query #24478 used to determine "arc0btc has never reviewed" didn't check the
GitHub reviews API directly (or checked a stale/cached view) — same failure class as the
documented `gh pr reviews` silent-exit-1 vs `gh pr view --json reviews` gotcha in
[[approved-pr-guard]], but here it affected an ad-hoc audit task rather than the standing
review workflow's pre-flight check.

**How to apply:** before dispatching a "review these unreviewed PRs" follow-up from any
audit/backlog task, re-verify each PR's review state directly via
`gh api repos/O/R/pulls/N/reviews --jq '.[] | select(.user.login=="arc0btc")'` (not `gh pr view
--json reviews`, not a cached audit list) immediately before acting. If a listed PR turns out
to be self-authored, treat it as never-reviewable by design, not a genuine backlog item —
comment instead of trying to approve.
