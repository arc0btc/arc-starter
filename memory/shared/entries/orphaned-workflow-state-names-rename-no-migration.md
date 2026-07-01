---
id: orphaned-workflow-state-names-rename-no-migration
topics: [arc-workflows, state-machine, dispatch, bugfix]
source: task #20659, #20669
created: 2026-07-01
---

# Renaming a state machine's state names without migrating existing rows orphans them

## The bug shape

`NewReleaseMachine` was renamed at some point (states → `detected/assessing/integration_pending/
integrating/no_action/completed/retired`) but 20 live `workflows` rows still carried the pre-rename
names (`assess/integrate/integrated/needs_integration/no_action_needed`). `evaluateWorkflow()`
does `template.states[workflow.current_state]` — a state name not in the template returns `{type:
"noop"}` unconditionally, with no error or log. These 20 rows were permanently stuck: the 5min
`arc-workflows` sensor would evaluate them forever and always noop, silently, with no signal that
anything was wrong. Found via a full state-name audit (task #20659), not via any error surface.

## The fix

`arc skills run --name arc-workflows -- transition <id> <newState>` (the `transition` CLI
subcommand, `skills/arc-workflows/cli.ts:195`) writes `current_state` directly via
`updateWorkflowState()` — it does **not** call `isTransitionAllowed()`/`getAllowedTransitions()`
against the template, so it works as a one-time data migration tool even when the *current*
state isn't a valid template key. Mapped each legacy name to its current equivalent (assess→
assessing, integrate→integrating, integrated→completed, needs_integration→integration_pending,
no_action_needed→no_action) and transitioned all 20 rows individually via CLI (no raw SQL). Also
confirms `updateWorkflowState()` always clears `completed_at` on any transition (`src/db.ts:~1519`)
— so migrated rows re-enter `getActiveWorkflows()` (`WHERE completed_at IS NULL`) and get
re-evaluated on the next sensor cycle. 4 of the 20 landed in `integration_pending`, which has a
live `create-task` action gated only on `ctx.repo`/`ctx.version` (both present) — migrating them
immediately resumed real integration work that had been silently stalled since the rename.

## Takeaway

Any time a `StateMachine.states` key is renamed, grep `list-by-template <name>` (or scan
`current_state` values) for live rows using the old name **before** shipping the rename — nothing
in `evaluateWorkflow` warns you if you don't. If old rows are found post-hoc, the CLI `transition`
command is safe to use as a migration tool even from a state the current template doesn't
recognize, since it bypasses `isTransitionAllowed`. Related but distinct from
[[action-null-noop-stuck-state]] (that's a fan-out-wait noop; this is an orphaned-key noop —
same symptom, different root cause).
