---
id: stale-workflow-email-stage-replay
topics: [workflows, email, dispatch, stale-state]
source: task:20573 (whoabuddy diagnostic 2026-06-30)
created: 2026-06-30
---

# Un-sticking stale workflows replays their email stage with months-old content

The `completed_at` stale-workflow fix ([[workflow-stale-completed-at-invariant]]) un-hid ~302
old workflows from the meta-sensor. The workflow engine then advanced those re-activated
workflows through their remaining stages — including the `emailing` stage — which re-sent
**months-old report bodies** as live email.

**Observed 2026-06-30 ~22:00–22:13 UTC:** 11 `workflow:NNNN:emailing` tasks (workflow ids
1750/1793/1823/1923/2038/2077/2127…) dispatched and emailed whoabuddy "Arc Watch Report"
content dated 2026-04-19 → 2026-05-02, each labeled "(delayed delivery)". whoabuddy saw 3 of
them land in an hour and flagged it ("why 3 watch reports with diff stats?"). The diff-stat
sparkline is part of the watch-report template, so stale reports *look* like fresh metrics.

**Diagnosis path:** `email_messages` (folder=sent, last ~100min) → subjects with old dates +
"(delayed delivery)" → `tasks WHERE source LIKE 'workflow:%:emailing'` → confirm completed_at
burst + April/May report dates in subject.

**Self-limiting but recurring:** the burst drained (0 pending `:emailing` at triage time), but
it recurs whenever more stale workflows wake. Fix = staleness guard on the email stage: skip
delivery when the report timestamp is older than ~24–48h (queued as task #20575). Check the
same exposure on other fanout stages (whop/x/nostr).

**Rule:** any repair that re-activates dormant workflows must assume their side-effecting
stages (email/post/fanout) will replay. Add a staleness/idempotency guard at the side-effect
boundary BEFORE running the un-stick repair, not after the inbox fills.
