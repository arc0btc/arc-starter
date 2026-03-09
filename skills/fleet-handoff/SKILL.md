---
name: fleet-handoff
description: Transfer partially complete tasks between fleet agents with full work context
updated: 2026-03-09
tags:
  - fleet
  - orchestration
  - handoff
---

# fleet-handoff

Transfer partially complete tasks from one agent to another with structured context about work done, work remaining, and relevant files. Ensures continuity when an agent is overloaded, blocked, or lacks a required capability.

## Protocol

A handoff packages three things:

1. **Progress context** — What's been done so far (completed steps, findings, partial results)
2. **Remaining work** — What still needs to happen (explicit checklist)
3. **Artifact references** — Files changed, branches created, external state touched

The receiving agent gets a new task with a structured description containing all three sections. The sending agent's task is closed with status `completed` and summary linking to the handoff.

## When to Handoff

- Agent is overloaded (load score > soft cap)
- Task requires a skill/domain owned by another agent
- Agent is blocked on infrastructure only another agent can access
- Task partially done but remaining work maps to a different agent's specialty
- Budget pressure — shift remaining work to a cheaper-tier agent

## CLI Commands

```
arc skills run --name fleet-handoff -- initiate \
  --agent <target> \
  --task-id <local-task-id> \
  --progress "What has been completed so far" \
  --remaining "What still needs to be done" \
  [--artifacts "file1.ts, file2.ts, branch:feature-x"] \
  [--priority <n>] \
  [--skills s1,s2] \
  [--reason "Why handing off"]

arc skills run --name fleet-handoff -- status --id <handoff-id>

arc skills run --name fleet-handoff -- list [--limit <n>]
```

## Handoff Description Format

The remote task description follows this template:

```
[HANDOFF from <source-agent> task #<id>]

## Progress (completed)
<what was done>

## Remaining (TODO)
<what needs to happen next>

## Artifacts
<files, branches, external state>

## Reason
<why this was handed off>

## Original task
Subject: <original subject>
Priority: <original priority>
Skills: <original skills>
```

## State Tracking

Handoffs are tracked in `memory/fleet-handoffs.json`:
```json
[{
  "id": 1,
  "source_agent": "arc",
  "target_agent": "spark",
  "local_task_id": 42,
  "remote_task_id": 105,
  "subject": "...",
  "reason": "domain mismatch",
  "handed_off_at": "2026-03-09T12:00:00Z",
  "status": "handed-off"
}]
```

## Composability

- Uses `fleet-task-sync` SSH patterns for remote task creation
- Integrates with `fleet-router` domain rules for suggesting handoff targets
- Handoff source tracking: `source: "handoff:<agent>:<task-id>"`

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
