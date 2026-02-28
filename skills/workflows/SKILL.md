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

## State Machine Runner

The workflow system includes a minimal, dependency-free state machine runner. Each template defines allowed transitions and optional actions for states. The runner evaluates a workflow and returns an action (typically: create a task, or noop).

**Key components:**
- `StateMachine<C>` — Template definition (states, transitions, action functions)
- `evaluateWorkflow(workflow, template)` — Run state machine, return action
- `getAllowedTransitions(state, template)` — Get available transitions from a state
- `isTransitionAllowed(from, to, template)` — Check if transition is valid

**Built-in templates:** `BlogPostingMachine`, `SignalFilingMachine`, `BeatClaimingMachine`

See `state-machine.ts` for full API (100 lines, no external deps).

## CLI

```
arc skills run --name workflows -- list                          # List all workflows
arc skills run --name workflows -- list-by-template <template>   # Workflows for a template
arc skills run --name workflows -- create <template> <instance_key> <initial_state>  # Create new
arc skills run --name workflows -- show <id>                     # Show workflow details
arc skills run --name workflows -- transition <id> <new_state> [--context JSON]  # Move to new state
arc skills run --name workflows -- complete <id>                 # Mark as completed
arc skills run --name workflows -- delete <id>                   # Delete workflow
arc skills run --name workflows -- evaluate <id>                 # Evaluate state machine for workflow
arc skills run --name workflows -- allowed-transitions <id>      # Show allowed transitions from current state
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

## Custom State Machines

Define your own state machine template:

```typescript
import { StateMachine, evaluateWorkflow } from "./state-machine.ts";

const myTemplate: StateMachine<{ title?: string; approved?: boolean }> = {
  name: "my-workflow",
  initialState: "draft",
  states: {
    draft: {
      on: { submit: "review" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Review: ${ctx.title}`,
        priority: 5,
      }),
    },
    review: {
      on: { approve: "done", reject: "draft" },
      action: (ctx) => ctx.approved ? null : { type: "noop" },
    },
    done: {
      on: {},
    },
  },
};

// Use it:
const action = evaluateWorkflow(workflow, myTemplate);
```

**Action types:**
- `"create-task"` — Create a task (subject, priority, skills required)
- `"transition"` — Auto-transition to next state
- `"noop"` — No action needed

### Meta-Sensor

The workflows meta-sensor runs every 5 minutes and evaluates all active workflow instances:

1. Scans all active workflows (status != 'completed')
2. For each workflow, loads its template and evaluates the state machine
3. Creates tasks when a workflow's action is `"create-task"`
4. Auto-transitions workflows when action is `"transition"`
5. Skips no-ops and workflows with unknown templates

This keeps workflows moving without manual intervention. Each workflow action can specify:
- `subject` — Task subject
- `description` — Task description
- `priority` — Task priority (default 5)
- `skills` — Array of skill names to include
- `nextState` — For transitions

The sensor source for created tasks is `workflow:{workflow_id}`, allowing you to trace which workflow created which task.

## Checklist

- [ ] `skills/workflows/SKILL.md` exists
- [ ] `skills/workflows/cli.ts` implements all commands
- [ ] `bun skills/workflows/cli.ts list` runs without error
- [ ] `bun skills/workflows/cli.ts create blog-test draft-1 draft` creates a workflow
- [ ] `bun skills/workflows/cli.ts show 1` displays created workflow
- [ ] Transitions preserve context JSON correctly
- [ ] Completed workflows have `completed_at` timestamp set
