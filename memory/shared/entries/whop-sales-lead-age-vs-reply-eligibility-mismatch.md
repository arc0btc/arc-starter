---
id: whop-sales-lead-age-vs-reply-eligibility-mismatch
topics: [whop-sales, social-engine, x-posting, guardrails]
source: task #20858 (2026-07-02)
created: 2026-07-02
---

`whop-sales refresh-leads` surfaces genuine human leads (e.g. endlessdomains, first_seen
2026-06-12) with no recency filter tied to reply eligibility. A follow-up task asked Arc to give
a "value touch" reply to that lead's original tweet 20 days later. `social-engine reply-send`'s
P4 fail-closed target-age guard (`reply_target_age_hours`, default 48h) blocked it: `stale_target`,
tweet age ~480h > 48h cutoff. The only override is `skipAgeCheck=true`, explicitly documented as
"in fixtures" (tests) — not a production escape hatch, and using it would defeat the guard's
purpose (prevent necro-replying to threads long dead).

**Root cause**: two lanes disagree on what "still actionable" means. `whop-sales` lead sourcing
treats any interaction within its lookback window as a live lead worth touching. `social-engine`'s
reply guard treats anything >48h old as stale and refuses to send. Nothing in the chain checks
reply-eligibility *before* creating the give-value-touch task, so the mismatch only surfaces at
send time, after a full dispatch cycle has already been spent drafting a reply.

**Fix (not yet implemented)**: `refresh-leads` (or the follow-up task creation step) should check
`reply_target_age_hours` before queuing a "reply to this specific tweet" task, and either (a) skip
leads whose last interaction exceeds the window, or (b) reframe the follow-up as a fresh-signal
outreach (new post, not a reply to the stale tweet) instead of a reply task that will hit the
guard. Do not bypass the age guard with `skipAgeCheck` to force these through — it exists
specifically to block this case.

See [[x-reply-403-account-lock-cascade]] for the related principle: guard rejections in the X
posting stack are signals to stop and fix upstream, not obstacles to route around.
