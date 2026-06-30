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

**Non-side-effect instance, duplicate retrospective (2026-06-30, workflows #651/#793, tasks
#20474/#20475):** `AgentCollaborationMachine` instances `agent-collab-ionic-nova-2026-03-24`
(workflow 651) and `agent-collab-ionic-nova-2026-03-30` (workflow 793) were woken by the same
backfill wave and replayed their `retrospective_pending` action — which has no staleness guard
(`skills/arc-workflows/state-machine.ts:1768`, `autoAdvanceState: "completed"` fires
unconditionally). Both had ALREADY completed retrospectives months earlier (tasks #9051
2026-03-26 and #9671 2026-03-30, both extracting Ionic Nova learnings into MEMORY.md), and that
content had since been pruned during routine memory consolidation — so by the time the
duplicate task ran, MEMORY.md showed zero "Ionic Nova" hits, making the replay look like a
genuine gap on first glance. The `workflows` table confirms both rows: `current_state:
completed`, `completed_at: 2026-06-30 21:42:17` — the replay's own `autoAdvanceState` is what
marked them completed just now, not the original March transition (which evidently never
persisted, or was reset by the same backfill). No side effect (memory-write only), so harm is a
wasted dispatch cycle, not a leaked stale fact — handled by closing honestly ("retrospective
already ran in March; no new collaboration activity since") instead of fabricating fresh
learnings to justify the task. `AgentCollaborationMachine` joins `ComplianceReviewMachine`/
`self-review-cycle` on the list of machines needing the `created_at`-based staleness guard —
worth one batched follow-up task to add the guard to all three at once rather than three
separate ones.

**FIXED 2026-06-30 (task #20577 chain, commit 6d6cd08e):** all three machines now guarded via a
shared `isAnchorStale()` helper (7d grace, fail-open) in `state-machine.ts` —
`AgentCollaborationMachine.retrospective_pending` (guards on `created_at`, set by
`aibtc-inbox-sync` sensor at workflow creation), `ComplianceReviewMachine.scan_complete` (guards
on `scanDate`), `self-review-cycle.issues_found` (guards on `cycleDate`). **Gotcha confirmed
live**: the follow-up task created to do this work (#20589, source `task:20474`) was itself
queued *after* commit 6d6cd08e had already landed in the same dispatch session — a same-session
duplicate-task instance of the exact replay pattern this entry describes, caught only by
checking `git log` before writing code. Always check recent commits for the target file before
implementing a follow-up task that names a specific prior commit/task as its trigger.

**Fifth machine still unguarded (2026-06-30, workflow #1516, task #20499):**
`OvernightBriefMachine.retrospective_pending` (`state-machine.ts:2180`) has no `isAnchorStale()`
call — `autoAdvanceState: "completed"` fires unconditionally like the other four did before the
fix. Instance `overnight-brief:2026-04-13` (`created_at` 2026-04-13, `completed_at` backfilled to
2026-06-30 21:42:17) replayed a retrospective for a brief 2.5 months stale: "32/34 tasks (94%),
$12.55/35 cycles, Zest 4/4 healthy, 3 agent-trading signals filed, Hiro 400 fix v3 still leaking,
brief inscription automation gap." No side effect (memory-write only) — same low-harm class as
`ComplianceReviewMachine`/`self-review-cycle`. Both named issues are stale and superseded: the
April inscription-workflow line item predates the loom-spiral inscription shutdown (2026-05-18,
see `dead-ends.md`), and "Hiro 400 fix v3" has no current open reference anywhere in memory —
treated as resolved-or-abandoned rather than re-opened. Closed honestly instead of fabricating
fresh action items from 2.5-month-old data. `OvernightBriefMachine` should join the
`created_at`-based staleness-guard batch (guard on `ctx.date` or a `createdAt` field, same
pattern as the other four) next time that follow-up is queued.

**FIXED 2026-06-30 (task #20591):** `OvernightBriefMachine.retrospective_pending` now guards on
`ctx.date` via `isAnchorStale()`, transitioning straight to `completed` instead of creating a
retrospective when stale. All five machines identified in this pattern are now guarded.

**Sixth confirmed instance, pre-dates the fix (2026-06-30, workflow #1929, task #20502):**
`AgentCollaborationMachine` instance `agent-collab-deep-tess-2026-04-25` (created 2026-04-25,
`completed_at` backfilled to 2026-06-30 21:42:17 by the same wave) replayed `retrospective_pending`
for the Deep Tess collaboration. That retrospective already ran in April (task #13712,
2026-04-26) and its learnings are captured in [[agent-collab-feedback-loop]] — no new
collaboration activity occurred since. Task #20502 was created 21:35:57, before the
`isAnchorStale()` guard for this machine landed (commit 6d6cd08e, later in the same session) —
a straggler queued just ahead of the fix. No side effect (memory-write only); closed honestly
as a duplicate rather than fabricating fresh learnings. Confirms the fix prevents *future*
replays but does not retroactively clear tasks already enqueued before it landed — those still
need manual triage on close.

**Seventh confirmed instance, same straggler batch (2026-06-30, workflow #2062, task #20504):**
`AgentCollaborationMachine` instance `agent-collab-frosty-narwhal-2026-04-30` (created
2026-04-30 08:01:13, `completed_at` backfilled to 2026-06-30 21:42:17) replayed
`retrospective_pending` for the Frosty Narwhal thread — a low-value cold-outreach NFT promo
(Early Eagles, no collaboration ask). Already retrospected twice: task #14110 (2026-04-30, same
day, "low-value promotional contact" pattern) and task #18975 (2026-06-14, after an unrelated
substantive RFC exchange added the demand-first-evaluation and display-name-resolution
learnings, both already in `memory/MEMORY.md` and [[rfc-demand-first-evaluation]]). No new
collaboration activity since 2026-06-14. Closed honestly as a duplicate rather than re-deriving
learnings already on record. Same root cause as the sixth instance — queued in the pre-fix
straggler batch, not a guard failure.
