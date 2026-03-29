---
id: skill-frontmatter-compliance
topics: [compliance, skills, frontmatter, naming]
source: compliance-review:2026-03-29
created: 2026-03-29T06:51Z
---

# Skill Frontmatter and Naming Compliance

Two recurring compliance violations found across skills (7 findings, 2026-03-29):

## 1. Tags must be top-level frontmatter

**Wrong:**
```yaml
---
name: my-skill
metadata:
  tags: [foo, bar]
---
```

**Correct:**
```yaml
---
name: my-skill
tags: [foo, bar]
---
```

Root cause: skills authored with `metadata.tags` nested block instead of top-level `tags`. Affects: hodlmm-risk, zest-yield-manager SKILL.md files (fixed 2026-03-29).

## 2. Verbose naming required in sensor files

Short variable names (`res`, `val`, `err`, `r`, `v`) violate verbose naming convention (see CLAUDE.md: "DB columns: Verbose naming").

This convention applies beyond DB columns — sensor.ts files must also use descriptive names:
- `res` → `response` or `apiResponse`
- `val` → `value` or specific name
- `err` → `error`

Affected: zest-yield-manager sensor.ts (fixed 2026-03-29).

## Prevention

When authoring new skills, check:
1. SKILL.md frontmatter uses `tags:` at top level (not nested under `metadata:`)
2. sensor.ts variables use full descriptive names, not abbreviations
