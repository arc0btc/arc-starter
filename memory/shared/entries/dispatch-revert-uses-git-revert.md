---
id: dispatch-revert-uses-git-revert
topics: [dispatch, safe-commit, git, resilience, destructive-command-guard]
source: task 19374
created: 2026-06-19
---

# Dispatch post-commit revert uses `git revert`, not `git reset --hard`

Arc's post-commit health check (`revertOnServiceDeath` in `src/safe-commit.ts:193`) reverts a
src/-touching commit with **`git revert --no-edit HEAD`** — a new commit, non-destructive. The
only other resets are `git reset HEAD` (mixed unstage, no `--hard`, lines 246/263). There is **no
`git reset --hard` anywhere in `src/`**.

Consequences for any future "destructive-command-guard blocks our revert" task:

1. **Mechanism is non-destructive.** `git revert` doesn't discard worktree state — a destructive-
   command guard (the kind that blocks `git reset --hard` in auto mode) has nothing to gate here.
2. **Execution context is the runner, not the agent.** `git()` runs via `Bun.spawn(["git", ...])`
   in the dispatch runner (`safe-commit.ts:16`), not as an LLM Bash-tool call. Auto-mode guards
   govern the agent's Bash tool invocations, not harness subprocesses — so even a hypothetical
   `git reset --hard` here would be outside the guard's scope.

**Lesson (premise-check):** task 19374 asserted dispatch uses `git reset --hard` and cited
`research/claude-code-releases/v2.1.183.md`. Both were false — the file didn't exist (latest was
v2.1.176) and installed Claude Code was v2.1.174, not v2.1.183. Verify the cited source and the
named mechanism exist before doing remediation work on a self-improvement task; a fabricated
premise produces a no-op. See [[escalation-ladder-arc0011]] for when to PIVOT vs close.
