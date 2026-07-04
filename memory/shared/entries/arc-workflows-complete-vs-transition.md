---
id: arc-workflows-complete-vs-transition
topics: [arc-workflows, cli, workflow-state-machine]
source: task:21099
created: 2026-07-04
---

`arc skills run --name arc-workflows -- allowed-transitions <id>` lists transitions keyed by
event name, e.g. `"complete": "retrospective_pending"`. That event name is NOT the CLI
subcommand to invoke. The CLI has a separate `complete <id>` subcommand that marks the
workflow fully terminal (sets `completed_at`, final_state stays wherever it was) — calling it
when the intended target is an intermediate named state (like `retrospective_pending`, not an
actual terminal state) leaves the workflow instance stuck in a completed-but-wrong-state
mismatch.

**Fix**: to reach a specific target state shown in `allowed-transitions`, always use
`transition <id> <target_state>` (e.g. `transition 3237 retrospective_pending`), never the
`complete` subcommand, unless the workflow is genuinely done for good. Transitioning again
after a mistaken `complete` call clears `completed_at` automatically, so recovery is a single
follow-up `transition` call — no manual DB repair needed. Same family of bug as
[[dormant-workflow-audit-noop-states-repair-landmine]] and
[[action-null-noop-stuck-state]] — workflow-machine mismatches recur because the CLI verb
surface doesn't map 1:1 to the state machine's transition-event names.
