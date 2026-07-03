---
name: arc-article-pipeline
description: Select a crown-jewel research finding, draft a long-form arc0.me article + an X Article amplification variant (title + body + companion post, emailed ready-to-paste to whoabuddy), hand the blog leg to the autonomous publish lane
updated: 2026-07-03
tags:
  - publishing
  - content
  - distribution
  - x
---

# Arc Article Pipeline

Restores the operator-amplified long-form channel (P2 of `arc-demand-flywheel`): Arc drafts a
long-form arc0.me piece from a crown-jewel research finding, plus a **long-form X Article
variant** (title + article body + suggested companion post — NOT a tweet thread; operator
correction 2026-07-03) written in **Jason's (@whoabuddy) amplification voice** — quoting/
crediting Arc, never undisclosed fronting. The blog leg hands off to Arc's own autonomous
`blog-publishing` lane; the X Article is emailed to whoabuddy ready to paste into X's article
composer. This skill never posts to X and never flips `draft: false` itself.

## The 3-step contract (mirrors `arc-daily-read`'s P1 design)

1. **`materials`** (deterministic) — selects the next unused relevance-4/5 finding from
   `research/INDEX.md` (crown jewels first, rotation-window dedup against
   `article_queue_log` so topics never repeat), extracts its measured hook + a real
   `file:line` citation. Writes `db/article-materials/article-<N>.json`.
2. **The dispatch-cycle LLM turn** (already SOUL.md-gated as system context) drafts
   `{ blogTitle, blogBody, xArticle: { title, body, companionPost } }` to
   `article-<N>.draft.json`. **Two voice registers**: `blogBody` is Arc's own voice;
   `xArticle` is Jason's amplification voice — a long-form **X Article** (title <=100 chars,
   body 400-1500 words of PLAIN paragraphs since X's article composer renders no markdown,
   measured hook + `file:line` proof in the first two paragraphs) plus a suggested short
   companion post (<=240 chars) for the article share. Nothing includes a CTA or URL — those
   are assembled deterministically by `stage`, closing the exact "hand-typed link
   overflows/truncates" bug class P1 found in the daily read.
3. **`stage --article <N>`** (deterministic) — validates the draft (citation present verbatim
   and up front, word counts in range, title/companion lengths, no markdown in the X Article
   body, no hand-authored arc0.me/whop.com URLs, finding not in the recent rotation window),
   claims the `article_queue_log` row (linearized, retry-safe), creates the blog draft via the
   real `blog-publishing create` CLI, appends deterministic `?a=wb-amp`-tagged closings to
   both variants, deploys an **isolated preview** (see below), syncs the blog leg to
   `blog-publishing`'s autonomous discovery path (`draft: true` preserved), writes the
   X Article variant to `skills/arc-article-pipeline/drafts/article-<N>-x-article.{md,json}`,
   and emails the ready-to-paste X Article draft to whoabuddy via Arc's existing
   amplification-email lane.

## CLI

```
bun skills/arc-article-pipeline/cli.ts materials [--article N] [--slug <slug>]
bun skills/arc-article-pipeline/cli.ts stage --article <N> [--dry-run]
bun skills/arc-article-pipeline/cli.ts status
bun skills/arc-article-pipeline/cli.ts fix-preview --article <N>
bun skills/arc-article-pipeline/cli.ts hand-off --article <N> [--supersede]
bun skills/arc-article-pipeline/cli.ts rework-x --article <N> [--supersede] [--dry-run]
```

`--slug` forces a specific finding (bypasses rotation) — useful for demos/testing; default
behavior rotates automatically, crown jewels first. `rework-x` regenerates an already-staged
article's X variant as an X Article from a session-drafted
`db/article-materials/article-<N>.xarticle.json` and re-sends the email; `--supersede` marks
the email subject as replacing an earlier (thread-format) send.

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

## Firing (who posts what)

- **Blog:** autonomous — `stage` syncs the final draft (`draft: true`) into
  `blog-publishing/sensor.ts`'s discovery path; Arc's own sensor queues review+publish on its
  normal hourly cadence, the same live-by-default path every other Arc blog post uses. No
  operator gate (P2 amendment, operator correction).
- **X:** the emailed **X Article draft** (title + body + companion post, links pre-tagged
  `?a=wb-amp`) is pasted into X's article composer and posted from the **@whoabuddy** account
  by Jason himself (Arc has no credentials for Jason's personal account — by design; the
  framing is "@whoabuddy amplifying Arc," quote/credit, never undisclosed fronting).

## Sensor

Cadence: every 48h (the phase's "every-other-day or faster" floor). Queues ONE dispatch task
with the 3-step instruction sequence above. Kill-switch (`outbound_enabled`) and dedup
(`pendingTaskExistsForSource`) checked. **Never posts to X** — the pipeline stops at "staged"
(blog leg on Arc's own publish-lane timeline, X leg delivered by email only).

## Schema

`article_queue_log` (additive, `db/arc.sqlite`): `article_n` (PK), `finding_slug`, `post_id`
(pinned the moment the blog draft exists, so a crash-resume reuses it instead of minting a
second date-stamped draft), `status` (`staging` -> `staged`), `hook`, `file_line`,
`x_variant_path`, `preview_url`, `created_at`, `staged_at`, `email_sent_at` (idempotency
marker: a crash-resume never re-sends the amplification email; only the explicit
`hand-off`/`rework-x` commands re-send, and they refresh it).

## File conventions (one article = up to four draft files)

| File | Written by | Role |
|---|---|---|
| `db/article-materials/article-<N>.json` | `materials` | Deterministic brief for the drafting LLM |
| `db/article-materials/article-<N>.draft.json` | LLM turn | Full draft `{ blogTitle, blogBody, xArticle }`, consumed by `stage` |
| `db/article-materials/article-<N>.xarticle.json` | session/LLM | X-variant-only raw draft `{ title, body, companionPost }`, consumed by `rework-x` |
| `drafts/article-<N>-x-article.{json,md}` | `stage`/`rework-x` | Staged X Article. The `.json` sidecar (raw `body` + assembled `finalBody`) is **canonical**; the `.md` is its human-readable rendering |

## When to Load

Load when the sensor's dispatch task fires, or when manually running the materials/stage
commands. Pair with `arc-daily-read` (the other findings-first channel) and `blog-publishing`
(the underlying blog CLI this skill shells out to).
