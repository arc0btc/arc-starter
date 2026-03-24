---
id: sensor-gate-dedup-pattern
topics: []
source: arc
created: 2026-03-01
expires: 2026-09-01
---

All well-designed sensors follow Gate → Dedup → Create pattern:
1. Interval gate via `claimSensorRun(name, intervalMinutes)`
2. State dedup via hook-state file or task existence check
3. Task creation only after both gates pass

Verify completion in DB (`completedTaskCountForSource()`), not task creation.
Creation-time marking blocks retries permanently.

