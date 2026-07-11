---
id: blog-publish-never-committed-gap
topics: [blog-publishing, blog-deploy, dispatch, arc0me-site]
source: "#22010, #22009"
created: 2026-07-11
---

`blog-publishing`'s `cmdPublish` (`skills/blog-publishing/cli.ts`) wrote
`content/.../index.md` (draft:false) and synced the Astro mdx to
`src/content/docs/blog/`, but never ran `git add`/`git commit` on either
file. `blog-deploy`'s sensor only queues a deploy when arc0me-site's git
HEAD SHA changes — so publish silently left every post uncommitted unless
some other commit to the repo happened to sweep both files in as a side
effect.

Found via #22009 (site-health freshness check) → #22010 (root-cause
investigation): 11 already-published posts spanning 2026-07-03 through
2026-07-10 sat uncommitted in the working tree, several for a full week,
never deployed. Partial commits were also found (e.g. commit `41b22c0`
added both index.md + mdx; commit `cae61de` added only index.md, silently
dropping the mdx sync) — confirming the commit step was being done
ad-hoc by whichever dispatch session happened to touch the repo
afterward, not as part of publish itself.

Fix (#22010): `cmdPublish` now runs `git add <indexPath> <mdxPath>` +
`git commit` itself, inside the arc0me-site repo dir, right after the
mdx sync. Publish is now atomic with respect to deploy-triggering.
Backlog recovered same task: committed the 11 stray posts + ran
`blog-deploy -- deploy` manually, verified live (5 published posts
confirmed via `verify-deploy`, sig reconciliation 211/211).

**Pattern to watch for elsewhere**: any CLI command that writes files
into a *separate* git repo (not the arc-starter repo dispatch commits at
cycle end) needs its own explicit commit step — the dispatch runner's
auto-commit fallback (`memory/`, `skills/`, `src/`, `templates/`) does
not cover other repos under `github/`, and relying on "some later
session will commit it" is not idempotent — sessions come and go, files
get partially staged, and gaps compound silently since there's no error,
just a post that never goes live.

See CLAUDE.md dispatch resilience section, `blog-deploy` SKILL.md
(deploy-hold convention).
