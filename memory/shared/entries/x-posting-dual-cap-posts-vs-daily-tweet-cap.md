---
name: x-posting-dual-cap-posts-vs-daily-tweet-cap
description: social-x-posting enforces TWO separate daily caps on tweet volume — BUDGET_LIMITS.posts=3 (root-only, shown in `budget` CLI output) and DAILY_TWEET_CAP=6 (all tweet types incl. thread continuations/CTAs) — SKILL.md still documents the old posts=10 limit
metadata:
  type: project
  topics: [social-x-posting, x-cadence, budget]
created: 2026-07-03
---

`skills/social-x-posting/cli.ts` (~line 185-199) has two independent daily tweet ceilings:

- `DAILY_TWEET_CAP = 6` — primary cap, covers ALL tweet types (root posts + thread
  continuations + CTA tweets). Set by P2 arc-funnel-hardening (2026-06-27).
- `BUDGET_LIMITS.posts = 3` — secondary, root-only guard. Deliberately lowered from 10→3 in the
  2026-06-15 GTM cadence dial-down so the account reads as lean/high-signal. Revert instructions
  in the code comment: restore `posts: 10` (or the `.bak-gtm` copy).

**Gotcha**: `arc skills run --name social-x-posting -- budget` only surfaces the `posts` field
(3/day), not `DAILY_TWEET_CAP` (6/day). A task description citing "6/6 blocked" and the `budget`
command showing "3/3, remaining 0" are both correct — they're two different counters. Either one
hitting zero blocks further `post`/`post --reply-to` calls for the day (resets midnight UTC).

**SKILL.md is stale**: `skills/social-x-posting/SKILL.md` still lists Posts daily limit as 10.
Trust the code (`BUDGET_LIMITS` in cli.ts), not the doc, when reasoning about why a post was
blocked. See [[x-cadence]] for the broader cadence-gating history this cap change was part of.

**[2026-07-04, task #21022] Confirmed: DAILY_TWEET_CAP is shared across ALL threads/sources
that day, not per-thread.** On 2026-07-04, a deferred continuation for one content-calendar
thread (thirty-five-hours-of-silence) hit "cap exhausted" again even though that specific thread
had only posted 2 tweets (root + reply-2). Root cause: a different thread
(audit-trail-is-the-point) posted its full 5-tweet run the same UTC day, and `x_post_log`'s
`COUNT(*) WHERE date(posted_at)=date('now')` counts across all sources. 2+5=7 > 6, cap tripped.
**Lesson**: when triaging a "cap exhausted" defer, don't assume it's about the named thread —
query `x_post_log` directly (`db/arc.sqlite`, table `x_post_log`, column `posted_at`) to see
which sources actually consumed the day's budget before deciding whether/when a retry will
succeed. `arc skills run --name social-x-posting -- budget` won't show this at all (only the
3/day root-only counter).
