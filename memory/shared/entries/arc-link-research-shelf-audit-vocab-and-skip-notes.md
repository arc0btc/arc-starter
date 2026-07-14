---
id: arc-link-research-shelf-audit-vocab-and-skip-notes
topics:
  - arc-link-research
  - topic-vocab
  - research-shelf
  - front-matter
source: task:22552
created: 2026-07-14
---

Shelf-wide audit of `research/` front-matter (triggered by #22545's reindex backfill) found two
distinct, unrelated issues bundled under "125 malformed + 134 out-of-vocab":

1. **111 reports with no topics + arc_relevance 0-1.** 103 of these came from one bulk batch on
   2026-06-14/15/16; only ~8 have trickled in since across a month. Root cause: `process` always
   writes a full report regardless of the mechanical relevance rating — a "low" (arc_relevance=1)
   link gets the same multi-section report as a "high" one, just emptier. Decision: don't
   retroactively rewrite the 103 legacy reports (low value, high effort) — accept as noise. Filed
   #22556 to add a skip-note path (one line: source_url + reason) for future arc_relevance<=1
   links, since full reports for near-zero-relevance links also feed the arc-link-research cost
   driver (see [[arc-link-research-cost-driver]]).

2. **134 reports with out-of-vocab topics.** `TOPIC_VOCAB` in `skills/arc-link-research/cli.ts`
   was set once at build time and never expanded as the skill's actual beat coverage grew (MCP,
   Claude/Anthropic ecosystem watch, loop-engineering research, bitcoin governance/privacy,
   agent-safety, model-routing). Checked topic frequency across all warnings: the top ~30 topics
   recur >=3 times each (real beats); the rest is a long tail of near-duplicate spellings
   ("claude code" vs "claude-code" vs "claude") and true one-offs. Expanded TOPIC_VOCAB with the
   frequent ones using a canonical hyphenated spelling — dropped total out-of-vocab topic
   *instances* from 638 to 433 (32%), though report *count* barely moved (132 vs 134) because most
   flagged reports mix one now-canonical topic with one still-unique long-tail one. Left the long
   tail out-of-vocab on purpose — the warning is non-blocking, and chasing every one-off spelling
   isn't worth the vocab bloat. Filed #22555 for a small, separate, bounded issue found in the
   same audit: 9 reports with `sku_candidate=y` but `repos_touched=unknown`.

**Pattern:** when a controlled vocabulary or schema constraint is defined once at skill-build time
but content generation (LLM-authored front-matter) isn't constrained to it, drift is inevitable and
grows with volume — check word frequency across violations before deciding "expand the vocab" vs
"fix the data": a Zipfian tail means partial vocab expansion (top-N by frequency) captures most of
the *signal* reduction even though violation *count* stays flat.
