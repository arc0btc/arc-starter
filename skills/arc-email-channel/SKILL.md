---
name: arc-email-channel
description: Findings/arXiv digest renderer for Arc's free-tier email channel (P6 arc-demand-flywheel) — CLI only, no sensor.
updated: 2026-07-04
tags:
  - reporting
  - email
  - research
---

# arc-email-channel

Renders a free-tier research digest email from LIVE content only, and sends it to a small,
hand-picked seed list to prove the pipeline end-to-end. This is deliberately CLI-only — no
sensor, no automatic cadence. Standing this up as a recurring lane (real cadence, real subscriber
fan-out) is a P8 decision, not this phase's.

## What it pulls

1. **Crown-jewel findings** — `research/*.md` front-matter (`arc_relevance >= 4`), parsed via the
   same `skills/arc-link-research/lib/frontmatter.ts` parser `research/INDEX.md` uses. Each
   finding's real file:line citation (the corpus's "tested against a live agent" proof) is pulled
   directly from the report body via regex.
2. **arXiv digest, embargo-gated** — `research/arxiv/*_arxiv_digest.md`, filtered by the SAME
   10-day embargo policy P4 established for this content (`embargo_date = digest_date + 10d`,
   included only if `now >= embargo_date`). **As of 2026-07-04, every existing digest is still
   inside its embargo — the arXiv section renders empty with a computed "unlocks on <date>"
   teaser. This is correct, not a bug.** Do not modify `ARXIV_EMBARGO_DAYS` or bypass the filter
   to force content in before it's actually free.
3. **Live daily-read / article-pipeline content** (optional bonus) — any already-fired
   `daily_read_log` rows or already-staged `article_queue_log` rows. Degrades to empty gracefully
   (as of this phase, no live-fired rows exist yet in production — expected, not an error).

## CLI

```
bun skills/arc-email-channel/cli.ts render-digest
bun skills/arc-email-channel/cli.ts send-test [--live] [--to <email>]
```

`send-test` without `--live` prints what would be sent (dry-run default, matching the discipline
P1/P2 established after their own disclosed test-send incidents). `--to` overrides the default
recipient (`email/report_recipient` credential — normally whoabuddy@gmail.com).

## Hard constraint

This script calls `arc-email-worker`'s `POST /api/send-digest` with an explicit 1-element
`recipients` array — it NEVER queries the subscriber table and fans out to it. Sending a real
digest to actual confirmed subscribers beyond the seed list is a hard-gated, not-yet-taken step
(see `CHECKPOINTS.md`'s P6 entries) — this skill exists to prove the render + send pipeline works,
not to run it at scale.

## Composes with

- `arc-email-worker`'s `/api/subscribe` + `/api/send-digest` (P6, same phase) — subscriber rows
  now exist via the capture form on arc0.me; this skill is the content side of the same channel.
- `skills/arc-daily-read` and `skills/arc-article-pipeline` — this skill reads their DB tables
  opportunistically but does not depend on them having fired yet.
