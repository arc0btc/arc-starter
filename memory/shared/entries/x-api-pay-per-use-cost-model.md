---
id: x-api-pay-per-use-cost-model
topics: [x-api, pricing, budget, cost-model, pay-per-use]
source: task #21459 (2026-07-06, whoabuddy reframe)
created: 2026-07-06
---

# X API is pay-per-use metered credits, not a free-tier read cap

**The 100 reads/day ceiling was set from a budget-restraint conversation, not measured cost.**
The code comments claiming "500k reads/month free" (`skills/social-x-posting/lib/x-api.ts:24,86`,
`CADENCE.md:92`) are **stale and wrong** — X killed tiered pricing on 2026-02-06 and made
pay-per-use the default; Free tier is discontinued and was never 500k reads.

## Real 2026 pricing
- Post **read** = $0.005; **owned** reads (own posts, followers, lists) = $0.001 (since 2026-04-20).
- Post **write** = $0.015; **$0.20 if it contains a LINK**.
- 429 = rate-limit; **402 = balance/credits exhausted** (prepaid metered signal).
- Legacy Basic ($200/mo flat, existing subs only) = ~15k reads/mo + ~50k writes/mo, non-incremental below cap.

## Which billing Arc is on = the pivotal unknown (not derivable from code)
`cli.ts:497` handles **402 CreditsDepleted** + a 30-day depletion flag. A flat Basic sub returns
429 at cap, **not 402** → strong evidence Arc is on **pay-per-use metered credits**. Confirm via
X developer portal → Billing. Under pay-per-use: **effectively every call costs money.**

## Cost reality (pay-per-use)
- Reads ~80/day ≈ **$0.38/day** — mentions poll (72/day) is ~90% of read spend.
- **Link-posts ($0.20 each) are the largest single line item** — one link-post = 40 reads.
  Currently UNBUDGETED (post budget is a dollar-blind count of 10/day).
- The AI-057/058 follower-reserve machinery (`FOLLOWER_RESERVE_SLOTS`) rations ~$0.006/day of
  owned reads — complexity not worth the spend under a dollar lens.

## Lesson
When a self-imposed limit cites an external ceiling, verify the ceiling against the vendor's
*current* pricing page before optimizing within it. We spent two fixes (AI-057/058) tuning a
read-count reserve while the actual dominant cost (link-posts) sat unbudgeted, and the ceiling
itself rested on a discontinued pricing tier. Reframe read-count ceilings as **dollar budgets**
once a vendor moves to metered/pay-per-use. See [[x-read-budget-mentions-crowdout]].

**Status:** report + recommendation sent to whoabuddy (email 2026-07-06); no limits changed —
awaiting billing-plan confirmation + branch sign-off.
