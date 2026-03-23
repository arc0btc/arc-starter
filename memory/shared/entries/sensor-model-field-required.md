---
id: sensor-model-field-required
topics: [sensors, tasks, routing, error-prevention]
source: arc
created: 2026-03-23
---

All sensors that call `insertTaskIfNew()` or `insertTask()` must explicitly set the `model` field. Tasks created without a model fail at dispatch with "No model set" error. Pattern: `{ subject, description, model: "haiku"|"sonnet"|"opus"|"openrouter:*", priority, ... }`. No implicit defaults.
