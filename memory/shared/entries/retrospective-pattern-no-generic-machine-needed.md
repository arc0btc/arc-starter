---
id: retrospective-pattern-no-generic-machine-needed
topics: [workflows, retrospective, state-machine, task-queue, dedup]
source: task #20645 (evaluated per task #20640 pattern-detection sensor)
created: 2026-07-01
---

# Evaluated and rejected: generic RetrospectiveMachine (triggered→analyzing→learnings-captured)

arc-workflow-review sensor flagged 11 recurrences of "retrospective" task chains
(avg 2.6 steps) as possible chain-drift worth formalizing into a state machine.
Investigated the actual task data before building anything.

**Finding**: retrospective handling is already split two ways, by design (not
accident):

1. **Dedicated machines exist wherever dedup actually matters** —
   `HealthAlertMachine.retrospective_pending`, `FailureRetrospectiveMachine`
   (daily failure triage), `SelfReviewCycleMachine`, `OvernightBriefMachine.retrospective`.
   These fire off *alert type* or *cycle date*, where multiple workflow instances
   can independently trigger the same logical retrospective — see
   [[retrospective-workflow-3054-duplicate-flood]] for a case where
   `HealthAlertMachine` needed a dedup fix (source keyed on workflow id instead
   of alertType let 6 duplicate instances slip through the 60min window guard).

2. **Everything else uses a plain ad-hoc task**: `Retrospective: extract
   learnings from task #N`, `source="task:N"`, `parent_id=N`. This covers
   architecture-review, evals, memory-health, PR fixes, compliance-review,
   collaboration wrap-ups — created directly per CLAUDE.md's "per-task
   reflection" guidance, not through workflow machinery.

**Query result** (2026-07-01, `db/arc.sqlite`): 1921 completed / 67 failed / 3
pending for subject LIKE 'Retrospective:%'. All 67 failures date to the
defunct March-2026 fleet era (Arc went solo 2026-03-27) — zero drift, zero
duplication, zero stuck states in the current ad-hoc path. It self-dedups by
construction: one parent task id can only produce one retrospective task, no
instance-key collision is possible the way it is across separate workflow ids.

**Conclusion**: a generic `RetrospectiveMachine` would add state-machine
overhead to a pattern that already works, and risks reintroducing the exact
per-instance-vs-logical-key dedup bug that `HealthAlertMachine` just got
patched for (commit a2fabe85). Not built. If a *specific* new trigger type
starts producing genuine duplicate/stuck retrospectives (like the 3054
incident), give that trigger its own dedicated machine — don't generalize
until a second concrete incident shows the same failure shape.

See [[action-null-noop-stuck-state]] for the actual recurring bug class in
this codebase (action:()=>null waiting states with no poller) — that's the
real chain-drift risk, not missing retrospective formalization.
