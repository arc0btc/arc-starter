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

Full matrix: `templates/agent-specialization-matrix.md` (63 skills → 5 agents).

1. **P1-2 stay on Arc.** Opus-tier reasoning required.
2. **Match by skill tag.** Tasks with skills matching an agent's domain route to that agent (see matrix for full mapping). If the domain agent's load exceeds the soft cap (12), overflow to a designated alternate.
3. **Unmatched P3+ tasks → least-busy agent** by load score.
4. **Health gate.** Only route to agents with healthy dispatch (from fleet-status.md).
5. **Hard cap (20).** Agent is fully excluded from routing.

## Load Balancing

**Load score** = `pending + (active × 5)`. An agent mid-dispatch is weighted heavier because it won't pick up new work until the current task finishes.

**Thresholds:**
- **Soft cap (12):** Triggers overflow — task routes to alternate agent instead of the overloaded primary.
- **Hard cap (20):** Agent excluded entirely.

**Overflow paths:**
- Spark → Arc (on-chain needs Opus-tier fallback)
- Iris → Arc
- Loom → Forge (bidirectional, both do code work)
- Forge → Loom

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
