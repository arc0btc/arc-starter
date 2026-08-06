---
id: arc-workflows-transition-takes-state-not-event
topics: [arc-workflows, cli-gotcha, state-machine]
source: task:24126, task:25237, task:25238
created: 2026-07-27
updated: 2026-08-06
---

**[FIXED 2026-08-06, #25238]** `arc skills run --name arc-workflows -- transition <id>
<new_state>` used to write the raw `new_state` arg straight into `current_state` with zero
validation. `skills/arc-workflows/cli.ts`'s `transition()` now looks up the workflow's
template state machine and either (a) accepts `new_state` if it's a real key in
`template.states{}`, (b) auto-resolves `new_state` if it's a valid event name from the
current state's `on{}` map (e.g. passing `acknowledge` from a state whose `on` has
`acknowledge: "acknowledging"` now correctly lands on `acknowledging`), or (c) rejects
with the list of valid states and allowed events from the current state. No more silent
dead-end states.

**Original bug (kept for context):** State machine defs in
`skills/arc-workflows/state-machine.ts` list transitions as `on: { <event>: <state> }`
(e.g. `triggered: { on: { acknowledge: "acknowledging" } }`). Task descriptions sometimes
echoed the event name ("Transition this workflow to 'acknowledging'"), and passing the
event name (`acknowledge`) as the CLI arg used to silently set `current_state` to that
literal string instead of resolving it through the `on` map — no validation error, `show`
would report the bogus state as current_state. Two known incidents: #24126 (health-alert
workflow, `acknowledge` vs `acknowledging`) and #25237 (workflow 3640, `resolved` vs the
real target state).

**How to apply now:** the CLI itself guards this — a bad `transition` call fails loudly
with valid options instead of corrupting state. Still worth running `allowed-transitions
<id>` first when unsure, since the error message reuses the same lookup.
