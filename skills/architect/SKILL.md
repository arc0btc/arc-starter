---
name: architect
description: Continuous architecture review, state machine diagrams, and simplification via SpaceX 5-step process
tags:
  - architecture
  - simplification
  - review
---

# architect

Maintains a living architecture view of Arc and applies the SpaceX 5-step engineering process to every layer. The core question: at every decision point, does the dispatched expert have the context they need?

## SpaceX Five Principles (apply in order)

1. **Make the requirements less dumb** — question every requirement, trace it to a person not a department
2. **Delete the part or process** — if you're not occasionally adding things back, you're not deleting enough
3. **Simplify or optimize** — only AFTER steps 1-2
4. **Accelerate cycle time** — only AFTER steps 1-3
5. **Automate** — last step, never first

## CLI

```
arc skills run --name architect -- diagram    # generate/update Mermaid state machine
arc skills run --name architect -- audit      # check context delivery at each decision point
arc skills run --name architect -- report     # simplification report (delete, question, trim)
```

## Sensor

Runs every 360 minutes. Creates an architecture review task when:
- State machine diagram is stale (>24h or codebase changed)
- CEO/watch reports contain actionable feedback

## Output Files

- `skills/architect/state-machine.md` — living Mermaid state machine diagram
- `skills/architect/audit-log.md` — timestamped findings (housekeeping archives)

## Checklist

- [ ] `skills/architect/SKILL.md` exists with valid frontmatter
- [ ] Frontmatter `name` matches directory name (architect)
- [ ] SKILL.md is under 2000 tokens
- [ ] `sensor.ts` runs on 360-min cadence via `claimSensorRun`
- [ ] `cli.ts` supports `diagram`, `audit`, and `report` subcommands
- [ ] `state-machine.md` contains valid Mermaid diagram
- [ ] `audit-log.md` uses ISO 8601 timestamps
