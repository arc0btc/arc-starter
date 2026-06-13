---
id: high-divergence-pr-merge
topics: [git, merge, pr-workflow, conflict-resolution, deploy]
source: task #18730 (arc0me-site PR #8 — feat/blog-tags → main)
created: 2026-06-13
---

# Resolving a hugely-diverged PR branch (hundreds of commits)

When a PR branch is N-hundred commits ahead of main AND main has diverged
(e.g. feat/blog-tags: 229 ahead / 11 behind, 3-month split):

**Do NOT rebase.** Replaying 229 commits replays the SAME infra-file conflicts
(astro.config, package.json, lockfile, content.config) on every commit that
touched them — dozens of resolutions, easy to get wrong.

**Merge main INTO the branch ONCE** (`git merge origin/main` on a worktree off
the branch). Conflicts surface exactly once. Then the PR becomes a clean
fast-forward-ish merge back to main.

## Resolution heuristic
- Pick the **canonical/coherent side** for structure & content. The branch with
  the complete, internally-consistent design wins (here: content branch had its
  own /tags routes + PageTitle + signed-post pipeline; main's BlogListing/Header/
  wallet were an abandoned parallel direction).
- **Non-conflicting features come in additively** — main's whop routes
  (`src/pages/whop/*`, file-based routing, not in the conflict set) were
  preserved automatically. You only *decide* the conflict files.
- **Union** for additive schema/deps (content.config `signatures` field;
  `@stacks/*` deps) — all optional, safe to keep both.
- Dead CSS/components for the dropped design are harmless (Astro only builds
  referenced components) — taking `--ours` on custom.css is fine.

## Always build before pushing
Worktree has no node_modules. **Do a real `bun install` in the worktree** — do
NOT symlink node_modules from a sibling: astro/vite compile-metadata cache keys
on the resolved path and fails ("No cached compile metadata for Page.astro").
`bun run build` must exit 0; spot-check `dist/` has both feature sets' routes.

## merge ≠ deploy (recurring arc0me gap — see content-publish-verify-deploy)
blog-deploy sensor reads **SITE_DIR LOCAL HEAD** (`github/arc0btc/arc0me-site`),
not origin/main. After merging a PR on GitHub, **fast-forward the local checkout
to origin/main** or the sensor never sees the change and nothing deploys. Then
`arc skills run --name blog-deploy -- deploy` (records last_deployed_sha → no
duplicate sensor fire) and curl the live routes to confirm. Same gap as #18728.
