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

**2026-07-06 recurrence (task #21317)**: three more flagged patterns, all
false positives from incomplete exemptions rather than new evaluation work.
(1) `subject:assess release` (8 recurrences, avg 2.0 steps, arc-skill-manager
only) — same ad-hoc retrospective shape, added to `KNOWN_SUBJECT_PREFIXES`.
(2) `source:sensor:arc-purpose-eval:followup` (3 recurrences) — the base
`sensor:arc-purpose-eval` was evaluated and rejected back in task #21036, but
only `sensor:arc-strategy-review` actually got added to `KNOWN_PATTERNS` at
the time; the exact-string match means any suffixed variant (`:followup`)
slips through even though the underlying sensor is exempted. Added both
`sensor:arc-purpose-eval` and `sensor:arc-purpose-eval:followup` this time.
(3) `source:sensor:arc-email-sync:thread` (15 recurrences, avg 4.8 steps) —
different reason: this one is **not** an ad-hoc retrospective case at all, it's
already fully modeled by `EmailThreadMachine` (received→triaged→reply_pending→
completed), wired into `skills/arc-email-sync/sensor.ts` via `insertWorkflow`
per thread — genuinely working as intended, just missing from the exemption
list. **Structural gap this exposes**: `normalizeSource` collapses 4+-part
sources to their first 3 segments, but leaves exactly-3-part sources
(`sensor:X:suffix`) untouched — so a 2-part exemption (`sensor:X`) never
matches a 3-part variant of the same sensor. Whoever fixes this class next
should consider matching on the `sensor:X` prefix rather than requiring an
exact string in `KNOWN_PATTERNS`, instead of enumerating every suffix by hand.

**2026-07-07 recurrence (task #21516)**: two more flagged patterns, both the
same shape, both closed by exemption rather than re-evaluation. (1)
`source:sensor:blog-publishing:content-generation` (7 recurrences, avg 2.3
steps) — same underlying sensor (`skills/blog-publishing/sensor.ts`) as the
`:draft` suffix variant rejected 2026-07-04 (task #21036), just renamed to a
different suffix; the bare-prefix matching added 2026-07-06 didn't yet cover
`sensor:blog-publishing` at all (only `arc-purpose-eval`/`arc-email-sync`
had bare entries). Added `sensor:blog-publishing` as a bare entry. (2)
`subject:review pr # on aibtcdev/agent-news` (5 recurrences, avg 2.0 steps,
aibtc-repo-maintenance + arc-skill-manager) — a per-repo variant of the
standard PR-review -> retrospective ad-hoc chain; added `"review pr #"` to
`KNOWN_SUBJECT_PREFIXES`. Both fixes in `skills/arc-workflow-review/sensor.ts`.

**2026-07-07 recurrence (task #21579) — actual root-cause fix, not another exemption**:
four flagged patterns. (1) `source:sensor:arc-reporting-watch` (10 recurrences,
avg 2.4 steps, arc-reporting + arc-skill-manager) — same ad-hoc `Watch report
-> retrospective` shape; added as a bare `KNOWN_PATTERNS` entry. (2)
`subject:email watch report to whoabuddy` (11 recurrences, avg 2.0 steps,
arc-email-sync + arc-skill-manager) — source is `workflow:<id>:emailing`
(unique per instance, never dedups via `bySource`), same shape as the
`fix arc0btc.com health issue`/`self-review` cases from 2026-07-05; added to
`KNOWN_SUBJECT_PREFIXES`. (3)+(4) `subject:review and finalize draft` (5
recurrences) and `subject:generate research blog post draft` (3 recurrences)
— **both already bare-exempted** via `sensor:blog-publishing` (added
2026-07-07 in the prior recurrence) but still surfaced, because the `bySubject`
loop in `detectPatterns()` never called `isKnownPattern(src)` — it only
skipped a subject group if that *exact* source string had already produced a
pattern *this run* (`patterns.some(p => p.key === source:${src})`), which
doesn't consult the historical exemption list at all. This is the structural
gap flagged-but-not-fixed in the 2026-07-06 entry above ("normalizeSource...
leaves exactly-3-part sources untouched") wearing a different hat: prefix
matching existed and worked fine for `bySource`, but `bySubject` had its own,
separate, incomplete gate. Fixed by adding `if (isKnownPattern(src)) continue;`
to the `bySubject` loop (`skills/arc-workflow-review/sensor.ts`) — this closes
the whole class, not just these two subjects. Any future subject-grouped
pattern whose root source is already in `KNOWN_PATTERNS` is now caught
automatically instead of needing its own hand-added `KNOWN_SUBJECT_PREFIXES`
entry. Lesson: when a detector has two independent grouping passes (by source,
by subject), an exemption list needs to be consulted by both — check the code
path, not just "does this string appear in the exemption list somewhere."

**2026-07-14 recurrence (task #22590)**: one flagged pattern, `subject:research`
(8 recurrences, avg 2.3 steps, arc-link-research + arc-skill-manager +
candidate-maturation) — root subjects are `Research: ecosystem signal —
matured candidate (...)`, spawned by `candidate-maturation`'s per-candidate
research filing (see [[arc-link-research-cost-driver]] for the volume context
on this sensor), each followed by the standard ad-hoc
`Retrospective: extract learnings from task #N` chain. Same shape, added
`"research"` as a bare `KNOWN_SUBJECT_PREFIXES` entry in
`skills/arc-workflow-review/sensor.ts`. No new evaluation needed — 9th
consecutive recurrence of the identical already-rejected pattern.
