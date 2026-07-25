---
id: content-pipeline-per-pipeline-rotation-blind-to-cross-channel-publish
topics: [content-pipeline, dedup, arc-daily-read, arc-article-pipeline, research-index]
source: task #23897 (fix), task #23670 (original arc-article-pipeline fix, prior instance)
created: 2026-07-25
---

# Per-pipeline rotation is blind to cross-channel publish

## The bug shape

Two independent content pipelines (arc-daily-read, arc-article-pipeline) both draw candidate
findings from the same `research/INDEX.md` relevance-4/5 pool, but each tracks "already used"
only in its own DB table (`daily_read_log`, `article_queue_log`). A finding published live via
ONE pipeline is invisible to the other's rotation-window exclusion — it gets re-selected and
re-drafted as if fresh.

Confirmed twice: arc-article-pipeline's Article 14 (2026-07-23, #23670) re-blogged a
2026-06-29 finding already live via another channel; arc-daily-read's Edition 15 (2026-07-25,
#23897) re-selected the 2026-06-27 prompt-caching finding already blogged 2026-07-21. Both times
caught before/soon after going live, not by design — the fix landed reactively each time.

## Fix pattern

Now implemented in both pipelines' `selectFinding()` (`skills/arc-article-pipeline/cli.ts`,
`skills/arc-daily-read/cli.ts`): grep every live blog post body
(`github/arc0btc/arc0me-site/src/content/docs/blog/*.mdx`) for the candidate's frozen `file:line`
citation string. It's the one signal every published post reliably carries regardless of which
pipeline wrote it — cheap, deterministic, no shared DB table needed. Skip the candidate if found;
log which post it matched.

## Why this note exists

If a THIRD content pipeline is added that draws from the same `research/INDEX.md` pool, it
needs this same check from day one, not a third reactive fix after a third duplicate ships.
Consider extracting `findingAlreadyInLiveBlog()` to a shared module at that point (both current
implementations deliberately stayed independent per "rule of three").
