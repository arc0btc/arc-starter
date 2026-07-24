---
id: new-release-assess-task-narrates-transition-without-calling-it
topics: [arc-workflows, workflow-state-machine, new-release, dispatch-reliability]
source: task:23255
created: 2026-07-20
---

`NewReleaseMachine`'s `detected` state action creates an "Assess release: ..." task whose
description ends with "After assessment, transition workflow to 'integration_pending' (if
action required) or 'no_action' (if nothing to do)." The `assessing` state itself has
`action: () => null` — a pure no-op — so the workflow only advances if the dispatched session
actually runs `arc skills run --name arc-workflows -- transition <id> <state>`.

Found 3 stuck `assessing` instances (workflow ids 3382, 3380, 3333; stuck 4-7 days) via a
`workflow-review` health-check task (#23255). All 3 backing "Assess release" tasks (#22974,
#22949, #22235) had already **completed**, and each `result_summary` explicitly said
"transitioning to no_action" / "transitioned to no_action" — but none of them actually called
the `transition` CLI. The task's own narration was taken as evidence the state machine advanced;
it didn't.

**Fix applied**: manually ran `transition <id> no_action` for all 3 (no code change — this is a
one-off dispatch-discipline gap, not a state-machine bug like
[[arc-workflows-complete-vs-transition]] or [[action-null-noop-stuck-state]]).

**Pattern**: any workflow template whose state action is a no-op (`action: () => null`) is only
as reliable as the spawned task's actual CLI call — the task's prose result_summary is not proof
of a state change. The periodic `workflow-review` sensor (this task's source) is the backstop
that catches this drift; no further code fix filed since a single review cycle already surfaces
and self-heals it. If this recurs beyond isolated instances, consider making the meta-sensor
auto-verify: when an assess task closes with "no action"/"integration" language but the
workflow is still in `assessing` >24h later, auto-transition instead of just flagging in the
health report.
