# Workflows: Subagent Instructions

You are assigned a task that uses the workflows skill. This document tells you what you need to know.

## What Workflows Do

Workflows persist state machines in SQLite. Use them when your task spans multiple states and you need to resume from where you left off in a future dispatch cycle.

## When to Use Workflows

**Use a workflow if:**
- Your task has 2+ distinct states (draft → review → published)
- You need to pause and resume work across multiple dispatch cycles
- You want to track progress persistently in the database
- You need to share state with other agents or tasks

**Don't use a workflow if:**
- Your task is atomic and completes in one dispatch
- You're just passing data within a single cycle

## CLI Commands

Use the workflow CLI to manage state:

```bash
# Create a new workflow
arc skills run --name workflows -- create <template> <instance_key> <initial_state>

# Check current state
arc skills run --name workflows -- show <id>

# Move to next state
arc skills run --name workflows -- transition <id> <new_state> --context '{"key":"value"}'

# Mark as done
arc skills run --name workflows -- complete <id>
```

## Patterns

### Instance Keys

Use deterministic instance keys so you can find your workflow later:
- `beat-claim-{beat-name}-{date}` for beat claims
- `blog-post-{publication-date}` for blog workflows
- `signal-filing-{beat}-{number}` for signal workflows

Query for an existing workflow by instance key before creating a new one:

```bash
arc skills run --name workflows -- show-by-key <template> <instance_key>
```

### Context

Store workflow-specific data as JSON. Example:

```bash
arc skills run --name workflows -- transition 5 review \
  --context '{"title":"My Post","draft_url":"..."}'
```

Parse the context in your task code to continue from where you left off.

### State Flow

Define your states upfront. Common patterns:

**Blog publishing:** `draft` → `review` → `revision` → `published` | `rejected`

**Beat claiming:** `pending` → `claimed` | `failed`

**Signal filing:** `detected` → `formatted` → `filed` | `error`

## Gotchas

1. **Instance key uniqueness**: Instance keys are UNIQUE. If you try to create a workflow with an existing instance_key, it will fail. Check first.

2. **Context is JSON**: The context must be valid JSON or the transition will fail. Test your JSON before passing it.

3. **Completed workflows**: Once you mark a workflow as `completed`, it won't show in "active" lists. If you need to resume, you'll need to query by ID or instance_key.

4. **No automatic cleanup**: Workflows don't auto-delete. Use `delete` only if you're sure you don't need the history.

## Integration with Tasks

Best practice: Create a parent task and use its ID or source in your instance_key:

```
instance_key = "workflow-task:123-blog-post-2026-02-28"
```

This links the workflow to the task that created it, making debugging easier.

## Example Walkthrough

1. **Task creates workflow:**
   ```bash
   arc skills run --name workflows -- create blog-post blog-post-2026-02-28 draft
   # Returns: { "id": 5, ... }
   ```

2. **Write draft, transition to review:**
   ```bash
   arc skills run --name workflows -- transition 5 review \
     --context '{"url":"...","author":"Arc"}'
   ```

3. **Next dispatch, task resumes:**
   ```bash
   arc skills run --name workflows -- show 5
   # Returns: { "current_state": "review", "context": {...} }
   ```

4. **Publish and complete:**
   ```bash
   arc skills run --name workflows -- transition 5 published
   arc skills run --name workflows -- complete 5
   ```

That's it. Workflows are a simple, durable way to track multi-step work.
