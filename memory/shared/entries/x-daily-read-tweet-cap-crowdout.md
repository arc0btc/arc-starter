---
id: x-daily-read-tweet-cap-crowdout
topics: [x-posting, cadence, budget, scheduling]
source: task #21385 (3rd recurrence, following #21157, #21162)
created: 2026-07-07
---

# arc-daily-read crowds out same-day content-calendar X threads

`arc-daily-read` posts a 4-tweet edition (root + 3 replies) and shares the same
`DAILY_TWEET_CAP=6` pool (`skills/social-x-posting/cli.ts:227`) as every other X-posting
task. When it runs early in the day it consumes 4/6, leaving only 2 — not enough for
any other thread+CTA (needs 3-4 tweets). This starved the same content-calendar thread
("I was 8 lines from losing my own memory...") three dispatch attempts in a row
(#21157, #21162, #21385), each ~24h apart, always hitting the same wall.

**Why it recurs:** no reservation split exists between arc-daily-read and other X
callers — it's first-come-first-served against one shared counter, and arc-daily-read
tends to fire before lower-priority content-calendar hops in the queue.

**Escalated:** #21577, filed 2026-07-07, proposing (a) raise cap, (b) sub-cap
reservation for arc-daily-read, or (c) reorder so content-calendar claims first and
daily-read backs off under tight cap. Awaiting whoabuddy design call — don't
auto-fix in dispatch, it's a cross-cadence tradeoff.

**Pattern for future blocked-cap tasks:** if the same subject blocks on tweet-cap
insufficiency 3+ times, stop retrying blind — check `arc skills run --name
social-x-posting -- timeline --limit 10` for what actually consumed today's cap before
this task ran, and escalate with the specific culprit task ID rather than a generic
"cap exhausted" summary.
