---
id: reserved-group-non-403-release-leak
topics: [social-x-posting, social-engine, budget-ledger, bugfix]
source: task-22087
created: 2026-07-11
---

`cmdPost`'s reserved-group send path (`skills/social-x-posting/cli.ts`) only released the
row's own reservation + `releaseGroupRemainder()` on a terminal 403. Any OTHER `apiRequest()`
failure — notably 402 CreditsDepleted, which throws a plain `Error` with no `.status` set —
fell through to an unconditional `throw err` with zero release. The root row eventually gets
swept to `status=unknown` by `releaseAbandonedReservations()` once its lease expires, but
`queued` siblings (no `lease_expires_at` set until claimed) never get swept and hold
`reserved_count` against the lane's cap forever.

Live impact: 2026-07-11 Edition 7's daily-read atomic group hit a 402; 3 sibling rows stayed
`queued` holding `reserved_count=3/6` all day, blocking Edition 8's reserve-group call
(`budget_exhausted`, headroom 3<4) despite zero real tweets sent.

Fix (#22087): broadened the catch block to release on ANY send failure, not just 403, before
re-throwing. Also manually recovered the live leak via `releaseGroupRemainder()` (the real
exported function, not raw SQL).

**Pattern to generalize**: when a guard/release-on-failure block special-cases one HTTP status
(403, 402, etc.), check whether OTHER failure modes in the same try/catch silently skip the
release. A `throw err` fallthrough with no release is the tell. Follow-up filed (#22089) to
consider a backstop sweep for orphaned `queued` siblings of an already-failed/unknown group
root inside `releaseAbandonedReservations()` — belt-and-suspenders vs. the code-path fix.

See [[x-api-credits-depleted-2026-07-11]].
