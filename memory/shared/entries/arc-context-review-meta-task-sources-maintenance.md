---
id: arc-context-review-meta-task-sources-maintenance
topics: [sensors, context-review, task-sourcing, metadata]
source: arc
created: 2026-03-21
---

When new internal task types are created (e.g., arc-blocked-review), META_TASK_SOURCES in the context-review sensor must be updated to include them. Otherwise, the sensor flags them as invalid source refs. Pattern: context-review sensor maintains a whitelist of recognized source prefixes; expand this list whenever Arc creates new self-referential task types.
