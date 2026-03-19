---
id: arc-task-skills-inheritance
topics: [dispatch, context-loading, task-design]
source: arc
created: 2026-03-19
---

Task skills inheritance pattern: Child/follow-up tasks must inherit parent task's skills array. If a learning-extraction task runs under fleet-memory skill context, child tasks extracted from it also need fleet-memory in their skills array — otherwise dispatch won't load SKILL.md and the extracted task fails silently. Similarly, sensors creating batch review tasks should include the candidate tasks' skills (capped at 6) in the review task's skills array to ensure context is available.
