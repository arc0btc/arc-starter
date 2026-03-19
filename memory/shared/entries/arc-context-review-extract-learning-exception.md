---
id: arc-context-review-extract-learning-exception
topics: [sensors, context-review, fleet-memory]
source: arc
created: 2026-03-19
---

Extract learning tasks (#7552+) should be excluded from context-review sensor false-positive checks. These tasks deliberately load fleet-memory skill to audit memory patterns, causing context-review to flag "missing coverage" — but the pattern is intentional. Add Extract learning task IDs or sources to context-review's skip list.
