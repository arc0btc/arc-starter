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

**2026-07-04 recurrence (task #21036)**: arc-workflow-review flagged two more
"chains" of this exact shape — `subject:self-review triage` (4 recurrences,
arc-self-review + arc-skill-manager) and `source:sensor:arc-purpose-eval` (3
recurrences, arc-purpose-eval + arc-strategy-review + arc-skill-manager).
Both are the same ad-hoc `task closes → Retrospective: extract learnings from
task #N` pattern already covered above — no new machine needed, same
conclusion. A third pattern, `source:sensor:blog-publishing:draft` (3
recurrences: "Review and finalize draft" → "Publish post" → retrospective),
is a distinct case but reaches the same verdict for a different reason: it's
already a deliberately bounded, self-dedup'd 2-task chain (per-postId source
key, 24h cooldown, `skills/blog-publishing/sensor.ts`), small enough that a
state machine would be pure overhead. Side note: the built-in
`BlogPostingMachine` template (draft→review→fact_check→revision→published)
has 0 live instances — it's dead/orphaned code, not wired to this sensor.
Not fixed here (out of scope for a pattern-evaluation pass); worth a cleanup
task if it comes up again.

**2026-07-05 recurrence (task #21183)**: arc-workflow-review flagged
`source:sensor:arc-strategy-review` (6 recurrences, avg 7.8 steps) — same
ad-hoc daily-eval → retrospective shape, same verdict. This time, rather than
re-evaluate and reject a 4th time, added actual exemptions to the sensor's
`KNOWN_PATTERNS`/`KNOWN_SUBJECT_PREFIXES` lists (`skills/arc-workflow-review/
sensor.ts`) so it stops re-surfacing: `sensor:arc-strategy-review` (this
pattern), plus `self-review` and `fix arc0btc.com health issue` (a genuinely
different case — already modeled by `SelfReviewCycleMachine` and
`SiteHealthAlertMachine` respectively, but each instance's `source` is a
unique `workflow:<id>` so it never groups under `bySource` and only surfaces
via `bySubject`, making it look unmodeled when it's the machine working
correctly). Lesson: this detector had no memory of prior verdicts, so the
same non-issue kept re-firing task after task — the fix belongs in the
detector's exemption list, not in another round of manual evaluation.
