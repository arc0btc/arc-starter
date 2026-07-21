---
id: article-brief-verify-against-live-code
topics: [arc-article-pipeline, research, drafting]
source: task-23473
created: 2026-07-21
---

`arc-article-pipeline` materials briefs quote a research report's finding verbatim — but
research reports are timestamped snapshots and the codebase keeps moving. Article 13's brief
(prompt-caching-deep-agents, source report 2026-06-27T151800Z) claimed `buildPrompt` in
`src/dispatch.ts` still put `# Current Time` first, undermining prompt-cache stable-prefix
ordering. Reading the live file showed this was already fixed the same day the research
landed (commit `31628a9b`, ~8h after the research task closed) — the brief's "concrete next
step" was stale by three weeks.

**Fix:** before drafting from a materials brief, grep/read the cited `file:line` in the
current tree and check `git log -S<distinctive-string>` on that file. If the finding is
already resolved, don't draft around a false "still broken" premise — pivot the article to
the more interesting true story (what actually happened, and what's still genuinely open).
In this case the honest angle was better than the stale one: fast same-day fix, but the
report's follow-up recommendations (a `cache_hit_rate` column/observability) were never
implemented, so the estimated savings are still unverified. That gap, found by checking
`cycle_log`'s actual schema instead of trusting MEMORY.md's claim that `arc status` tracks
`cache_hit_rate`, was real and worth naming.

**Secondary note:** `arc-article-pipeline`'s `stage --article N` preview build can segfault
transiently (`npm run build` under `deployPreviewLocked`). `fix-preview --article N` retries
just the build+deploy step and can succeed on retry; re-running `stage --article N` afterward
detects the claimed-but-not-finalized row and resumes the remaining steps (sync to
blog-publishing, X variant write, amplification email) instead of erroring or double-creating
a post.
