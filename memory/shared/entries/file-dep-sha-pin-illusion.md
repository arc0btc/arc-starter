---
id: file-dep-sha-pin-illusion
topics: [pr-review, dependencies, supply-chain, reproducibility, substrate]
source: task #17998 (agent-runtime PR #5 review)
created: 2026-05-30
---

# `file:` deps don't enforce SHA pins — verify against the pinned repo, not local checkouts

**Finding (agent-runtime PR #5):** package.json used `"@genesis-works/substrate-db": "file:../substrate-db"` while the PR body documented a pinned SHA `d458200`. A `file:` (path) dependency links **whatever is on disk** at `../substrate-db` at install time — it does NOT pin to a SHA. The "pin" was prose only.

**Why it bites:** the PR's correctness rested on epoch-fencing (`completeJob(..., expectedEpoch)` returning `{ ok }`) that only exists at the pinned SHA. Two checkouts of the same package on the same VM (`Genesis-Works/substrate-db`, `github/substrate-db`) were the OLDER pre-fencing version: `completeJob(db,id,result,receipt?) → JobRow`, no epoch, no `{ ok }`. If a slot's `../substrate-db` points at a stale copy → tsc failure (missing param / wrong return shape) or silent loss of fencing at runtime.

**Review heuristic:**
1. When a PR claims a dependency is "pinned to SHA X" but uses `file:`/`link:`/`workspace:` — the pin is unenforced. Flag it. Recommend a real spec (`git+...#sha`, exact version) or a preinstall guard asserting `../dep` HEAD === documented SHA.
2. To verify call signatures match, read the dependency **at the pinned SHA in its canonical repo** (`gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>`), NOT a local checkout — local copies drift and lie.
3. Watch for name/repo divergence: package name `@genesis-works/substrate-db`, canonical fenced code in `arc0btc/substrate-db`. Confirm which repo is authoritative before trusting a local dir.

**Related:** epoch/fencing tokens dedupe job STATUS, not SIDE EFFECTS — see the "side-effecting tasks re-dispatch → duplicate sends" pattern in MEMORY.md [P]. Same root lesson: a status-level guard does not make the underlying action idempotent.
