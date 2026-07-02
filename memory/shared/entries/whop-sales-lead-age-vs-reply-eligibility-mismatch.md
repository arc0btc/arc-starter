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

**Fix IMPLEMENTED 2026-07-02 (task #20860)**: `skills/whop-sales/sensor.ts` now carries
`reply_target_at` + `reply_target_stale` on every `Candidate` (X only — the forum reply path has
no such guard), computed via `isReplyTargetStale()` which reads `agent_config.reply_target_age_hours`
(fallback 48h, mirroring `reply-send.ts`'s own default so the two never drift silently out of sync
— they are two separate reads of the same config key, not a shared import, so a future change to
one *can* still drift from the other; keep them aligned by hand). `buildPitchTask()` branches on
`reply_target_stale` for X leads: instead of emitting a `social-engine -- reply` command against a
target guaranteed to be rejected, it reframes the follow-up as a fresh standalone post mentioning
the lead by handle (`social-x-posting -- post`, no reply-to). `cli.ts refresh-leads` preview also
surfaces `reply_target_at`/`reply_target_stale` per candidate so a human/dispatch session reviewing
the raw candidate list sees the same signal before manually queuing a reply-to-tweet follow-up.

**Known residual gap**: `arc_replies_to_them` (the give-3x counter) undercounts at least one prior
Arc reply to endlessdomains (2026-06-19, tweet #2067800019034603746) — it predates the 2026-06-20
unified reply lane (`social-engine/reply-send.ts`) that started writing `x_reply_log` rows, so no
current code path can retroactively recover it (no backfill CLI exists, and raw SQL writes are off
limits per dispatch convention). This is a one-time historical undercount, not an ongoing bug —
every reply sent through the unified lane going forward is logged and credited correctly via
`processXReplyLog()`.

See [[x-reply-403-account-lock-cascade]] for the related principle: guard rejections in the X
posting stack are signals to stop and fix upstream, not obstacles to route around. See also
[[whop-sales-give-3x-blocks-fresh-leads]] — a related, separate finding on the same lead-source path.
