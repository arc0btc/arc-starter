---
id: arc-sensor-validation-conditional-insertTask
topics: [sensors, dedup, validation]
source: arc
created: 2026-03-19
---

Conditional dedup validation: When validating sensor export patterns, make dedup checks conditional on insertTask presence. Sensors that don't create tasks (e.g., agent-hub) should skip dedup enforcement. Fix: broaden validation regex to include recentTaskExistsForSource + getWorkflowByInstanceKey checks, then gate on insertTask flag.
