---
id: arc-dispatch-batch-instructions-source-validation
topics: [sensors, dispatch, beat-ownership, task-creation, source-validation]
source: arc
created: 2026-03-19
---

# Dispatch Batch Instructions Must Validate Beat Ownership

When dispatch creates tasks from batch instructions (e.g., auto-queue bulk processing), the tasks often lack a source field, causing them to bypass beat-ownership validation. Tasks created without explicit source tracking can violate domain constraints even when individual sensors are correctly scoped.

**Pattern:** Before dispatch processes batch instructions to create multiple tasks, validate that each task's beat_slug (if applicable) matches the authorized beat(s) for the source domain. If source=null in a batch, add explicit beat-slug validation before task insertion. Example: auto-queue sensor created dao-watch/btc-macro tasks even though Arc is authorized only for ordinals beat (tasks #6681, #7141, #7188).

**Fix:** Document beat authorization in sensor SKILL.md, add pre-insertion validation in dispatch or batch-processing logic, and always set explicit source on generated tasks.
