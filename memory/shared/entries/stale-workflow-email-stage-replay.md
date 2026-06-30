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
- **FIXED 2026-06-30 (task #20577, `state-machine.ts` + `arc-workflows/sensor.ts`):**
  `PublishFanoutMachine` previously had NO time anchor (fired on workflow state, relied only on
  `--source` dedup). Added `created_at` to context, set once by `syncBlogPublishes()` at
  workflow-creation time; a new `fanoutStale()` helper (7d grace, same as `cadenceGateOpen`)
  short-circuits all three hops (`blog_published`/`x_pending`/`whop_forum`) straight to
  `completed` once the workflow is older than the grace window. `EmailThreadMachine.reply_pending`
  had the identical gap (a stuck "Send reply" task on a re-activated workflow would resend a
  stale draft) — added `replyDraftedAt` (set by the dispatched triage task alongside
  `replyDraft`) and a 48h staleness check before creating the send task. Both fail open on a
  missing/invalid timestamp, consistent with the rule below.

**Rule:** any repair that re-activates dormant workflows must assume their side-effecting
stages (email/post/fanout) will replay. Add a staleness/idempotency guard at the side-effect
boundary BEFORE running the un-stick repair, not after the inbox fills. The durable pattern:
guard on a creation/period timestamp that is set ONCE at instance creation, suppress when it is
parseable-and-stale, and fail OPEN on a missing timestamp so fresh work is never blocked.

**Non-email, non-fanout instance (2026-06-30, workflow #1687, task #20486):**
`ComplianceReviewMachine` instance `compliance-review:2026-04-17` sat in `scan_complete` since
2026-04-17 (predates the `compliance-review-{YYYY-MM-DD}` dash-format convention the docstring
describes — old colon-format key), then got replayed 2026-06-30 and spawned a review task
carrying only aggregate counts (`findingCount: 3, skillCount: 111`) from April — no itemized
findings, so the count couldn't be re-verified against the current skill tree without risking
fixes against code that has since changed. No side effect (no email/post), so harm is low, but
the same root cause applies: stale `context` treated as current. Resolved by transitioning the
workflow through to `retrospective_pending` with an honest staleness note instead of fabricating
fix tasks; confirmed the real `sensor:compliance-review:*` pipeline ran normally throughout
(unaffected — separate from this orphaned workflow row) and no other compliance-review workflows
were stuck in an active state. `ComplianceReviewMachine` has no staleness guard yet — lower
priority than `PublishFanoutMachine`/`EmailThreadMachine` since it has no side effect, but the
same `created_at`-based grace-window pattern would apply if this recurs.

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
