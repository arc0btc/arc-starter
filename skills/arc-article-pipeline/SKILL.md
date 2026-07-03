---
name: arc-article-pipeline
description: Select a crown-jewel research finding, draft a long-form arc0.me article + an X-thread amplification variant, and stage both for operator quality-gate + fire
updated: 2026-07-03
tags:
  - publishing
  - content
  - distribution
  - x
---

# Arc Article Pipeline

Restores the operator-amplified long-form channel (P2 of `arc-demand-flywheel`): Arc drafts a
long-form arc0.me piece from a crown-jewel research finding, plus an X-thread/X-Article variant
written in **Jason's (@whoabuddy) amplification voice** — quoting/crediting Arc, never
undisclosed fronting. Both stage for the operator to quality-gate and fire manually; this skill
never publishes and never posts.

## The 3-step contract (mirrors `arc-daily-read`'s P1 design)

1. **`materials`** (deterministic) — selects the next unused relevance-4/5 finding from
   `research/INDEX.md` (crown jewels first, rotation-window dedup against
   `article_queue_log` so topics never repeat), extracts its measured hook + a real
   `file:line` citation. Writes `db/article-materials/article-<N>.json`.
2. **The dispatch-cycle LLM turn** (already SOUL.md-gated as system context) drafts
   `{ blogTitle, blogBody, xThread: [...] }` to `article-<N>.draft.json`. **Two voice
   registers**: `blogBody` is Arc's own voice; `xThread` is Jason's amplification voice.
   Neither includes a CTA or URL — those are assembled deterministically by `stage`, closing
   the exact "hand-typed link overflows/truncates" bug class P1 found in the daily read.
3. **`stage --article <N>`** (deterministic) — validates the draft (citation present
   verbatim, word count in range, tweet lengths, no hand-authored arc0.me/whop.com URLs,
   finding not in the recent rotation window), claims the `article_queue_log` row (linearized,
   retry-safe), creates the blog draft via the real `blog-publishing create` CLI (stays
   `draft: true` — never synced to the live deployed site), appends a deterministic
   `?a=wb-amp`-tagged closing CTA, deploys an **isolated preview** (see below), and writes the
   X-thread variant (with a deterministic final CTA tweet) to
   `skills/arc-article-pipeline/drafts/article-<N>-x-thread.md`.

## CLI

```
bun skills/arc-article-pipeline/cli.ts materials [--article N] [--slug <slug>]
bun skills/arc-article-pipeline/cli.ts stage --article <N> [--dry-run]
bun skills/arc-article-pipeline/cli.ts status
```

`--slug` forces a specific finding (bypasses rotation) — useful for demos/testing; default
behavior rotates automatically, crown jewels first.

## Preview isolation (hard constraint: never flip production)

`blog-publishing create` writes to `github/arc0btc/arc0me-site/content/...` — safe, since that
directory is never read by the Astro build (only `publish`, never called by this pipeline,
syncs a post into `src/content/docs/blog/`, the only directory the deployed site serves).

For a real, curl-able preview URL, `stage` rsyncs the live `arc0me-site` **once** into a
non-git scratch copy at `db/article-pipeline-preview/site/`, drops the draft's `.mdx` into that
copy's `src/content/docs/blog/`, builds, and deploys with `npx wrangler deploy --env staging`
(the `workers_dev` env already defined in `wrangler.jsonc` — a workers.dev subdomain, not
`arc0.me`). **`--env production` never appears anywhere in this skill.** Because the scratch
copy has no `.git`, and the live `arc0me-site` repo's tracked files are never touched, the
`blog-deploy` skill's auto-deploy sensor (which watches the LIVE repo's git HEAD SHA) cannot be
triggered by this pipeline.

## Firing (manual, always — never automated by this skill)

- **Blog:** `arc skills run --name blog-publishing -- publish --id <postId>`, then commit +
  push `arc0me-site` through whatever the normal mechanism is — this lets `blog-deploy`'s
  sensor redeploy production with the new post live.
- **X:** copy `drafts/article-<N>-x-thread.md` and post it from the **@whoabuddy** account
  (Arc has no credentials for Jason's personal account — this is by design, matches "operator
  quality-gate + fire").

## Sensor

Cadence: every 48h (the phase's "every-other-day or faster" floor). Queues ONE dispatch task
with the 3-step instruction sequence above. Kill-switch (`outbound_enabled`) and dedup
(`pendingTaskExistsForSource`) checked. **Never auto-fires** — stops at "staged."

## Schema

`article_queue_log` (additive, `db/arc.sqlite`): `article_n` (PK), `finding_slug`, `post_id`,
`status` (`staging` -> `staged`), `hook`, `file_line`, `x_variant_path`, `preview_url`,
`created_at`, `staged_at`.

## When to Load

Load when the sensor's dispatch task fires, or when manually running the materials/stage
commands. Pair with `arc-daily-read` (the other findings-first channel) and `blog-publishing`
(the underlying blog CLI this skill shells out to).
