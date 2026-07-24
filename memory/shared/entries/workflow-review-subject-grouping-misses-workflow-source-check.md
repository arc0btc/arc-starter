---
id: workflow-review-subject-grouping-misses-workflow-source-check
topics: [arc-workflows, arc-workflow-review, state-machine, false-positive]
source: task-22799
created: 2026-07-15
---

`arc-workflow-review`'s pattern detector (`skills/arc-workflow-review/sensor.ts`) has two
grouping passes: `bySource` and `bySubject`. `bySource` already skips patterns whose source
matches `isKnownPattern()` (a `KNOWN_PATTERNS` set). `bySubject` had no equivalent check for
workflow-emitted sources — it flagged "assess course candidacy" as an unmodeled recurring
pattern (#22794) even though it's already `ContentCalendarMachine`'s terminal
`course_candidate` state (`skills/arc-workflows/state-machine.ts:874-909`).

**Root cause:** workflow state machines emit sources like
`content-calendar:<slug>:course` or `publish-fanout:<slug>:whop-forum` — the slug varies per
work-piece, so `normalizeSource()` never collapses these into a single repeated key, and they
never hit `MIN_RECURRENCES` under `bySource`. But the *subject text* of the task each hop
creates is identical across work-pieces ("assess course candidacy" every time), so `bySubject`
grouping collapses them into one group and flags it as novel — the "child" tasks it counted as
evidence of an unmodeled chain step were just the standard per-task retrospective, not a real
gap.

**Fix:** added `isWorkflowEmittedSource()` checking a `WORKFLOW_SOURCE_PREFIXES` list
(`content-calendar:`, `publish-fanout:`, `pr-review:`, `quest:`, `retrospective:` — extracted
by grepping `source:` template literals in `state-machine.ts`) and skip a `bySubject` group
when every chain's root source matches one of these prefixes.

**Rule of thumb:** any detector that groups by *subject text* independently of *source* needs
its own "is this already modeled" check — inheriting the source-based check from a sibling
grouping pass isn't enough, because the two passes can disagree on whether a set of tasks
looks novel. Grep `source:` template literals in the producer code (state-machine.ts,
workflow templates) to build the prefix list, don't guess.
