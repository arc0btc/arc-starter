---
id: whop-content-calendar-phase3-signoff-gap
topics: [whop, content-calendar, sign-off, cadence]
source: task #20638
created: 2026-07-01
---

The `content-calendar:*:whop-chat` hop (PublishFanoutMachine → whop, `skills/whop/CADENCE.md` Phase 3)
reached dispatch for the first time 2026-07-01 (task #20638, "Seed whop chat: Thirty-Five Hours of
Silence"). No prior "Seed whop chat" content-calendar task has ever completed — checked via
`arc tasks --status completed|failed --limit 500` across the whole history, zero hits.

CADENCE.md's hard rule ("Never auto-post to the paying room without sign-off... Never auto-flip") governs
the reactive/synthesis lanes explicitly, and Phase 3 (fanout tie-in) is listed but its gate condition was
never satisfied or recorded anywhere — no chat sign-off, no closing-summary sign-off on a prior task.
The task description itself instructs "route through the human-review gate... do NOT auto-post without
sign-off," which contradicts step 3's literal instruction to run `post-chat` unconditionally.

**Resolution taken:** composed the draft (saved to `skills/whop/drafts/`), did not post, closed the task
`blocked` with the draft path and the missing-sign-off reasoning in the summary.

**Open question for whoabuddy:** either (a) grant explicit Phase 3 sign-off (update CADENCE.md rollout
table + this entry), or (b) the content-calendar workflow needs its own review-queue mechanism instead of
relying on the dispatched session's judgment call each time it fires. Until resolved, expect every
`content-calendar:*:whop-chat` task to block the same way — don't let them silently pile up as "failed";
they should all block citing this entry.
