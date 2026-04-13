---
name: arc-worktrees
description: Opt-in git worktree isolation with experiment evaluation for dispatch tasks
updated: 2026-03-09
tags:
  - isolation
  - safety
  - dispatch
  - experiment
---

# Worktrees

Opt-in isolation for dispatch tasks using git worktrees. When a task includes `"arc-worktrees"` in its skills array, dispatch runs Claude Code in an isolated copy of the repo. Changes must pass both syntax validation and experiment evaluation before merging.

## How It Works

1. **Before dispatch:** Creates `.worktrees/task-{id}` with branch `dispatch/task-{id}`
2. **Captures baseline:** Snapshots recent dispatch metrics (success rate, cost, duration)
3. **Symlinks shared state:** `db/`, `.env`, `node_modules/` → main tree
4. **Runs Claude Code** with `cwd` set to the worktree
5. **Gate 1 — Syntax:** Validates all changed `.ts` files compile
6. **Gate 2 — Experiment evaluation:** Classifies changes and applies heuristic gates:
   - **Sensor changes:** Interval bounds check (1min–1440min)
   - **Prompt/SKILL.md changes:** Large deletion detection (>50% content removal blocked)
   - **SOUL.md changes:** Identity anchor protection (critical sections can't be removed)
   - **Core code changes:** Flagged for post-merge service health verification
   - **Config changes:** Credential removal warnings
7. **If approved:** Merges branch, schedules deferred verification task (2h later)
8. **If rejected:** Discards worktree — main tree untouched

## Deferred Verification

After merge, a P8 verification task is scheduled to compare post-experiment metrics against the captured baseline. If metrics degraded >10%, it creates a revert task.

## CLI

```
arc skills run --name worktrees -- create [--name NAME]    # create a worktree
arc skills run --name worktrees -- list                     # list all worktrees
arc skills run --name worktrees -- validate --name NAME     # syntax-check .ts files
arc skills run --name worktrees -- evaluate --name NAME     # run experiment evaluation gates
arc skills run --name worktrees -- merge --name NAME        # validate + merge + clean up
arc skills run --name worktrees -- remove --name NAME       # discard worktree + branch
```

### Name Parameter

The optional `--name` flag on `create` specifies a worktree identifier. If omitted, a random name is generated.

**Constraints:**
- **Characters:** Letters, digits, dots (`.`), underscores (`_`), dashes (`-`) only
- **Length:** Maximum 64 characters
- **Invalid examples:** spaces, `@`, `/`, `#`, uppercase (if treated as case-sensitive context)
- **Valid examples:** `feature-42`, `hotfix.v3`, `test_perf_opt`, `exp_001`

If the name doesn't meet constraints, the create command will reject it with an error message. Omit `--name` to use a randomly-generated name that always satisfies these rules.

## When to Use

Add `"arc-worktrees"` to a task's skills array when it modifies `src/` files — especially `web.ts`, `dispatch.ts`, `sensors.ts`, or `cli.ts`. Also use for self-improvement tasks: prompt tuning, sensor interval optimization, SKILL.md rewrites.

## What Gets Symlinked

| Path | Type | Why |
|------|------|-----|
| `db/` | directory | Shared SQLite task queue |
| `node_modules/` | directory | Avoid re-installing deps |
| `.env` | file | Environment variables |

Git-tracked files (`skills/`, `src/`, `SOUL.md`, `CLAUDE.md`, etc.) are already present in the worktree via git checkout.
