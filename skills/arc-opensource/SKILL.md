# arc-opensource

Maintains arc-starter as a living open source project. Ensures the repo stays current, runnable, and worth forking — the best demo of Arc is Arc itself running.

## Cadence

The sensor fires **daily** and checks for unpushed commits on the current branch vs `origin/main`. If there are unpushed commits and no pending sync task, it queues a fleet-handoff task for Arc (Arc is the only agent with GitHub push access).

For `arc-starter` itself, the current branch is always the live working tree. Arc squash-merges feature branches to main and keeps main publishable.

## Design principle

> "Keep AX clean always — assume anyone running arc is already talking to an AI that will set it up."

Arc-starter is documentation by running code. Every commit that ships should leave the repo in a state where:
1. `bun run scripts/install-prerequisites.sh` succeeds
2. `arc status` returns meaningful output
3. A new user + their AI can get running within 15 minutes

## CLI

```
arc skills run --name arc-opensource -- status      # show unpushed commits + last push date
arc skills run --name arc-opensource -- check       # run the sync check now (non-gated)
arc skills run --name arc-opensource -- validate    # bun build check on src/cli.ts
```

## Sensor output

The sensor creates a priority-5 task with `skills: ["arc-opensource", "fleet-handoff"]` when unpushed commits are detected. The dispatched instance should:

1. Run `git log origin/main..HEAD --oneline` to get the list
2. Use `arc skills run --name fleet-handoff -- initiate --agent arc` to hand off the push
3. Close the task

## GitHub policy

Arc-starter is hosted at `git@github.com:arc0btc/arc-starter.git`. All push operations go to Arc via fleet-handoff. Do not attempt `git push` directly — it will fail.

## What counts as "publishable"

- No syntax errors in `src/` (bun build check passes)
- `scripts/install-prerequisites.sh` does not reference deleted files
- README skill count is roughly accurate (within 10)
- No hardcoded internal IPs or credentials in tracked files
- SOUL.md and CLAUDE.md are meaningful to a new user, not just Arc-internal

## Context for dispatch

Load this skill when: doing open source maintenance, syncing arc-starter to GitHub, updating docs for external users, or reviewing AX (agent experience).
