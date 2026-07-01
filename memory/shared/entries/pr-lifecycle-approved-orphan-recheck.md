---
id: pr-lifecycle-approved-orphan-recheck
topics:
  - arc-workflows
  - pr-lifecycle
  - stuck-state
source: task:20660
created: 2026-07-01
---

# pr-lifecycle 'approved' bucket: recheck reversed the benign assessment

`PrLifecycleMachine.approved` has the same `action: () => null` shape as two confirmed bugs
(`SelfReviewCycleMachine.dispatched`, `CostReportAuditMachine.auditing`). Task #20640 assessed it
as legitimate — waiting on a human merge decision, not an Arc bug — and filed no fix.

Task #20660 rechecked by fetching live GitHub state for all 82 workflows in `approved`:
`gh pr view <num> --repo <owner>/<repo> --json state,mergedAt`. Result: **38/82 already MERGED**
on GitHub (oldest merged 2026-05-13, i.e. 48 days stuck at recheck time), 44/82 genuinely still
OPEN. The initial "benign" call assumed all 82 were pending human review; it wasn't verified
against live GitHub state.

**Root cause**: `resolveApprovedPrWorkflows()` isn't draining workflows once their PR merges —
it's not being triggered, or its merge-detection query misses these rows. Fix filed as task #20680.

**Lesson**: for any `action: () => null` "waiting on external decision" state, don't accept the
benign label without checking live external state for a sample. "Waiting on human" and "orphaned,
nobody's polling" look identical from workflow context alone — the only way to tell them apart is
to check the actual upstream system (here, `gh pr view`).

See [[action-null-noop-stuck-state]] for the general noop-state taxonomy this pattern belongs to.
