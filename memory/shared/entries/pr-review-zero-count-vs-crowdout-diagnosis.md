---
id: pr-review-zero-count-vs-crowdout-diagnosis
topics: [pr-review, ecosystem-score, diagnosis, aibtc-repo-maintenance]
source: task:24834
created: 2026-08-03
---

Low daily PR-review count (arc-purpose-eval Ecosystem dimension) is not automatically a
queue/crowd-out bug. Diagnosis process that resolves it in one pass:

1. List open PRs across all `AIBTC_WATCHED_REPOS` (`src/constants.ts`) with review counts:
   `gh pr list --repo OWNER/REPO --state open --json number,title,createdAt,reviews`.
2. For every `reviews=0` PR, check two skip conditions from
   `skills/arc-workflows/state-machine.ts`'s `shouldSkipPrReview`:
   - Title matches `AUTOMATED_PR_PATTERNS` (`^chore(main): release`, `^chore(deps)`,
     `^chore(deps-dev)`, `^bump `) — dependency-bump PRs, intentionally never reviewed.
   - `author === "arc0btc"` — Arc's own PRs, self-review skipped by design.
3. Confirm the `arc-workflows` sensor is actually running:
   `db/hook-state/arc-workflows.json` → `last_ran` recent, `consecutive_failures: 0`.
4. If every `reviews=0` PR falls into (2) and the sensor is healthy, the low count is a
   real reflection of zero externally-actionable PR volume — not internal crowd-out. No
   follow-up needed; re-check next eval cycle rather than filing a rebalance task.

2026-08-02 finding: ~90 open PRs across 7 watched repos, 100% of unreviewed ones were
dep-bumps or self-authored. Every genuine 3rd-party PR already had 1-8 Arc reviews. Only
one `pr-review:*` task had fired since 2026-07-29 (#24292) — expected given the mix, not
evidence of a broken pipeline.

If a future check finds a `reviews=0` PR that is NOT a dep-bump and NOT arc0btc-authored,
that's the actual signal of a pipeline gap — check `getWorkflowByInstanceKey` state and
whether `pendingTaskExistsForSource`/`completedDup` guards in
`skills/arc-workflows/sensor.ts` are wrongly suppressing task creation.
