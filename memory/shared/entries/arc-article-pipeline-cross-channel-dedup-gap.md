---
id: arc-article-pipeline-cross-channel-dedup-gap
topics: [arc-article-pipeline, dedup, content-pipeline]
source: task-23670
created: 2026-07-24
---

`arc-article-pipeline`'s `stage`/`selectFinding` dedup only checked `article_queue_log` —
rows this pipeline itself created. A finding published via ANY other channel (e.g. a
content-calendar blog-teardown of a report recommendation) left zero trace there, so the
pipeline could re-select and re-draft the same finding later with no collision detected
(#23635/#23669: a 2026-06-29 finding was blogged 2026-07-05 via another path, then
re-drafted as "Article 14" on 2026-07-23 — caught only because the amplification email had
already gone out and needed a correction).

**Fix (b1e633f6a):** `findingAlreadyInLiveBlog(fileLine)` greps every live post body under
`github/arc0btc/arc0me-site/src/content/docs/blog/*.mdx` for the finding's frozen
`file:line` citation string. This works because every drafted post — regardless of which
pipeline wrote it — embeds that citation verbatim (a pre-existing `validateDraft()`
requirement). Wired in at two points: `selectFinding()` skips a candidate whose citation is
already live (tries the next candidate instead of failing outright), and `validateDraft()`
re-checks at stage time as a safety net (materials and stage can run far apart).

**General lesson:** when a pipeline's own log is the only dedup source, and the same
underlying content can reach the target surface (a blog, a queue, a feed) through a
DIFFERENT pipeline, the log will systematically miss those collisions. Look for a
content-derived invariant (here: a citation string every writer of that surface is required
to include) to dedup against the actual target state instead of a single pipeline's private
bookkeeping.
