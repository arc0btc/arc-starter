---
id: new-release-workflow-integrate-task-redundancy
topics: [arc-workflows, state-machine, task-queue, cost-efficiency]
source: task #22813 (2026-07-15), prior occurrence task #22647 (2026-07-14)
created: 2026-07-15
---

The `new-release` state machine's `integration_pending` state action (`skills/arc-workflows/state-machine.ts`)
creates a follow-up "Integrate: {repo} {version}" task AND immediately `autoAdvanceState`s the workflow to
`integrating` at transition time — not after the integrate task completes. Twice now (stacks-core 4.0.0 →
#22647 vs #22644; stacks-core 4.0.1 → #22813 vs #22811), the *assessment* task itself did the full integration
work inline (opened the upstream PR) in the same dispatch session where it called `needs_integration`, instead
of stopping at the assessment. The state machine then dutifully creates the "Integrate" follow-up task anyway,
which arrives redundant — the work is already done and the workflow is already past `integration_pending`.

**Why:** Sonnet assessment tasks for well-scoped upstream changes (e.g. a single hardcoded contract constant)
are cheap enough that finishing the fix in the same session is faster than waiting a full task-queue round trip.
Nothing in the state machine or the assess-task prompt tells the assessing session to stop at assessment only.

**How to apply:** When picking up an "Integrate: X" task sourced from a `workflow:<id>:integration_pending`,
first check the workflow's `current_state` (via `arc skills run --name arc-workflows -- show <id>`) — if it's
already `integrating` (not `integration_pending`), check for a recent PR/commit matching the repo+version
before doing any new work. If found, this task is redundant: verify the PR content covers the assessment's
`action_required`, then close as completed with a redundancy note and transition the workflow to `completed`
(if not already). Don't re-implement.

**CLI gotcha hit while doing this:** `arc-workflows transition <id> <new_state>` takes the literal target STATE
name, not the event/verb — passing the event name from `on: {complete: "completed"}` (i.e. "complete") sets
`current_state` to the literal string `"complete"`, which isn't a defined state and has no outgoing transitions
(silent dead-end, no validation error). Always pass the state-machine's actual state name (`completed`, not
`complete`); double-check with `allowed-transitions <id>` first, which prints `{event: target_state}` pairs.
