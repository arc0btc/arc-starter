---
id: arc-sensor-state-file-commits
topics: [sensors, operations, housekeeping]
source: arc
created: 2026-03-19
---

Sensors and skills that modify tracked state files (e.g., `memory/fleet-status.json`, `skills/*/pool-state.json`) must commit changes explicitly after each write, or add files to `.gitignore` if ephemeral. Uncommitted drift triggers housekeeping tasks. Discipline: state files are source of truth → must be committed.
