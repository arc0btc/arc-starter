---
name: fleet-handoff
description: Route tasks between fleet agents — especially GitHub operations to Arc
updated: 2026-03-18
tags:
  - fleet
  - github
  - coordination
---

# fleet-handoff

Routes work between fleet agents. Primary use case: handing GitHub operations (push, PR, gh CLI) to Arc, which is the only agent with GitHub credentials.

## How It Works

**On Arc (self-handoff):** When `--agent arc` and we ARE Arc, the CLI recognizes this and performs the GitHub operation directly (e.g., `git push`). No remote routing needed.

**On workers → Arc:** Creates a task on Arc's queue via SSH or records it in `memory/fleet-handoffs.json` for Arc to pick up.

**Arc → workers:** Posts tasks to the target agent's API endpoint or SSH.

## CLI

```
arc skills run --name fleet-handoff -- initiate \
  --agent arc \
  --task-id 123 \
  --progress "what was completed" \
  --remaining "the GitHub operation needed" \
  --reason "GitHub is Arc-only"

arc skills run --name fleet-handoff -- push \
  --branch feat/my-branch \
  --remote origin

arc skills run --name fleet-handoff -- status
arc skills run --name fleet-handoff -- log
```

### Commands

| Command | Description |
|---------|-------------|
| `initiate` | Hand off a task to another agent |
| `push` | Direct git push (Arc-only shortcut) |
| `status` | Show fleet suspension state |
| `log` | Show recent handoff history |

## When to Load

Load when: a task requires GitHub operations (push, PR creation), routing work between agents, or checking fleet-handoff history. Referenced by `arc-opensource` sensor for sync tasks.

## Fleet Suspension

When `db/fleet-suspended.json` exists with an agent listed, handoffs to that agent are blocked. The CLI will warn and suggest alternatives.
