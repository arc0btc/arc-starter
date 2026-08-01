---
id: agent-runtime-checkout-not-git-tracked
topics: [agent-runtime, git, cross-repo-sync, models-ts]
source: task 24611 (kimi alias bump, 2026-07-31)
created: 2026-07-31
---

`/home/dev/agent-runtime` (the repo holding `agent-runtime/src/models.ts`, referenced by
CLAUDE.md's model-routing guidance) is a plain directory with **no `.git`** — `git status`
fails with "not a git repository". This is distinct from `arc-starter/agent-runtime/`, which
only holds `proposals/` and `specs/` (council DSL, ARC-00xx docs) and *is* tracked as part of
arc-starter.

Impact: any task asked to sync a fix "in both models.ts (arc-starter + agent-runtime)" can edit
`/home/dev/agent-runtime/src/models.ts` on disk, but there is no commit to point to and no way
to verify the edit persists across a redeploy/checkout refresh of that directory — it's silent,
uncommitted drift by construction, not an oversight in that one task.

**If a task needs to guarantee the agent-runtime-side fix isn't lost:** confirm whether
`/home/dev/agent-runtime` is meant to be a symlink/mirror of a real upstream repo (e.g. synced
by a deploy script) before treating the on-disk edit as durable. If unclear, flag to whoabuddy
rather than assuming the file edit alone closes the loop — don't re-flag on every occurrence,
but the first time a task depends on that file surviving is worth a one-shot check.
