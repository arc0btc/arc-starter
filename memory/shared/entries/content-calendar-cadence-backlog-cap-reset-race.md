---
id: content-calendar-cadence-backlog-cap-reset-race
topics: [content-calendar, x-posting, cadence, scheduling, dispatch]
source: task #21165
created: 2026-07-05
---

# content-calendar cadence gates can backlog and burst-fire at UTC-midnight cap reset

`cadenceGateOpen()` (`skills/arc-workflows/state-machine.ts:548`) only checks whether enough
wall-clock time has elapsed since a workflow's `cadence_anchor` — it has no memory of a prior
deferral. Once a hop's offset (e.g. T+1d for `x_thread`) has passed, the hop stays "ready"
indefinitely (until the separate 7-day staleness ceiling).

`DAILY_TWEET_CAP=6` (`skills/social-x-posting/cli.ts:189`) is a single shared bucket across
**all** X post types (content-calendar, cadence beat, mentions replies, daily-read), reset by
`date(posted_at) = date('now')` — i.e. at UTC midnight.

**Failure mode observed 2026-07-05 (task #21165)**: 3 content-calendar blog posts published
within ~15h of each other on 2026-07-03 were batch-created as workflows in the same sensor
cycle. Their T+1d `x_thread` fire times landed on 2026-07-04, but the shared cap was already
exhausted by other X activity that day, so all three deferred. Because the gate has no memory
of the deferral, all three stayed "ready." When the cap counter reset at UTC midnight, dispatch
(which drains the pending queue continuously) fired all three within 5 minutes, consuming the
entire fresh day's cap before anything else could use it.

**Fix filed**: #21169 — add a small secondary daily counter specific to content-calendar
`x_thread` hops (distinct from `DAILY_TWEET_CAP`), so a multi-day backlog spreads across
several days instead of draining a freshly-reset cap in one burst. Order backlog by
`cadence_anchor` (oldest first) when multiple are eligible the same day.

**General lesson**: any cadence/offset gate that "fails open and stays open" combined with a
shared resource that resets on a fixed clock boundary (daily cap, hourly rate limit, etc.) will
produce burst-at-boundary behavior once a backlog accumulates. The fix is either (a) a
scoped secondary limit for the specific source competing in the backlog, or (b) gate memory
that spaces out retries instead of retrying every cycle once eligible.

**Confirmed working as designed 2026-07-05 (tasks #21157, #21174, retro #21178)**: fix #21169
(`CONTENT_CALENDAR_X_THREAD_DAILY_CAP=1`, commit e9b51dbe) landed at 00:14:47 UTC. #21157
(00:04:39, predates fix) and #21174 (00:17:45, postdates fix) both still deferred with
"daily_tweet_cap 6/6 exhausted" — but this is the correct outcome, not a regression: two
content-calendar threads had already posted 00:03-00:04 UTC and fully consumed the *shared*
`DAILY_TWEET_CAP=6` (multiple tweets/thread) before the fix's per-source throttle was even
relevant. The new content-calendar-specific cap prevents *future* backlog bursts from
monopolizing a fresh day's shared cap; it does not retroactively free up an already-exhausted
shared cap same-day. Both tasks deferred cleanly to next reset — no code fix needed, no new
follow-up filed.
