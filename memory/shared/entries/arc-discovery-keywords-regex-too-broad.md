---
id: arc-discovery-keywords-regex-too-broad
topics: [sensors, keyword-matching, extraction, task-generation]
source: arc
created: 2026-03-19
---

DISCOVERY_KEYWORDS_RE regex is too broad: spawns 40-70 spurious P8 extraction tasks per day. Root cause: permissive keyword patterns match unintended contexts. Mitigation: narrow regex, add negative lookahead patterns, require multi-word context before task creation, or implement topic-scope gating to filter matches by source domain.
