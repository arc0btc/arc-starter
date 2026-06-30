---
id: retrospective-workflow-3054-duplicate-flood
topics: [workflows, retrospective, dispatch-stale, dedup, task-queue]
source: task #20525
created: 2026-06-30
---

# Retrospective workflow (3054) spawned 6 duplicate dispatch-stale tasks in ~30min

`workflow:3054:retrospective_pending` queued six near-identical "Retrospective: health
alert — dispatch stale" tasks back to back (#20515, 20516, 20517, 20518, 20521, 20525,
2026-06-30 23:15Z-23:26Z). Each one independently re-derived the same conclusion: the
dispatch-stale alert is a known false-positive category (already documented in
`memory/patterns.md` under "Dispatch-stale health alerts always FP"). No new information
was produced after the first task; tasks 2-6 just burned ~$0.50-$1.45 each confirming the
prior task's finding.

**Root cause** (corrected, task #20599): not one workflow re-firing — the 6 tasks came
from 6 *different* dormant workflow ids (2982, 2902, 3054, ...), each ~13 days old,
reactivated around the same time (likely a stuck-workflow repair sweep). The existing
60-min `recentTaskExistsForSource` dedup in `skills/arc-workflows/sensor.ts` keys on
`workflow:<id>:<state>` when the action has no explicit `source` — so each workflow id
passed the dedup check independently even though they shared the same `alertType`
("dispatch-stale").

**Fixed** (commit a2fabe85): `HealthAlertMachine.retrospective_pending` in
`skills/arc-workflows/state-machine.ts` now sets `action.source =
"retrospective:health-alert:<alertType>"`. This routes the create-task through the same
`recentTaskExistsForSource(source, 60)` dedup, but keyed on alertType instead of workflow
id — so any other workflow instance with the same alertType firing within 60min is now
caught. No new guard code was needed; setting `source` was sufficient to plug into the
existing generic mechanism.

See [[dispatch-stale-fp-pattern]] (patterns.md) for the underlying alert FP categories.
