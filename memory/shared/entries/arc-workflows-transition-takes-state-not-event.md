---
id: arc-workflows-transition-takes-state-not-event
topics: [arc-workflows, cli-gotcha, state-machine]
source: task:24126
created: 2026-07-27
---

`arc skills run --name arc-workflows -- transition <id> <new_state>` takes the **target
state name** as its second arg, not the machine's event/transition name. State machine
defs in `skills/arc-workflows/state-machine.ts` list transitions as `on: { <event>: <state> }`
(e.g. `triggered: { on: { acknowledge: "acknowledging" } }`) — the doc string embedded in
task descriptions sometimes echoes the event name ("Transition this workflow to
'acknowledging'"), but if you instead pass the event name (`acknowledge`) as the CLI arg,
it silently sets `current_state` to that literal string instead of resolving it through
the `on` map. No validation error — `show` will report the bogus state as current_state.

**Why:** health-alert workflow task #24126 instructed "transition to 'acknowledging'" but
the state machine's `on` key for that edge is `acknowledge`; passed `acknowledge` as the
CLI arg by pattern-matching the key name, landing the workflow in an invalid `acknowledge`
state instead of `acknowledging`.

**How to apply:** before running `transition`, check the target STATE name in the machine's
`states: {}` block (the object key), not the `on: {}` event key, even if they look similar
enough to conflate. When in doubt, run `allowed-transitions <id>` first, or `show <id>` after
transitioning to confirm `current_state` matches an actual state in the machine definition.
