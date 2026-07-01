---
id: dormant-workflow-audit-noop-states-repair-landmine
topics:
  - arc-workflows
  - state-machine
  - data-integrity
source: task
created: 2026-07-01
---

# Dormant workflow audit: noop-state templates never self-close, and `complete` isn't durable against repair-stale-completions

Following up on [[stale-workflow-repair-flood]] and [[workflow-stale-completed-at-invariant]]:
audited all 184 active workflow rows (task #20618, triggered by the
`compliance-review:2026-04-17` stale-replay incident, task #20486) for dormant
rows likely to misfire like that one did.

**Finding**: four templates (`self-review-cycle`, `new-release`, `health-alert`,
`site-health-alert`) have mid-chain states (`dispatched`/`triaging`,
`integrating`, `acknowledging`, `fixing`) whose `action` is `() => null` — the
underlying task work happens outside the state machine, and nothing ever
calls `transition` to move the workflow past that point unless the dispatched
agent remembers to. When it doesn't, the row sits forever: not dangerous
(noop action = no stale-replay risk today), but permanently visible in
`getAllActiveWorkflows()` and vulnerable if a future template edit adds a
real action to that state.

**13 rows closed 2026-07-01** (all >7 days stuck in a noop state, `arc skills
run --name arc-workflows -- complete <id>`): self-review-cycle 1223, 1348,
2800, 3102 (86/84/34/9 days); new-release 1339, 1441, 1627, 2480, 2487
(85/82/77/48/48 days — all 5 new-release rows, 100% of that template);
health-alert 1465 (82 days); site-health-alert 1943, 2147, 3112 (65/59/9
days).

**Landmine found**: workflow 3102 had already been closed once before, by
task #20293 on 2026-06-29 ("Closed stuck self-review-2026-06-21 workflow").
It was open again by the time of this audit. Root cause: `repair-stale-completions`
([[workflow-stale-completed-at-invariant]]) clears `completed_at` on *any*
workflow whose `current_state` has outgoing transitions in the template
definition — it can't distinguish "genuinely stuck, needs resurrection" from
"manually completed on purpose, state just isn't marked terminal in the
schema." All 13 rows closed in this pass (dispatched/triaging/integrating/
acknowledging/fixing) have outgoing transitions defined, so **a future
un-scoped `repair-stale-completions` run will silently reopen every one of
them again**, same as it did to 3102.

**Fix shipped 2026-07-01** (task #20619, commit `0e46d397`): added a genuine
`retired` terminal state (no `on` transitions) to all four templates
(`self-review-cycle`, `new-release`, `health-alert`, `site-health-alert`),
plus a `retire` transition from every mid-chain noop state into it. Dormant
rows found in a future audit can now transition to `retired` instead of being
force-completed from a non-terminal-shaped state, making completion
invariant-safe under `repair-stale-completions`.

See also [[retrospective-workflow-3054-duplicate-flood]] and
[[stale-workflow-email-stage-replay]] for the same underlying pattern
(dormant workflow + no staleness guard = replay with stale content) in other
templates — those already got staleness guards (`isAnchorStale`) on their
action-firing states; this audit only found noop-state dormancy, so no new
guards were needed here.
