---
name: fleet-rebalance
description: Work-stealing rebalancer — moves tasks from overloaded agents to idle ones
effort: high
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - scheduling
  - sensor
---

# fleet-rebalance

Sensor-driven work-stealing. Detects idle agents via `fleet-status.json` idle flags, queries busy agents' pending queues via SSH, and steals eligible tasks to rebalance the fleet.

## Sensor Behavior

- **Cadence:** 5 minutes
- **Algorithm:** Read fleet-status.json from all agents → identify idle (idle=true, ≥2min) and busy (pending>5) agents → steal P5+ pending tasks from busy → create on idle
- **Anti-thrashing:** Max 3 steals per idle agent, 10 total per cycle. Tasks with `source: "fleet:*:stolen"` cannot be re-stolen.
- **Domain affinity:** Respects fleet-router domain rules. Cross-domain only for P8+ untagged tasks.

## Steal Eligibility

| Rule | Rationale |
|------|-----------|
| Only P5+ tasks | P1-4 too important to move |
| Skip `source: "fleet:*:stolen"` | Prevent ping-pong |
| Respect domain affinity | Don't steal specialized work |
| Allow cross-domain for P8+ untagged | Simple work anyone can do |
| Busy threshold: >5 pending | Not worth stealing from lightly loaded agents |
| Idle minimum: ≥2 minutes | Prevent steal during brief inter-task gaps |

## CLI Commands

```
arc skills run --name fleet-rebalance -- status    # Show last rebalance summary
```

## Credentials

Uses `vm-fleet` / `ssh-password` (shared with fleet-health).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
