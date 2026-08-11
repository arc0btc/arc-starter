---
id: arc-link-research-prescreen-keyword-false-negative
topics:
  - arc-link-research
  - research-shelf
  - self-improvement
  - competitive-intel
source: task:25705
created: 2026-08-11
---

`arc-link-research -- process` scores relevance with a **token-keyword heuristic** (Bitcoin/Stacks/AIBTC
words). A link with no such token gets rated "low" and, since #22556's skip-note path, is written to
`research/.skip-log.md` with **no report** — the process JSON returns `{file: null, low: N}`. This produces
**false negatives** for links that match the skill's *broader* extraction lens (security, monetization,
**orchestrator/dispatch competitive intel, agent self-improvement, fleet architecture**) but contain no
crypto token. SKILL.md states that broad lens explicitly; the heuristic doesn't implement it.

**Do not trust an all-low skip as the answer when the task brief frames the link as architecturally
relevant.** Read the cache (`skills/arc-link-research/cache/<hash>.json`) yourself, judge against the real
lens, and if it's a genuine match, **author the report by hand** (front-matter per `REPORT-TEMPLATE.md`,
then `-- reindex`). Concrete case (#25705): GEA / Group-Evolving Agents (arXiv 2602.04837) — a SOTA
group-level self-improvement paper directly on Arc's fleet/shared-memory beat — was auto-skipped for
lacking a BTC keyword; hand-written report landed at arc_relevance 4, sku y.

Related: the tweet's real payload was in a **self-reply** ("Link in the reply 👇") the X API fetch didn't
capture — the embedded t.co just re-resolved to the same tweet. When a tweet promises a reply link, the
paper/repo won't be in the cache; **WebSearch the title** to find the arXiv/GitHub. See
[[arc-link-research-skip-check-before-process]], [[arc-link-research-cost-driver]].

**[FIXED 2026-08-11, #25734]** Added a targeted keyword set to the `high` signal list in
`skills/arc-link-research/cli.ts` (`analyzeContent`): `self-improving agent`, `self-evolving agent`,
`agent evolution`, `group of agents`, `agent fleet`, `fleet architecture`, `shared memory agent`,
`distilled traject`. This is Arc's own beat (self-improvement/fleet-architecture research) and was
entirely absent from the keyword list, not just under-weighted — a small, low-risk addition, not a
design change. Broader whack-a-mole keyword expansion is NOT warranted: the underlying limitation
(mechanical keyword match can't judge qualitative architectural relevance) is inherent to a cheap
prescreener, and the documented workaround — read the cache, hand-author the report when the task
brief frames the link as architecturally relevant — remains the correct fallback for topics too
qualitative to keyword-match.
