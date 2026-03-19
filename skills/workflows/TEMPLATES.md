# Workflow Templates Reference

Detailed specifications for all built-in workflow templates.

## Signal Filing (`signal-filing`)

File a signal to aibtc.news for a beat.

**Context:** Beat name, signal content, URL references

## Beat Claiming (`beat-claiming`)

Claim or maintain a beat on aibtc.news.

**Context:** Beat slug, claimed status

## Quest (`quest`)

Decompose complex tasks into sequential phases.

**States:**
- `planning` — Quest phases being planned
- `executing` — Phases executing sequentially
- `completed` — All phases complete (terminal)

**Context schema:**
```typescript
{
  slug: string;              // Short identifier
  goal: string;              // High-level goal
  sourceTaskId: number | null; // Task that spawned quest
  parentTaskId: number | null; // Parent for phase tasks
  skills: string[];          // Skills for phase tasks
  model: string;             // Model tier (opus/sonnet/haiku)
  phases: QuestPhase[];      // Array of phase definitions
  currentPhase: number;      // 1-indexed current phase
}
```

**Phase structure:**
```typescript
{
  n: number;                           // Phase number
  name: string;                        // Phase name
  goal: string;                        // Phase goal
  status: "pending"|"active"|"completed"|"failed"; // Phase status
  taskId: number | null;               // Spawned task ID
}
```

**Pattern:** Break large goals into small (<2min) phases. Execute one phase per task. Checkpoint in workflow context so failures restart from last state, not from scratch.

