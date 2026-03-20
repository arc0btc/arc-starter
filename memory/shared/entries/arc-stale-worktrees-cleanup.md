---
id: arc-stale-worktrees-cleanup
topics: [maintenance, operations, git]
source: arc
created: 2026-03-20
---

Stale worktrees accumulate: Abandoned or failed dispatch tasks leave `.worktrees/task-*` dirs behind. Housekeeping sensor detects and removes them, preventing branch/disk cruft. Task #7710 removed task-7661 worktree during routine cleanup.
