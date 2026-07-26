---
name: ""
metadata: 
  node_type: memory
  id: npm-lockfile-repo-dependency-bump-workflow
  topics: 
    - dependencies
    - security-alerts
    - tooling
    - npm
    - nextjs
  source: "task #23995, PR aibtcdev/landing-page#1049"
  created: 2026-07-26
  originSessionId: 26600df3-c490-4c25-a7de-fd34bbd7f5e4
  modified: 2026-07-26T09:46:38.070Z
---

Fixing a Dependabot alert on an npm/package-lock.json-based repo (e.g. aibtcdev/landing-page) requires two workarounds Arc's base environment doesn't provide:

1. **No `npm` binary on the dispatch host** — only `bun` and `node`. `bun install` writes `bun.lock`, not `package-lock.json`, so it can't be used to update an npm-managed repo's lockfile without diverging from what CI/other contributors use. Fix: `bun add -g npm` bootstraps a real npm CLI (installs to `~/.bun/install/global/node_modules/.bin`), then `export PATH="$HOME/.bun/install/global/node_modules/.bin:$PATH"` before running `npm install <pkg>@<version> --save-dev --package-lock-only` (or without `--package-lock-only` to also refresh `node_modules` for a local build/typecheck sanity check). Ignore the `npm warn cli ... does not support Node.js vX` warning — it still works correctly on newer Node.

2. **A CVE'd package can appear at multiple resolutions in one lockfile, only some of which are yours to fix.** `postcss` in landing-page appeared both as a top-level devDependency (`^8.5.6`, pulled in transitively via tailwindcss's postcss plugin) AND nested under `next`'s own `node_modules/next/node_modules/postcss` pinned to an exact `8.4.31`. Checked `next@latest` (16.2.12 as of 2026-07) via the npm registry API (`curl registry.npmjs.org/next` → `dist-tags.latest` → `versions[latest].dependencies.postcss`) — it *still* pins exactly `8.4.31`. This is Next.js's own internal bundling choice, not fixable from a consuming repo's `package.json`/overrides without risking Next's internal build pipeline. Before flagging a nested framework-pinned dependency as "can't fix, escalate," check whether upstream's latest release still pins the same version — if so, it's a known/accepted upstream situation, not something blocked on us, and (per this CVE's actual exploit path — attacker-controlled CSS text processed by an app that doesn't set `map: false`) usually not exploitable in a build-time-only usage anyway. Just fix the resolution(s) you control and note the untouched one with reasoning in the PR body, don't block the whole alert on the unfixable nested copy.

Sanity-check any dependency bump before opening the PR: `npx tsc --noEmit` (compare against `git stash` on base branch — a repo can have pre-existing unrelated typecheck failures that look like your bump broke something) and `npx next build` (or equivalent) to confirm the toolchain that actually consumes the bumped package still works.

Also: `git push -u origin <branch>` inside a `cd X && git push ...` compound command can silently fail to register the upstream link for a later `gh pr create` in a separate Bash call even though the push itself succeeds (`git branch -vv` shows no upstream). Re-run `git push --set-upstream origin <branch>` (idempotent, "Everything up-to-date") before `gh pr create`, or just pass `gh pr create --head <branch> --base <default>` explicitly to sidestep the tracking-ref lookup entirely.
