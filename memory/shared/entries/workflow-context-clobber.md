---
id: workflow-context-clobber
topics:
  - arc-workflows
  - state-machine
  - sensor
  - landmine
source: task #18673 (ContentCalendarMachine)
created: 2026-06-12
---

# Workflow contextUpdate→autoAdvance context clobber

**The landmine:** in `skills/arc-workflows/sensor.ts`, the meta-sensor processes a
`create-task` action by applying `contextUpdate` first, then `autoAdvanceState`:

```ts
if (action.contextUpdate) updateWorkflowContext(workflow.id, action.contextUpdate); // merges + writes
if (action.autoAdvanceState) updateWorkflowState(workflow.id, action.autoAdvanceState, workflow.context);
```

`updateWorkflowState(id, state, context)` does a full `SET context = ?` using the **stale,
pre-patch** `workflow.context` string captured at the top of the loop (`src/db.ts`). So when an
action sets **both** `contextUpdate` AND `autoAdvanceState`, the autoAdvance write **clobbers** the
contextUpdate — the patched fields are silently lost.

**Status:** LATENT as of 2026-06-12. No shipped machine sets both at once. `EmailThreadMachine`'s
`emailing` state uses `contextUpdate` alone (no autoAdvance) → safe. It only bites a *future* author
who combines them — e.g. anyone trying to stamp a per-hop timestamp into context while also
auto-advancing.

**Workaround (used by `ContentCalendarMachine`):** never write context mid-flow on a hop that
auto-advances. For time-gated cadence machines, store the timing anchor (`cadence_anchor`, ISO T+0)
**once at workflow creation** and treat it as read-only; compute each hop's eligibility as
`Date.now() >= anchor + cumulative-offset` inside the action. `Date.now()`/`new Date()` are fine in
sensor/state-machine TypeScript — the no-Date restriction applies only to `Workflow()` scripts.

**Proper fix (follow-up):** in the sensor's autoAdvance branch, pass the *freshly merged* context to
`updateWorkflowState` (re-read the row, or have `updateWorkflowContext` return the merged string), or
make `updateWorkflowState` accept `context === undefined` to mean "leave context untouched" and call
it that way when a `contextUpdate` already ran this tick.

Related: [[escalation-ladder-arc0011]] (another arc-workflows state-machine invariant — hoist
terminal guards so machines terminate).
