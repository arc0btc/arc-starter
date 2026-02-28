---
name: workflows
description: Persistent state machine instances for multi-step workflows
tags:
  - orchestration
  - state-management
  - utilities
---

# workflows

Workflows manage persistent state machines. Each workflow instance tracks progress through defined states, preserving context between task executions.

## Why Workflows

Tasks are atomic units. But some work spans multiple states and decisions. A workflow encodes that progression: start → intermediate states → completion. State is persisted in SQLite, so a workflow survives dispatch cycles and can resume from where it left off.

## The Workflows Table

```sql
CREATE TABLE workflows (
  id INTEGER PRIMARY KEY,
  template TEXT NOT NULL,
  instance_key TEXT UNIQUE NOT NULL,
  current_state TEXT NOT NULL,
  context TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
)
```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | INTEGER PRIMARY KEY | Unique workflow instance identifier |
| `template` | TEXT NOT NULL | Workflow template name (e.g., "blog-posting", "signal-filing") |
| `instance_key` | TEXT UNIQUE | Human-readable, dedup-safe key for this instance |
| `current_state` | TEXT NOT NULL | Current state name (e.g., "draft", "review", "published") |
| `context` | TEXT | JSON object with state-specific data |
| `created_at` | TEXT | When the workflow started |
| `updated_at` | TEXT | Last state transition timestamp |
| `completed_at` | TEXT | When the workflow finished (NULL if active) |

## CLI

```
arc skills run --name workflows -- list                          # List all workflows
arc skills run --name workflows -- list-by-template <template>   # Workflows for a template
arc skills run --name workflows -- create <template> <instance_key> <initial_state>  # Create new
arc skills run --name workflows -- show <id>                     # Show workflow details
arc skills run --name workflows -- transition <id> <new_state> [--context JSON]  # Move to new state
arc skills run --name workflows -- complete <id>                 # Mark as completed
arc skills run --name workflows -- delete <id>                   # Delete workflow
```

### Examples

**Create a workflow:**
```bash
arc skills run --name workflows -- create blog-posting arc-weekly-post-1 "draft"
```

**Advance to next state:**
```bash
arc skills run --name workflows -- transition 1 "review" --context '{"reviewer":"whoabuddy"}'
```

**Check status:**
```bash
arc skills run --name workflows -- show 1
```

**Publish (complete):**
```bash
arc skills run --name workflows -- complete 1
```

## Patterns

### Dedup: Instance Keys

Every workflow needs a unique `instance_key`. This is your dedup gate. Use it to prevent duplicate workflows for the same logical work.

Example: `arc-weekly-post-{date}`, `signal-filing-{beat}-{day}`, `claim-beat-{name}`

### State Names

Define states as simple identifiers: `draft`, `review`, `published`, `failed`, etc. No spaces or special chars.

### Context

Store workflow-specific data as JSON in `context`. This is how you pass data between states.

```json
{
  "author": "Arc",
  "title": "State Machines for Agents",
  "reviewer": "whoabuddy",
  "feedback": "..."
}
```

### Sensor

Runs every 60 minutes. Detects stale workflows (>7 days active, no updates) and queues a review task. This prevents workflows from getting stuck.

## Checklist

- [ ] `skills/workflows/SKILL.md` exists
- [ ] `skills/workflows/cli.ts` implements all commands
- [ ] `bun skills/workflows/cli.ts list` runs without error
- [ ] `bun skills/workflows/cli.ts create blog-test draft-1 draft` creates a workflow
- [ ] `bun skills/workflows/cli.ts show 1` displays created workflow
- [ ] Transitions preserve context JSON correctly
- [ ] Completed workflows have `completed_at` timestamp set
