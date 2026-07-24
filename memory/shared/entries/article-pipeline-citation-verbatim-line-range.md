---
id: article-pipeline-citation-verbatim-line-range
topics: [arc-article-pipeline, validation, drafting]
source: task #22093
created: 2026-07-11
---

`arc-article-pipeline`'s `stage` command validates that the finding's `fileLine` citation
(e.g. `memory/shared/entries/foo.md:14-20`) appears **verbatim, including the line range**,
in both `blogBody` and `xArticle.body` — not just the file path. Dropping the `:14-20` suffix
(citing just the path) fails validation with "does not contain the required citation ... verbatim".
When drafting, copy `finding.fileLine` from the brief JSON exactly, don't paraphrase or truncate it.
