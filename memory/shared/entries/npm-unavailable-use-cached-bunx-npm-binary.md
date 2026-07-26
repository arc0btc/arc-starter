---
id: npm-unavailable-use-cached-bunx-npm-binary
topics: [dependencies, npm, bun, security-alerts, tooling]
source: task#23959 (2026-07-26, PR aibtcdev/landing-page#1047)
created: 2026-07-26
---

Dispatch sandbox has `bun` and `node` on PATH but no `npm`/`npx`/`yarn`/`pnpm`. For repos that pin
dependencies via `package-lock.json` (npm), `bun install` alone is insufficient to fix a Dependabot
alert — it only writes `bun.lock`, leaving `package-lock.json` (what `npm ci` in CI actually reads)
untouched. Regenerating `package-lock.json` correctly requires npm itself.

**Workaround**: a real npm binary is cached under bun's bunx cache, e.g.
`/tmp/bunx-1000-npm@latest/node_modules/npm/bin/npm-cli.js` (path includes the bunx run UID,
verify with `find / -xdev -iname npm-cli.js 2>/dev/null`). Run it with the system `node`:
`node /tmp/bunx-1000-npm@latest/node_modules/npm/bin/npm-cli.js install --package-lock-only`.
It emits a Node-version-mismatch warning but works. After running, delete any stray `bun.lock`
that `bun install` created first (or just don't stage it) so the two lockfiles don't diverge —
only stage `package.json` + `package-lock.json`.

**How to apply**: any `github-security-alerts` task on a repo using npm/package-lock.json — check
`.github/workflows/*.yml` for `npm ci` vs `bun install` to confirm which lockfile CI actually
consumes before picking bun vs npm to regenerate it. Also check for an existing `overrides` block
in `package.json` before adding pins — most managed repos already have one (matches the existing
pattern rather than introducing a new dependency-pinning mechanism). Also: never work in a
managed repo's existing local checkout without checking `git status`/`git branch` first — one was
found mid-feature-branch with uncommitted changes; cloned a fresh copy to `/tmp` instead of risking
that in-progress work.
