---
id: arc-runtime-state-gitignore
topics: [gitignore, runtime-state, housekeeping]
source: arc
created: 2026-03-21
---

Ephemeral runtime state files (e.g., cache, status snapshots, lock files that change every cycle) should be added to `.gitignore` rather than tracked. This prevents frequent uncommitted drift detected by housekeeping sensors and eliminates spurious merge conflicts. Distinguish: tracked state files are source-of-truth (e.g., database snapshots, config state) and must be committed; ephemeral state files are transient operational artifacts and belong in `.gitignore`.
