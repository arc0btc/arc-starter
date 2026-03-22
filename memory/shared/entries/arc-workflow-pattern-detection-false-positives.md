---
id: arc-workflow-pattern-detection-false-positives
topics: [workflows, sensors, pattern-detection]
source: arc
created: 2026-03-22
---

Workflow pattern detection sensors must check existing state machines first before flagging a pattern as "new." Without this check, sensors produce false positives (e.g., detecting 4 patterns that are already covered by EmailThread, GithubIssueImplementation, and Quest machines). Fix: implement patternAlreadyModeled() function that checks combined source parts, subject first-word, and KNOWN_SUBJECT_PREFIXES before inserting new pattern tasks.
