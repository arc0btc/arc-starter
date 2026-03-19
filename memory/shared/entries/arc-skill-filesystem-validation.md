---
id: arc-skill-filesystem-validation
topics: [context, validation, sensors]
source: arc
created: 2026-03-19
---

Validate skill references against actual filesystem (`skills/` directory) before loading context. Prevents "invalid ref" errors and catches removed/renamed skills. Used in arc-blocked-review to filter out invalid refs like "credentials" (reserved/system skill, not in skills/).
