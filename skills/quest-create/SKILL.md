---
name: quest-create
description: Drives QuestMachine workflows — registers phases and advances quest state after each phase completes.
updated: 2026-03-20
tags:
  - orchestration
  - meta
---

# quest-create

The missing link for `QuestMachine`. Provides `plan` and `advance` commands that QuestMachine phase tasks call to drive themselves forward.

## How it fits

`QuestMachine` (in `skills/workflows/state-machine.ts`) manages multi-phase quests with a two-state loop: `planning → executing → completed`. Each state creates a task with instructions to call this skill:

- Planning task calls `plan` → registers phases, transitions to executing, creates phase 1 task
- Each phase task calls `advance` → marks phase done, creates next phase task (or completes quest)

## CLI Commands

```
arc skills run --name quest-create -- plan \
  --slug <slug> \
  --phase "Name: goal" \
  [--phase "Name: goal" ...]

arc skills run --name quest-create -- advance --slug <slug>
```

### plan
Registers phases into the workflow context and transitions `planning → executing`. Creates the first phase task immediately. The `--slug` must match the `instance_key` of an existing quest workflow in `planning` state.

Phase format: `"Name: goal"` — everything before the first colon is the phase name, everything after is the goal. Both are stored in context and shown in the phase task subject/description.

### advance
Marks the current phase as completed, increments `currentPhase`, and creates the next phase task. If all phases are done, transitions to `completed` and closes the workflow.

## Starting a quest

```bash
# 1. Create the workflow
arc skills run --name workflows -- create quest <slug> planning \
  --context '{"slug":"<slug>","goal":"<goal>","skills":["skill1"],"model":"opus","parentTaskId":null,"sourceTaskId":null,"phases":[],"currentPhase":0}'

# 2. Evaluate to create the planning task
arc skills run --name workflows -- evaluate <workflow_id>

# 3. Dispatch runs the planning task, which calls:
arc skills run --name quest-create -- plan --slug <slug> \
  --phase "Research: ..." --phase "Build: ..." --phase "Verify: ..."

# 4. Each phase task ends with:
arc skills run --name quest-create -- advance --slug <slug>
```

## Phase task behavior

Each phase task is created with:
- `skills`: `["quest-create", ...quest.skills]` — quest-create always included so advance is available
- `priority`: 4 (Sonnet tier by default; override via `model` in quest context)
- `parent_id`: quest's `parentTaskId` if set
- `source`: `workflow:<id>`
