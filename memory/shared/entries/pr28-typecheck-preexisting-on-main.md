---
id: pr28-typecheck-preexisting-on-main
topics: [ci, typecheck, github-external-dependency, pr-hygiene, false-negative-tooling]
source: task:21665
created: 2026-07-08
---

Self-review (#21664) flagged PR #28's CI typecheck as failing with "~10 pre-existing errors." Investigation (#21665) found the real count is ~50, and — critically — the SAME set exists on `main` itself, not introduced by this branch. Root cause of the bulk: ~35 skill files (`skills/bitcoin-wallet/*`, `skills/defi-zest/*`, `skills/bitcoin-taproot-multisig/*`, etc.) import from `../../github/aibtcdev/skills/...`, a sibling repo checkout that's gitignored (`.gitignore:19` — `github/`) and never checked out by `.github/workflows/ci.yml` (no clone/checkout step for it). These imports resolve fine at runtime on the actual server (where the sibling clone exists) but always fail `tsc --noEmit` in CI. This has apparently been broken on `main` for a while — CI's `typecheck` job is not actually a reliable merge gate for this repo in its current form.

**Two footguns hit during investigation, both worth remembering:**
1. `bun tsc --noEmit` in a *fresh git worktree* silently no-ops (`error: Script not found "tsc"`, exit 0) if `bun install` hasn't been run there — no `node_modules`, no `tsc` binary. A naive `| grep "error TS" | wc -l` on that output reads as "0 errors," which is a false negative, not a clean pass. Always `bun install` in a fresh worktree before trusting a `bun tsc` result.
2. To tell "did my branch cause this failure" from "was this already broken," diff the *normalized* error message sets (strip `(line,col)`) between the branch and a real `bun install`'d worktree of the merge-base/main — not raw counts, which get skewed by dedup and unrelated line-number shifts from unrelated nearby edits.

**Actionable follow-up (not done in #21665, out of scope for a bounded task):** either (a) add `exclude` patterns to `tsconfig.json` for files under `skills/**` that import from `github/`, since those are runtime-only deps never present in CI, or (b) add a CI step that clones/checks out `aibtcdev/skills` into `github/aibtcdev/skills` before the typecheck step, matching the real deployed layout. Until one of these lands, `typecheck` CI will keep failing on every PR touching skills that use the wallet/tx runner pattern, and reviewers should not treat that failure as blocking without checking whether it's new vs. baseline first.
