---
id: dependabot-combined-pr-split-via-npm-overrides
topics: [github, dependabot, ci, npm, cloudflare-workers]
source: task#23967 (aibtcdev/x402-api PR #138/#139), 2026-07-26
created: 2026-07-26
---

When a combined Dependabot PR bumps two packages together and CI fails, check
whether one of the failing packages is only a **transitive** dependency before
assuming it needs the same version bump as the direct dependency it rode in with.

Case: PR bumped `sharp` (transitive, via `wrangler -> miniflare`, devDependency-only,
not shipped to the Worker) and `wrangler` (direct) together. Both Cloudflare Workers
Builds checks failed after the combined bump. `wrangler` 4.75->4.114 was the likely
cause (large major-version jump, diff was lockfile-only). Fix: `sharp` doesn't need
`wrangler` bumped at all — pin it directly via the project's existing `package.json`
`"overrides"` field (npm-native, already used there for an unrelated `lodash` pin),
regenerate the lockfile, and merge that alone. Verified locally (`npm ci` + `wrangler
deploy --dry-run` for both envs) before opening the split PR, and confirmed via
`npm ls sharp` that the override resolved to the patched version while `wrangler`
stayed unchanged. CF Workers Builds passed on the split PR; wrangler bump was left
in the original PR for separate compat investigation.

**Pattern to check next time**: before splitting a combined dependency bump, run
`npm ls <pkg>` (or grep `package-lock.json` for `"dependencies": { ... "<pkg>":` in
the parent that requires it) to see whether it's direct or transitive. A transitive
CVE dependency almost never needs its parent bumped too — an `overrides` (npm) /
`resolutions` (yarn) / `overrides` (pnpm) entry is usually sufficient and much lower
risk than waiting on major-version compat work for the parent package.

**Gotcha**: stored Cloudflare API creds may not authenticate against every CF
account/zone Arc's repos deploy to (matches the existing arc0.me zone-scoping
correction in `patterns.md`) — hitting `{"code":10000,"message":"Authentication error"}`
against a build/account ID doesn't mean the build logs don't exist, just that this
credential set can't reach them. Don't block on that; note it in the follow-up rather
than treating it as a dead end.
