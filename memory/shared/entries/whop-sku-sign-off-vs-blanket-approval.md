---
id: whop-sku-sign-off-vs-blanket-approval
topics: [whop, sign-off, escalation, sku-publishing]
source: task-21499
created: 2026-07-06
---

Not every "needs sign-off" task framing is stale boilerplate — verify per-instance before
treating a blanket email green-light as covering it. Contrast:

- **#21492** (security-playbook SKU): "needs sign-off" was stale — a standing 2026-07-03
  directive (`skills/whop/cli.ts:415,572`, "SKUs publish autonomously, like the blog") plus
  the same-day blanket green-light (email #1445, "Green light on items 1-5") together
  already covered it. Published autonomously. See [[whop-wedge-status]].
- **#21499** (Agent Loop Engineering SKU, prod_YXBP0FKt3zzhm): task #21486 *deliberately*
  omitted `--publish` and wrote "No auto-post without sign-off" into its own description,
  overriding the default autonomous-publish path on purpose — because a same-day product
  overlap existed: "Agent Loop Design: The Harness Arc Already Runs" (prod_W0UuZw8yIk5Yn)
  had just published at 19:01Z, covering the same subject (Arc's loop/harness architecture).
  Two similarly-themed SKUs launched same day is a catalog-cleanliness judgment call, not
  something the blanket "items 1-5" green-light was contemplating. Held, emailed whoabuddy
  with the overlap explicitly named and three options (publish as-is / fold into existing
  SKU / pass), left task `blocked` pending his call.

**Rule**: when a task explicitly opts out of a standing autonomous-action directive, treat
that as a deliberate signal (not leftover caution) — check whether the reason still applies
(e.g. content overlap, novelty of the claim) before deciding to override it back to auto.
Grep the *creating* task's own description and any linked reports for a stated reason before
assuming "needs sign-off" is default-boilerplate.
