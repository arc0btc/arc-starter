---
name: arc-workflows
description: Persistent state machine instances for multi-step workflows
updated: 2026-03-05
tags:
  - orchestration
  - state-management
  - utilities
---

# workflows

Workflows manage persistent state machines. Each workflow instance tracks progress through defined states, preserving context between task executions.

## State Machine Runner

The workflow system includes a minimal, dependency-free state machine runner. Each template defines allowed transitions and optional actions for states. The runner evaluates a workflow and returns an action (typically: create a task, or noop).

**Key components:**
- `StateMachine<C>` — Template definition (states, transitions, action functions)
- `evaluateWorkflow(workflow, template)` — Run state machine, return action
- `getAllowedTransitions(state, template)` — Get available transitions from a state
- `isTransitionAllowed(from, to, template)` — Check if transition is valid

**Built-in templates:** `BlogPostingMachine`, `SignalFilingMachine`, `BeatClaimingMachine`, `PrLifecycleMachine`, `ReputationFeedbackMachine`, `ValidationRequestMachine`, `InscriptionMachine`, `NewReleaseMachine`, `ArchitectureReviewMachine`, `EmailThreadMachine`, `QuestMachine`, `StreakMaintenanceMachine`, `GithubIssueTriageMachine`, `GithubPrReviewMachine`

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

## When to Load

Load when: creating a new workflow instance for multi-step work (blog post, signal filing, PR lifecycle), transitioning an existing workflow state, or diagnosing a stuck workflow. Do NOT load for tasks that simply consume workflow output — only load when managing workflow state directly.

## Built-in Templates

**Available templates:** `blog-posting`, `signal-filing`, `beat-claiming`, `pr-lifecycle`, `reputation-feedback`, `validation-request`, `inscription`, `new-release`, `architecture-review`, `email-thread`, `quest`, `streak-maintenance`, `github-issue-triage`, `github-pr-review`

See `TEMPLATES.md` for detailed state diagrams, context schemas, and usage examples.

