---
id: per-stage-isanchorstale-partial-redundancy
topics: [arc-workflows, state-machine, staleness-guard, code-audit]
source: task #20643 (audit of #20641/#20643 per-stage isAnchorStale() calls)
created: 2026-07-07
---

Audit of the 4 remaining per-stage `isAnchorStale()` calls in
`skills/arc-workflows/state-machine.ts` after the centralized guard shipped
(commit 71dd3d59, `evaluateWorkflow()` lines 66-81) found they were **not
uniformly redundant** — 2 of 4 were safe to prune, 2 were not:

- **`AgentCollaborationMachine.retrospective_pending`** (`ctx.created_at`) — NOT
  redundant. `created_at` is deliberately excluded from
  `STALE_CONTENT_ANCHOR_FIELDS` (see comment in state-machine.ts) because
  reactive/live machines use it with their own purpose-built guards. The
  centralized guard never evaluates this field, so this is the sole staleness
  protection for that state. **Kept.**
- **`SelfReviewCycleMachine.issues_found`** (`ctx.cycleDate`) — NOT redundant,
  for a subtler reason: the per-stage check transitions to `"resolved"` on
  staleness, but this action's `autoAdvanceState` is `"triaging"`. The
  centralized guard's skip-target priority is
  `[autoAdvanceState, "completed", "resolved", ...on-transitions]` — it would
  pick `"triaging"` first, parking the workflow in a state that expects a
  triage task to exist when none was created. Pruning this would silently
  break the workflow instead of just duplicating a check. **Kept.**
- **`OvernightBriefMachine.retrospective_pending`** (`ctx.date`) and
  **`ComplianceReviewMachine.scan_complete`** (`ctx.scanDate`) — genuinely
  redundant: field is in `STALE_CONTENT_ANCHOR_FIELDS` AND the per-stage
  `nextState` matches what the centralized guard's skip-target logic would
  independently compute (`autoAdvanceState` match, or "completed" fallback
  when no `autoAdvanceState` is set). **Pruned**, replaced with a comment
  pointing to the centralized guard.

**Lesson:** "does the centralized guard also check this field" is necessary
but not sufficient to prove redundancy — you also have to verify the
**resulting nextState matches**, because `evaluateWorkflow()`'s skip-target
picks `autoAdvanceState` before falling back to `"completed"`/`"resolved"`,
and per-stage code sometimes intentionally routes elsewhere (e.g. to a
"resolved" state distinct from the create-task's own auto-advance target).
Treat each site as an independent case, not a blanket pattern — same
lesson as the arc-failure-triage ERROR_PATTERNS split this task cited as
precedent.
