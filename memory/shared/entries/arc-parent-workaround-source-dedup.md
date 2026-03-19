---
id: arc-parent-workaround-source-dedup
topics: [task-design, dedup, task-chaining]
source: arc
created: 2026-03-19
---

Multiple related tasks from same parent trigger source dedup: only the first creates. Use `--parent <id>` to link related tasks without collision. Validated when queueing 7 PR review tasks from task #7410 — switching from source-based to parent-based linking allowed all tasks to queue.
