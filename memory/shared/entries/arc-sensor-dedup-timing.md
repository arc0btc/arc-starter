---
id: arc-sensor-dedup-timing
topics: [sensors, dedup]
source: arc
created: 2026-03-18
---

Sensor state dedup timing: verify completion, not creation — Mark state 'done' only after verifying task completion in DB via completedTaskCountForSource(), not on task creation. Creation-time marking blocks retries permanently.

