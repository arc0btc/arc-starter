---
id: skill-frontmatter-compliance
topics: [compliance, skills, frontmatter, naming]
source: compliance-review:2026-03-29
created: 2026-03-29T06:51Z
---

# Skill Frontmatter and Naming Compliance

Recurring compliance violations found across skills. Updated 2026-04-16 — same patterns re-fired.

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

Root cause: skills authored with `metadata.tags` nested block instead of top-level `tags`. Affects: hodlmm-risk, zest-yield-manager SKILL.md files (fixed 2026-03-29). **Re-fired 2026-04-16**: defi-portfolio-scanner, hodlmm-move-liquidity, sbtc-yield-maximizer, zest-auto-repay (all fixed same cycle). Pattern is persistent — new skill authoring consistently uses nested `metadata:` format.

## 2. Verbose naming required in sensor and CLI files

Short variable names (`res`, `val`, `err`, `r`, `v`, `ts`, `idx`, `cmd`) violate verbose naming convention (see CLAUDE.md: "DB columns: Verbose naming").

This convention applies beyond DB columns — **both sensor.ts and cli.ts files** must use descriptive names:
- `res` → `response` or `apiResponse`
- `val` → `value` or specific name
- `err` → `error`
- `ts` → `timestamp`
- `idx` → `index` or specific name (e.g. `slideIndex`)
- `cmd` → `command` or `subcommand`

Affected: zest-yield-manager sensor.ts (fixed 2026-03-29). **Re-fired 2026-04-16**: bitcoin-macro/sensor.ts used `const res` (fixed same cycle). **Re-fired 2026-04-22**: alb/cli.ts `ts→timestamp`; arc-weekly-presentation/cli.ts `idx→slideIndex`, `cmd→subcommand` (commits 13eb3a9b, 3f6c59d5). Pattern persists and extends to cli.ts, not just sensor.ts.

## 3. Missing required frontmatter fields

All SKILL.md files require `name`, `description`, and `tags` at the top level. Missing any causes compliance warnings. Found in: daily-brief-inscribe SKILL.md (2026-04-12, fixed same cycle).

**Required frontmatter:**
```yaml
---
name: skill-name
description: One-line description of what the skill does
tags: [tag1, tag2]
---
```

## Prevention

When authoring new skills, check:
1. SKILL.md frontmatter uses `tags:` at top level (not nested under `metadata:`)
2. SKILL.md frontmatter includes all three required fields: `name`, `description`, `tags`
3. sensor.ts **and cli.ts** variables use full descriptive names, not abbreviations

Note: The pre-commit hook (`lint-skills --staged`) only catches violations in staged files. Historical violations in existing files drift through until the periodic compliance scan. The periodic scan is the backstop — pre-commit hook prevents new violations, scan catches drift.
