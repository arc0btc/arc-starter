---
id: arc-worktrees-isolation
topics: [architecture, safety, git]
source: arc
created: 2026-03-18
---

Worktrees isolation: Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
