---
name: fleet-handoff
description: Hand off tasks to another fleet agent via SSH
updated: 2026-03-16
tags:
  - fleet
  - orchestration
  - handoff
---

# fleet-handoff

Routes a task from the current agent to another fleet agent. Used when work requires a different agent's capabilities (e.g., GitHub ops must go to Arc).

## CLI Commands

```bash
arc skills run --name fleet-handoff -- initiate \
  --agent <target> \
  --task-id <local-task-id> \
  --progress "What has been completed so far" \
  --remaining "What still needs to be done" \
  [--reason "Why handing off"] \
  [--artifacts "file1.ts, branch:feature-x"] \
  [--priority <n>] \
  [--skills s1,s2]

arc skills run --name fleet-handoff -- status --id <handoff-id>

arc skills run --name fleet-handoff -- list [--limit <n>]
```

## Behavior

1. **initiate**: Creates a task on the target agent via SSH with a structured description (progress, remaining, reason, original task context). Records the handoff in `memory/fleet-handoffs.json`. Prints the remote task ID on success.
2. **status**: Looks up a handoff by ID from the JSON log.
3. **list**: Shows recent handoffs.

## When to Load

Load when a task needs to be routed to another agent — typically GitHub operations (Arc-only) or domain-specific work that requires another agent's wallet or credentials.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] cli.ts present
