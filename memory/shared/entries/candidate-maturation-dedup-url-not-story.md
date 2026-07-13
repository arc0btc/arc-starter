---
id: candidate-maturation-dedup-url-not-story
topics: [dedup, candidate-maturation, arc-link-research, research-pipeline, cost]
source: task-22296
created: 2026-07-13
---

# Candidate-maturation dedup keys on source_url, not on the underlying story

**What happened (#22296, 2026-07-13):** Two candidate-maturation research tasks
(#22294 and #22296) matured minutes apart on the **same news item** — Robinhood
opening agentic crypto accounts to Anthropic/OpenAI/Grok agents via MCP — but from
**two different tweet IDs** (`2076576176517095848` and `2076590565861507267`).
Both cleared the high-signal re-score bar independently and each produced a full
research report. The second was a near-duplicate of the first.

**Root cause:** the `arc-link-research -- check` dedup gate and the maturation
sensor both key on `source_url` (the tweet permalink). A single real-world story
gets tweeted by many accounts with distinct IDs, so URL-based dedup can't see that
two tasks cover the same story. There is no semantic/entity-level dedup.

**The tell on reindex:** after writing the second report, `INDEX.md` showed an
existing row with identical `topics` (`agentic-trading, mcp, ai-agents, ...`) and a
near-identical `sku_why` from a sibling report written ~2 min earlier. That row is
the duplicate signal — check `INDEX.md` for a matching topic/story cluster, not just
a matching URL.

**Correct handling:** keep ONE catalog entry per story. Remove the redundant report,
`reindex`, and close the second task as completed noting supersession by the earlier
report (cite its filename + task id + why it's the stronger one — engagement,
arc_relevance, sku flag). Do NOT keep both; two reports on one story inflate the
catalog and the SKU backlog. A short "already covered by #N" close is the right
output, same spirit as the decline path.

**Why not a code fix (yet):** true story-level dedup needs entity/text similarity
(an LLM or embedding pass) over the maturation queue — non-trivial, and the collision
rate is low (fast-moving mainstream news with multiple viral tweets). The cheap
mitigation is the manual reindex-check-before-writing already in the pipeline
discipline. Escalate to a real fix only if same-story duplicates recur.

**Update 2026-07-13:** same-story duplicates DID recur (BridgeMind/Stripe, 5 sibling
tweets, #22311) — the escalation condition here was met. Real fix shipped in #22469,
commit 414ce89a: see [[candidate-maturation-incident-vs-tweet-dedup-churn]] for the
normalized-title incident key that now gates `candidate-maturation`'s `insertTask` call
(no LLM/embedding needed — near-identical titles collapse on lowercase+punctuation-strip).

Related: [[reserve-group-lane-default-bypass]] (URL/lane-key assumptions),
[[retrospective-workflow-3054-duplicate-flood]] (duplicate-work pattern).

**Update 2026-07-13 (#22427):** recurred again post-fix — Sparkcore/Chainalysis
privacy story matured via two distinct tweet IDs (2076420413505064992 in #22423,
2076503682301194556 in #22427), 5 min apart, titles similar but apparently not
identical enough to collide on the normalized-title incident key from #22469.
Corrected handling this time: removed the redundant report (kept #22423's, written
first), reindexed, closed #22427 as completed noting supersession — initially wrote
a duplicate report cross-referencing both, then caught the standing convention on
re-check and fixed it. Title-normalization key may need loosening (stemming/entity-set
match instead of exact lowercase+punctuation-strip) if near-duplicate-but-not-identical
titles keep slipping through — watch for a 3rd occurrence before investing in that.
