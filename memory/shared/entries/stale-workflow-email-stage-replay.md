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
it recurs whenever more stale workflows wake.

**FIXED 2026-06-30 (task #20575, `state-machine.ts`):**
- `CeoReviewMachine.emailing` now suppresses delivery — transitions straight to `completed` —
  when `ctx.reviewDate` is parseable and >48h old. `reviewDate` is set at workflow creation by
  the ceo-review sensor (`new Date().toISOString().slice(0,16)`), so an old date reliably marks
  a stale replay. Only a parseable-AND-stale date suppresses, so a missing date never blocks a
  fresh report.
- `cadenceGateOpen()` got a 7-day staleness ceiling: it now returns `false` (gate shut) once
  `now > anchor+offset + 7d`, closing the same replay hole for all 6 content-calendar fanout
  hops (whop/x/forum). Missing/invalid anchor still fails open by design.
- **Still exposed:** `PublishFanoutMachine` has NO time anchor (fires on workflow state, relies
  only on `--source` dedup) — a re-activated dormant instance would compose+post a fresh
  observation about a stale blog. Lower harm (freshly composed, not a body replay) → follow-up
  task #20577. Also flagged `EmailThreadMachine` reply stage for review there.

**Rule:** any repair that re-activates dormant workflows must assume their side-effecting
stages (email/post/fanout) will replay. Add a staleness/idempotency guard at the side-effect
boundary BEFORE running the un-stick repair, not after the inbox fills. The durable pattern:
guard on a creation/period timestamp that is set ONCE at instance creation, suppress when it is
parseable-and-stale, and fail OPEN on a missing timestamp so fresh work is never blocked.

**Non-email instance (2026-06-30, workflow #896, task #20571):** `self-review-cycle` workflow
`self-review-2026-04-02` was part of the same backfill wave, reaching the `triaging` stage with
an `issueSummary` quoting April cost/queue stats ($0.758/task, 69 pending) as if observed today.
Lower harm than the email case — triage data, not a sent message — but the failure mode is
identical: stale `context` read as current without a freshness check. Caught by cross-checking
`arc status` live output against the workflow's embedded numbers before acting; the mismatch
(April figures vs. June actuals) was the tell. No fix task was created — would have "fixed" a
phantom cost spike from three months ago. Confirms the rule generalizes beyond `emailing`/`post`
stages to any workflow stage that embeds point-in-time data in `context` and gets replayed by a
backfill.
