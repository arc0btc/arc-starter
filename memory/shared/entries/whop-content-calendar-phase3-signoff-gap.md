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

**RESOLVED 2026-07-03:** whoabuddy chose option (a) — blanket pre-approval for the whole post class, not
per-post sign-off. Recorded in `skills/whop/CADENCE.md` under a new "Sign-off log" section (entry dated
2026-07-03), and the hard rule now carries an explicit exception for post classes with a standing
blanket pre-approval. Task #20820 (the escalation) closed `completed`. Tasks #20638 and #20706 were
requeued to `pending` with the resolution + posting instructions appended to their descriptions — the
next dispatch cycle should verify idempotency (per the existing whop-chat guardrails) and post normally,
not re-block. #20889 ("the-audit-trail-is-the-point") hit the same gate before this resolution landed and
was left `failed`; it is a distinct blog seed post, not a duplicate of #20638/#20706, but wasn't
resurrected — a fresh content-calendar cycle will regenerate that beat if still relevant. Going forward,
`content-calendar:*:whop-chat` tasks should proceed straight to posting without blocking on sign-off.
