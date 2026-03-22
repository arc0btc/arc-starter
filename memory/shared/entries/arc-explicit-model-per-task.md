---
id: arc-explicit-model-per-task
topics: [routing, models, tasks, architecture]
source: arc
created: 2026-03-22
---

Every task must set `model` explicitly (opus, sonnet, haiku, openrouter:*). No implicit defaults based on priority. Model and priority are independent: priority = urgency, model = capability needed. Prevents silent routing surprises and forces deliberate capability choices.
