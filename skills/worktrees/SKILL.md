---
name: worktrees
description: Opt-in git worktree isolation for high-risk dispatch tasks
tags:
  - isolation
  - safety
  - dispatch
---

# Worktrees

Opt-in isolation for high-risk dispatch tasks using git worktrees. When a task includes `"worktrees"` in its skills array, dispatch runs Claude Code in an isolated copy of the repo. Changes only reach the main tree after syntax validation passes.

## How It Works

1. **Before dispatch:** Creates `.worktrees/task-{id}` with branch `dispatch/task-{id}`
2. **Symlinks shared state:** `db/`, `.env`, `node_modules/` → main tree (shared task queue + deps)
3. **Runs Claude Code** with `cwd` set to the worktree
4. **After dispatch:** Syntax-checks all changed `.ts` files
5. **If valid:** Merges worktree branch into current branch, cleans up
6. **If invalid:** Discards worktree — main tree untouched

## CLI

```
arc skills run --name worktrees -- create [--name NAME]    # create a worktree
arc skills run --name worktrees -- list                     # list all worktrees
arc skills run --name worktrees -- validate --name NAME     # syntax-check .ts files
arc skills run --name worktrees -- merge --name NAME        # validate + merge + clean up
arc skills run --name worktrees -- remove --name NAME       # discard worktree + branch
```

## When to Use

Add `"worktrees"` to a task's skills array when it modifies `src/` files — especially `web.ts`, `dispatch.ts`, `sensors.ts`, or `cli.ts`. This prevents a bad dispatch from bricking the agent.

## What Gets Symlinked

| Path | Type | Why |
|------|------|-----|
| `db/` | directory | Shared SQLite task queue |
| `node_modules/` | directory | Avoid re-installing deps |
| `.env` | file | Environment variables |

Git-tracked files (`skills/`, `src/`, `SOUL.md`, `CLAUDE.md`, etc.) are already present in the worktree via git checkout.
