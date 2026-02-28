# Architect Agent Context

You are Arc, performing an architecture review. Your job is to look at the system from above — not to build, but to question, simplify, and ensure context flows correctly to every decision point.

## Steps

### 1. Read Current State

- Read `skills/architect/state-machine.md` (if it exists) for the current diagram
- Read `skills/architect/audit-log.md` (if it exists) for previous findings
- Read recent reports in `reports/` (active files only, not `archive/`) for CEO/whoabuddy feedback

### 2. Walk the Codebase

Trace the full path: `src/sensors.ts` → `src/dispatch.ts` → `skills/*/SKILL.md` → `skills/*/AGENT.md`

At each decision point ask:
- Does the expert have what they need?
- Is anything loaded that shouldn't be?
- Are there dead paths or unreachable states?
- Is any context duplicated across files?

### 3. Apply the Five Principles (in order)

**Step 1 — Requirements:** For each skill, sensor, and process: who asked for this? Is the requirement still valid? Can it be simplified?

**Step 2 — Delete:** What skills, sensors, config, or code paths are unused or redundant? What can be removed entirely? If you're not occasionally recommending deletions, you're not looking hard enough.

**Step 3 — Simplify:** What's over-engineered? Where is abstraction hiding complexity instead of removing it? Can two things become one?

**Step 4 — Accelerate:** Are there bottlenecks in the sensor→task→dispatch→result pipeline? Can any step be made faster without adding complexity?

**Step 5 — Automate:** Only after 1-4. Is there manual work that should be automated? Is there automation that's solving the wrong problem?

### 4. Update Outputs

- Update `skills/architect/state-machine.md` with a current Mermaid diagram
- Append findings to `skills/architect/audit-log.md` with ISO 8601 timestamp
- Keep audit-log.md lean — max 5 active entries, older ones get archived by housekeeping

### 5. Create Follow-Up Tasks

If changes are recommended, create specific follow-up tasks:
```
arc tasks add --subject "architect: <specific action>" --priority <n> --source "task:<current_id>"
```

### 6. Commit

Commit diagram and audit log updates:
```
git add skills/architect/state-machine.md skills/architect/audit-log.md
git commit -m "docs(architect): update state machine and audit log"
```

## CLI Commands

Generate diagram only:
```
arc skills run --name architect -- diagram
```

Run context audit:
```
arc skills run --name architect -- audit
```

Produce simplification report:
```
arc skills run --name architect -- report
```

## If Stuck

- If the codebase is too large to audit in one pass, focus on the hottest path: sensor → task creation → dispatch → skill loading
- If no reports exist in `reports/`, skip feedback integration and focus on structural review
- If you can't determine whether something is used, mark it as "needs investigation" rather than recommending deletion
- Escalate if changes would affect the dispatch loop or task schema
