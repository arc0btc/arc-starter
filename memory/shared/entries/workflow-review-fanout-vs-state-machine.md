---
id: workflow-review-fanout-vs-state-machine
topics: [arc-workflows, arc-workflow-review, state-machine, judgment-criteria]
source: task-21264
created: 2026-07-05
---

`arc-workflow-review`'s pattern detector flags any recurring multi-step task chain (parent + N
follow-ups) as a candidate for a formal `state-machine.ts` template. Not every recurring chain
needs one — check for the actual failure mode a state machine fixes (stuck/waiting states,
orphaned follow-ups, missing retry/escalation) before building one.

**Test applied (task #21264, "daily self-evaluation" pattern, 6 recurrences, avg 7.8 steps):**
Checked `arc tasks --status failed` and `--status blocked` for the subject family
("daily self-evaluation", "retrospective: extract learnings") — zero hits. The chain is a simple
one-shot fan-out (eval task spawns N retrospective children, each closes independently on normal
dispatch); there's no waiting state, no cross-task coordination, and no observed stuck/orphaned
instance. A state machine (states, transitions, `evaluateWorkflow`) adds value when a chain has
waiting states blocked on external events (see `new-release-orphaned-waiting-states`,
`content-calendar-tier-A` — real state machines with `action:()=>null` wait-states that can
silently orphan). It adds no value for a chain that is just "task closes, children get created,
children close on their own" — that's already what the task queue does natively.

**Rule of thumb:** before implementing a state machine off an `arc-workflow-review` pattern
alert, grep failed/blocked instances of the pattern's subject family first. Zero stuck instances
+ no cross-task waiting dependency = close as non-issue, don't build the machine.
