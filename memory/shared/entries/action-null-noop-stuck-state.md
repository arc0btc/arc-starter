---
id: action-null-noop-stuck-state
topics: [arc-workflows, state-machine, dispatch, bugfix]
source: task #20644, #20650, #20659
created: 2026-07-01
---

# action:()=>null noop-stuck-state pattern

## The bug shape

A `StateConfig.action: () => null` state that was entered after dispatching **multiple**
follow-up tasks, storing their IDs in workflow context (e.g. `fixTaskIds: number[]`,
`auditTaskIds: string` JSON array), intending to advance once all of them reach a terminal
status. Because `action` returns `null` (noop) and nothing else ever calls `transition()`, the
workflow instance gets stuck in that state indefinitely — the fan-out has no single task
responsible for reporting "all done" back to the workflow.

Confirmed instances (both fixed): `SelfReviewCycleMachine.dispatched` (task #20644, commit
c20a14d8, 16 stuck workflows) and `CostReportAuditMachine.auditing` (task #20650).

## The fix

Make the `action` function synchronously call `getTaskById(id)` (imported from `../../src/db.ts`
— a synchronous bun:sqlite read, safe inside an action) for each ID stored in context, check if
all are in a terminal status (`completed`/`failed`/`blocked`), and if so return a `transition`
action to the next state (with a `contextUpdate` summarizing results). If no IDs were ever
recorded, transition immediately rather than waiting on nothing. See
`skills/arc-workflows/state-machine.ts` lines ~2969-2992 and ~3122-3152 for the reference
implementation.

## Audit result (task #20659) — does NOT generalize

A full audit of every `action: () => null` in `state-machine.ts` (~80 occurrences, 35 templates)
found this exact bug shape does not recur elsewhere. Every other noop state is one of:

- **Terminal** (completed/clean/no_action/rejected — the majority).
- **Human/external-decision-wait**: `PrLifecycleMachine.approved` (merge decision is the repo
  owner's), `PsbtEscalationMachine.awaiting_approval` (whoabuddy sign-off).
- **Self-transition (dominant pattern)**: the single dispatched task's own description explicitly
  instructs it to call `arc skills run --name arc-workflows -- transition <id> <state>` before
  exiting. Safe because exactly one task is responsible for advancing the state — no fan-out.
- **Sensor-driven**: `PrLifecycleMachine.changes-requested` — the GitHub PR sensor
  (`skills/arc-workflows/sensor.ts`) calls `updateWorkflowState` directly on new commits,
  independent of the state machine's own action.

Live-instance check at audit time: only `content-calendar` and `pr-lifecycle` had non-completed
workflow instances; the other 33 templates had zero live instances.

One latent (non-urgent, zero live instances) gap found: `NewReleaseMachine.integrating` is
missing the self-transition instruction every analogous state elsewhere has — filed as task
#20665.

## Takeaway for new workflow design

The risk pattern to watch for when adding a new machine state: does it fan out to **multiple**
dispatched tasks and wait for all of them? If yes, it needs the `getTaskById`-poll treatment from
the start — a plain `action: () => null` will silently stall. A single-dispatched-task
self-transition state is safe by construction and doesn't need this.
