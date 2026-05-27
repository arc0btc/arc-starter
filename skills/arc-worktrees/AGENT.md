---
name: arc-worktrees
description: Subagent briefing for executing worktree-isolated dispatch tasks
---

# Worktree Task Execution Guide

You are running inside an isolated git worktree. This briefing covers everything you need to make changes, validate them, and hand off for merge.

---

## Your Environment

**Worktree path:** `.worktrees/task-{id}` (absolute: `<repo-root>/.worktrees/task-{id}`)
**Branch name:** `dispatch/task-{id}` (dispatch-created) or `worktree/{name}` (manually created)

The worktree is a full copy of the repo at the time of task creation. You work here; main tree is untouched until explicit merge.

### What is symlinked (shared with main tree)

| Path | Shared | Why |
|------|--------|-----|
| `db/` | Yes — symlink | Live task queue; reads/writes affect main system |
| `node_modules/` | Yes — symlink | Avoid re-install; do not modify |
| `.env` | Yes — symlink (if exists) | Environment variables; do not modify |
| Everything else | No — isolated copy | Git-tracked files, safe to modify |

**Never delete or replace the symlinks.** They point to the live system.

---

## Workflow

### 1. Make your changes

Work normally. Edit files in the worktree. Commit to the branch (`dispatch/task-{id}`).

The worktree branch diverges from `HEAD` (main). All your commits go here — they are not visible in main until merge.

### 2. Validate syntax

Before requesting merge, syntax-check all changed `.ts` files:

```
arc skills run --name worktrees -- validate --name task-{id}
```

This runs Bun's transpiler over every `.ts` file changed vs `HEAD`. If any file fails, fix the errors and re-run. Syntax errors block merge.

### 3. Evaluate the experiment

```
arc skills run --name worktrees -- evaluate --name task-{id}
```

This classifies every changed file by category and runs heuristic gates. Output shows:
- Baseline metrics (last 6h success rate, avg cost, avg duration)
- File list with categories
- Any warnings
- `APPROVED` or `REJECTED` decision

**Warnings** are logged but do not block merge. Review them.
**REJECTED** means a hard gate fired — fix the issue before proceeding.

### 4. Merge

```
arc skills run --name worktrees -- merge --name task-{id}
```

`merge` re-runs syntax validation, then does `git merge dispatch/task-{id} --no-edit` into the current branch (main), removes the worktree, and deletes the branch.

After merge, a P8 deferred verification task is scheduled (2h out) to compare post-merge metrics against the pre-experiment baseline.

### 5. If rejected — discard

```
arc skills run --name worktrees -- remove --name task-{id}
```

Discards the worktree and branch. Main tree is completely untouched.

---

## Gate Reference

The evaluate command runs four gates. Hard failures block merge; warnings do not.

### Gate 1 — Syntax (always runs, part of validate)

Bun transpiler validates all changed `.ts` files. Any syntax error = **hard block**.

### Gate 2 — Sensor intervals

Files matching `skills/*/sensor.ts` are checked for `claimSensorRun(name, interval)` calls.

| Condition | Result |
|-----------|--------|
| `interval < 1` | **Hard block** — below minimum |
| `interval > 1440` | Warning only — likely too infrequent |

### Gate 3 — Prompt/content changes

Files matching `skills/*/SKILL.md`, `skills/*/AGENT.md`, or `SOUL.md`.

| Condition | Result |
|-----------|--------|
| New content < 50% of old content | Warning — large deletion |
| `SOUL.md` missing `## Who I Am` | **Hard block** — identity anchor removed |

SOUL.md is the identity anchor. Never remove the `## Who I Am` section. Other sections can be modified but must not drop below 50% of original length without explicit intent.

### Gate 4 — Core code changes

Files in `src/dispatch.ts`, `src/sensors.ts`, `src/db.ts`, `src/cli.ts`, `src/services.ts` trigger a warning:
> "Core files modified — verify service health post-merge"

This is warning-only. After merge, the dispatch runner's post-commit health check watches for service crashes and auto-reverts if services die.

### Gate 5 — Config changes

`.env` changes trigger a warning to verify no credentials were removed. Warning-only.

---

## Change Categories

The evaluator classifies each changed file:

| Pattern | Category |
|---------|----------|
| `skills/*/sensor.ts` | `sensor` |
| `skills/*/SKILL.md`, `skills/*/AGENT.md`, `SOUL.md` | `prompt` |
| `memory/**` | `memory` |
| `.env`, `templates/**` | `config` |
| `src/**`, `skills/*/cli.ts` | `code` |
| Everything else | `unknown` |

Categories determine which gates run. A single task can touch multiple categories.

---

## Decision Matrix

| Situation | Action |
|-----------|--------|
| All gates pass | `merge` |
| Warnings only | Review warnings, then `merge` if acceptable |
| Hard block (syntax, sensor interval, SOUL identity anchor) | Fix the issue, re-validate, re-evaluate, then `merge` |
| Cannot fix (wrong approach, spec mismatch) | `remove` — discard and report in task summary |
| Merge conflict | Resolve in worktree branch, re-validate, then `merge` |

---

## Common Mistakes

**Do not modify the live DB.** The `db/` symlink points to the main system's SQLite file. Task queue operations via `arc tasks` CLI are fine — those go through the normal API. Do not run raw SQL or schema migrations from the worktree.

**Do not push the worktree branch to remote.** Worktree branches are local and ephemeral. Merge to main, then push main if needed.

**Do not run `arc services install` or restart services.** You're in an isolated worktree — service changes from here affect the live system. Service management is the dispatch runner's job.

**Validate before evaluate.** Syntax errors cause misleading evaluate output. Always run `validate` first.

**`--name` is the worktree identifier, not the task subject.** For dispatch-created worktrees, the name is `task-{id}` (e.g. `task-17742`). For manual worktrees, it's whatever was passed to `create --name`.

---

## Verification Task (automatic)

After a successful merge, the CLI schedules a P8 `sonnet` task ~2h later:

> "Verify experiment from task #{id} — check metric impact"

That task will:
1. Capture current metrics for the same 6h window
2. Compare against the baseline snapshot embedded in its description
3. Create a revert task if metrics degraded >10%
4. Mark verified if stable or improved

You do not need to create this task manually — `merge` does it.
