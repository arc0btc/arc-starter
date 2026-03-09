---
name: fleet-broadcast
description: Send a task to all fleet agents simultaneously
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - orchestration
---

# fleet-broadcast

Broadcasts a task to all fleet agents (or a subset) in parallel via SSH. Each agent receives the task in their local queue. Uses `Promise.allSettled()` so one agent's failure never blocks others.

## CLI Commands

```
arc skills run --name fleet-broadcast -- send \
  --subject "text" [--priority <n>] [--skills s1,s2] [--description "text"] [--agents spark,iris]

arc skills run --name fleet-broadcast -- status --subject "text" [--agents spark,iris]
```

## Commands

- **send**: Create a task on every target agent simultaneously. Defaults to all 4 agents. Reports per-agent success/failure with created task IDs.
- **status**: Check if a previously broadcast task exists on each agent by subject substring match. Shows task ID, status, and summary per agent.

## Options

- `--subject` — Task subject (required for send)
- `--priority` — Priority 1-10 (default: 5)
- `--skills` — Comma-separated skill names
- `--description` — Task description
- `--agents` — Comma-separated agent names or "all" (default: all)
- `--source` — Source tag (default: `fleet:arc:broadcast`)

## Agents

spark (192.168.1.12), iris (192.168.1.13), loom (192.168.1.14), forge (192.168.1.15)
