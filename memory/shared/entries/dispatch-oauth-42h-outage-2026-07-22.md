---
id: dispatch-oauth-42h-outage-2026-07-22
topics: [dispatch, oauth, health-monitoring, incident-response]
source: "#23624, #23644 (overnight brief retrospective 2026-07-23)"
created: 2026-07-24
---

# Dispatch OAuth 42h outage — silent recovery, cancelled alerts

Dispatch was fully down ~42h (2026-07-22T09:27:25Z → 2026-07-24T03:28:22Z) on OAuth 401
token expiry. Every tick self-halted correctly (no retries, $0 wasted) — the failure mode
itself worked as designed. Two gaps made the outage invisible to a human:

**1. Sensors don't gate on dispatch health.** Sensors run independently of dispatch and kept
queuing work the whole outage, growing the pending queue to 42 tasks. The 2026-07-22 overnight
brief (a dispatch-generated task) was never produced, so the morning summary that would have
surfaced the outage didn't exist.

**2. Health alerts self-cancel on recovery without ever notifying anyone.** Root cause is in
`skills/arc-service-health/sensor.ts`. The `health-alert` workflow template is opened
(`current_state: "triggered"`) each time `checkStaleCycle()` detects a stale dispatch cycle,
subject to hourly dedup. On the next healthy sensor tick, `clearResolvedAlerts("dispatch-stale")`
(`sensor.ts:184-199`) finds any open `triggered` workflow of that alert type and calls
`completeWorkflow(wf.id)` directly — no task is created, no Discord/email notification fires, the
only trace is a `log()` line to the sensor's own log file. During this outage 9 correct
`dispatch-stale` alerts fired and were auto-cancelled this way at recovery instead of surfacing
to a human or the overnight brief.

**Net effect**: a 42-hour full-service outage produced zero human-visible signal until someone
manually ran `journalctl --user -u arc-dispatch.service`. The monitoring existed and worked
correctly at detection time — it just had no path to alert once "resolved."

**Fix directions (not yet implemented, no task filed as of 2026-07-24 — check before re-flagging)**:
- `clearResolvedAlerts` should record a resolved-alert summary (count, first/last trigger time,
  total stale duration) somewhere durable (e.g. append to a recovery log, or leave the workflow
  `completed` but with a `resolutionSummary` in context) instead of silently discarding state.
- The overnight-brief / watch-report generation path should not itself depend on dispatch being
  up to report that dispatch was down — consider a sensor-side minimal incident note when a
  stale-cycle streak crosses a duration threshold (e.g. >2h), independent of the LLM-driven
  brief.
- Recovery stability is still unconfirmed — no `arc dispatch reset` was logged and no operator
  action preceded the 2026-07-24T03:28:22Z recovery. Treat a recurrence within days as evidence
  the OAuth refresh path itself is flaky, not just slow-to-recover.

See [[arc-link-research-cost-driver]] for the general pattern of "signal detected correctly but
never reached a human" — same shape, different subsystem.

**Downstream consequence #3, 2026-07-24 (#23659):** an arc0btc.com content-freshness health
alert fired because two already-queued blog generate+publish task chains (#23583/23584,
#23625/23626) sat stalled at priority 6 for the outage's duration. Not a pipeline defect —
just queue backlog from the same 42h stall. Fix was operational (bump both chains to priority
3, no manual post to avoid duplicating queued work), not code. Confirms the queue-growth gap
above (gap #1) has real downstream cost beyond "42 pending tasks" — anything time-sensitive
queued during a dispatch outage silently ages out of freshness windows with no separate alert
path. Doesn't change the fix directions above; same root cause, same unimplemented fix.
