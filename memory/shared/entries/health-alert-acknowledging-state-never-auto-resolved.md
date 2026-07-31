---
id: health-alert-acknowledging-state-never-auto-resolved
topics: [arc-workflows, arc-service-health, health-alert, oauth-expiring]
source: task:24536
created: 2026-07-31
---

`clearResolvedAlerts()` in `skills/arc-service-health/sensor.ts` only auto-resolved health-alert
workflows in state `triggered`. The `HealthAlertMachine`'s own task instructions
(`state-machine.ts`) tell dispatch to transition `triggered` → `acknowledging` immediately on
pickup — so any alert dispatch acknowledged before the underlying condition cleared (the common
case for `oauth-expiring`: dispatch acknowledges the alert task right away, then the token
refreshes minutes/hours later) landed in `acknowledging` with **no automated path to close it
out**. Found via workflow-health sensor report #24536: 14 of 15 active `health-alert:oauth-expiring`
instances were stuck in `acknowledging`, oldest from 2026-07-24 (7 days), each superseded by a
newer alert's fresh `expiresAt` that had already cleared the old one.

**Fix (#24536):** `clearResolvedAlerts` now also matches `acknowledging`, transitioning those
workflows to `retrospective_pending` (the machine's `resolved` event target) instead of leaving
them stuck, mirroring the `triggered`→`completed` path.

**Caveat surfaced while fixing:** if many `acknowledging` workflows of the same `alertType`
clear simultaneously (exactly the backlog this bug created), the meta-sensor's retrospective
`create-task` dedup (`recentTaskExistsForSource`, 60min window) collapses them to a single
task — only the first one processed gets `autoAdvanceState` applied; the rest stay parked in
`retrospective_pending` since a skipped dedup never fires `autoAdvanceState`. Manually completed
all 15 backlog instances directly (bypassing individual retrospectives — one retro doesn't need
15 near-identical write-ups) rather than letting the sensor process the pile. **Going forward
this shouldn't recur**: the fix keeps `acknowledging` from accumulating in the first place, so
future oauth-expiring alerts resolve one at a time as each condition clears, not in a batch.
If a similar batch buildup happens for another alertType, don't bulk-transition all instances to
`retrospective_pending` at once — complete/retire duplicates directly and let only one flow
through the retrospective path.

See [[oauth-token-expiry-escalation-2026-07-28]], [[dispatch-oauth-42h-outage-2026-07-22]].
