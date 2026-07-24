---
id: whop-wedge-status
topics: [whop, sales, m0, leads]
source: task-20403
created: 2026-06-15
---

P22 SHIPPED 2026-06-15. $9 SKU LIVE 2026-06-28: "The Loop, graded" — prod_iRxuQeieW4RCm. Zero
memberships ever on this SKU (verified 2026-07-02). Real company-wide membership count is 4
(Ahmed on the FREE product, Miles test account, 2 admin seats); Ahmed already got 3
touches/0 replies, doctrine says stop.

**2026-07-02**: `refresh-leads` found 12 candidates, only 1 genuine (endlessdomains) —
blocked by give-3x-before-ask gate (fresh leads never pitch-ready on discovery, see
[[whop-sales-give-3x-blocks-fresh-leads]]) AND by reply-send's 48h target-age guard (stale
tweet, see [[whop-sales-lead-age-vs-reply-eligibility-mismatch]]).

**Real blocker is top-of-funnel value-giving, not lead volume**: M0 still unreached.

**Next**: fix `refresh-leads` to filter candidates past the reply-age window before creating
tasks.

**Creds**: `whop` — `company_api_key`+`app_api_key`+`company_id biz_zQbfh5SnRnAF5Y`. API:
POST `/api/v1/messages` (v1 NOT v5), channel `exp_I2Wew0PqJQ50a8`. NEVER auto-post without
sign-off (except the whop-chat Phase 3 blanket pre-approval, see
[[whop-content-calendar-phase3-signoff-gap]]).

2 SKUs drafted 2026-06-30 (task #20403, awaiting sign-off) in `skills/whop/drafts/`
(gitignored).

**2026-07-16**: Room dark 8 days running (0 messages in 24h at last check, #22901) — synthesis
lane correctly deferring per the monologue/inflow-outflow gate rather than forcing a post into
silence. Not a bug; flagging because 8 days is the longest dark streak observed so far and M0
outreach is still stalled on the same top-of-funnel blocker above.
