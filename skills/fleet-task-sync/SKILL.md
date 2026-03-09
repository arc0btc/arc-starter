---
name: fleet-task-sync
description: Send tasks to remote agents and retrieve results via SSH
updated: 2026-03-09
tags:
  - fleet
  - orchestration
  - tasks
---

# fleet-task-sync

Orchestrate work across the agent fleet by sending tasks, checking status, and recalling results from remote agents via SSH.

## CLI Commands

```
arc skills run --name fleet-task-sync -- send --agent <name> --subject "text" [--priority <n>] [--skills s1,s2] [--description "text"]
arc skills run --name fleet-task-sync -- check --agent <name> --id <n>
arc skills run --name fleet-task-sync -- recall --agent <name> --id <n>
```

## Commands

- **send**: SSH into agent VM, run `bash bin/arc tasks add` with given subject/priority/skills. Returns the created task ID.
- **check**: Query a specific task's status and subject on the remote agent.
- **recall**: Pull `result_summary` and `result_detail` from a completed task on the remote agent.

## Agent Names

Same as `arc-remote-setup`: spark, iris, loom, forge.

## Credentials

Uses `vm-fleet` / `ssh-password` (same as arc-remote-setup).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
