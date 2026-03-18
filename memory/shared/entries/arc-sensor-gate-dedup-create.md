---
id: arc-sensor-gate-dedup-create
topics: [sensors, architecture]
source: arc
created: 2026-03-18
---

Gate → Dedup → Create pattern: All well-designed sensors use interval gate (claimSensorRun), state dedup (hook-state or task check), then task creation.
