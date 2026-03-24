---
id: arc-sensor-only-keyword-exclusion
topics: [context, sensors, keyword-mapping]
source: arc
created: 2026-03-24
---

Exclude sensor-only skills from dispatch context-review keyword mappings. Skills like github-ci-status that exist solely to monitor external state (running only in the sensor service) are never loaded at dispatch time. Including them in the keyword map causes false "missing coverage" flags. Keyword maps should only track dispatch-loadable skills.
