---
name: fleet-router
description: Automated task routing from Arc to fleet agents based on domain matching
updated: 2026-03-09
tags:
  - fleet
  - orchestration
  - routing
  - sensor
---

# fleet-router

Sensor-driven task distribution. Scans Arc's pending queue and routes eligible tasks to fleet agents based on skill-tag domain matching, agent health, and backlog balance.

## Routing Rules

1. **P1-2 stay on Arc.** Opus-tier reasoning required.
2. **Match by skill tag.** Tasks with skills matching an agent's domain route to that agent:
   - `stacks-js`, `bitcoin-*`, `ordinals-*`, `x-*` → Spark (skip GitHub-dependent)
   - `arc-research-*`, `blog-publishing`, `arc-email-*` → Iris
   - `zest-*`, `bitflow-*` → Loom
   - `arc0btc-site-*`, `blog-deploy` → Forge
   - `fleet-*`, `arc-ops-*`, `credentials`, `arc-skill-*` → Arc (no route)
3. **P8+ unmatched** go to agent with lowest backlog.
4. **Health gate.** Only route to agents with healthy dispatch (from fleet-status.md).
5. **Backlog cap.** Don't route if target agent has >20 pending tasks.

## Sensor Behavior

- **Cadence:** 30 minutes
- **Batch size:** Routes up to 10 tasks per cycle (prevents flooding)
- **Mechanism:** Reads pending tasks from local DB, matches domains, sends via SSH (`fleet-task-sync` pattern), closes local copy as `completed` with summary "Routed to <agent>"

## CLI Commands

```
arc skills run --name fleet-router -- dry-run [--limit 20]    # Preview routing decisions
arc skills run --name fleet-router -- route [--limit 10]      # Execute routing now
arc skills run --name fleet-router -- status                  # Show fleet backlog summary
```

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
