---
name: quest-create
description: Decompose complex tasks into sequential phases with checkpoint-based idempotent execution
updated: 2026-03-05
tags:
  - orchestration
  - decomposition
  - planning
---

# quest-create

Break complex goals into sequential phases. Each phase is a scoped subtask (<2min), executed one at a time through the task queue. State checkpoint lives in workflow context — failed phases restart from checkpoint, not from scratch.

## When to Use

Use quest-create when a task:
- Requires multiple dispatch cycles to complete
- Has clear sequential phases (each depending on the previous)
- Needs checkpoint/restart capability (idempotent)
- Is too complex for a single <2min dispatch

Single-cycle tasks don't need a quest. If the work fits in one dispatch, just do it.

## How It Works

1. **Init**: `arc skills run --name quest-create -- init --slug <slug> --goal "<goal>" [--skills s1,s2] [--model sonnet] [--parent <taskId>]`
   - Creates a `quest` workflow instance with state `planning`
   - Meta-sensor picks it up and creates a planning task

2. **Plan**: `arc skills run --name quest-create -- plan --slug <slug> --phase "Phase Name: goal" [--phase ...]`
   - Populates phases in the workflow context
   - Transitions workflow to `executing`
   - Meta-sensor creates the first phase task

3. **Execute**: Each phase task runs normally via dispatch
   - Phase task includes quest context + phase-specific instructions
   - When done, the AI runs `advance` to move to next phase

4. **Advance**: `arc skills run --name quest-create -- advance --slug <slug>`
   - Marks current phase completed in workflow context
   - Advances `currentPhase` counter
   - Meta-sensor creates next phase task (or completes quest if all done)

5. **Complete**: When all phases are done, workflow auto-transitions to `completed`

## CLI

```bash
# Initialize a quest (creates workflow, meta-sensor handles planning task)
arc skills run --name quest-create -- init --slug <slug> --goal "<goal>" [--skills s1,s2] [--model sonnet] [--parent <taskId>]

# Set phases and start execution (called from planning task)
arc skills run --name quest-create -- plan --slug <slug> \
  --phase "Research: investigate API" \
  --phase "Implement: build sensor" \
  --phase "Test: verify output"

# Advance to next phase (called from phase task when work is done)
arc skills run --name quest-create -- advance --slug <slug>

# Check quest status
arc skills run --name quest-create -- status [--slug <slug>]
```

## Checkpoint & Idempotency

- **Checkpoint**: Workflow context stores phase list + completion status
- **Idempotent restart**: If a phase task fails, the workflow stays in `executing` with `currentPhase` unchanged. Meta-sensor re-creates the phase task on next evaluation.
- **Dedup**: Phase tasks use source `quest:<slug>:phase-<N>` — `pendingTaskExistsForSource` prevents duplicates.
- **No filesystem state**: Everything lives in the workflow context (DB-backed, not files).

## Task Hierarchy

```
Source task (complex goal)
  └── Quest workflow (quest:<slug>)
       ├── Phase 1 task (parent_id → source task, source: quest:<slug>:phase-1)
       ├── Phase 2 task (parent_id → source task, source: quest:<slug>:phase-2)
       └── Phase N task (parent_id → source task, source: quest:<slug>:phase-N)
```

## Phase Design Guidelines

- Each phase should be completable in <2min of LLM time
- 2-6 phases per quest (more than 6 suggests the goal needs further decomposition)
- Phase names should be verb-noun: "Research API", "Implement sensor", "Write tests"
- Each phase goal should be specific and measurable
- Later phases can reference earlier phase outputs

## Example

```bash
# Init a quest to add a new sensor
arc skills run --name quest-create -- init --slug arxiv-sensor --goal "Add arXiv paper monitoring sensor to Arc" --skills arc-skill-manager --model sonnet

# Plan phases (called by the planning task)
arc skills run --name quest-create -- plan --slug arxiv-sensor \
  --phase "Research: investigate arXiv API, identify relevant categories" \
  --phase "Schema: design paper_cache table, add to db.ts" \
  --phase "Implement: build sensor.ts that fetches and caches papers" \
  --phase "Test: verify sensor runs, creates tasks for new papers"
```
