---
name: compliance-review
description: Audits all skills and sensors for structural, interface, and naming compliance with Arc conventions
updated: 2026-03-05
tags:
  - housekeeping
  - quality
---

# compliance-review

Automated compliance auditor for Arc's skill tree. Detects structural violations, interface mismatches, and naming convention breaches across all skills and sensors.

## What This Skill Does

The sensor scans every installed skill and checks:

1. **Structural compliance** -- SKILL.md exists and is non-empty, frontmatter has required fields (name, description, tags), directory name matches frontmatter name.
2. **Sensor interface compliance** -- sensor.ts exports a default async function, uses `claimSensorRun()` for interval gating, defines `INTERVAL_MINUTES` constant, contains no LLM/AI API calls.
3. **CLI compliance** -- cli.ts uses named flags (`--flag value`), not positional args.
4. **Cross-skill path validation** -- Detects hardcoded `resolve(import.meta.dir, '../skill-name/file.ts')` / `join(import.meta.dir, ...)` patterns in sensor.ts and cli.ts, then verifies each resolved path exists on disk. Catches stale paths immediately after a skill rename.
5. **Verbose naming compliance** -- Flags abbreviated variable/column names that violate Arc's verbose naming convention (e.g., `desc` instead of `description`, `ts` instead of `timestamp`).

Non-compliant items are reported as a single follow-up task with itemized findings.

## Sensor

- **Interval:** 720 minutes (12 hours)
- **Source:** `sensor:compliance-review:{date}:batch-{N}`
- **Priority:** 6 (Sonnet-tier review task)
- **Batching:** Creates ≤5 skills per dispatch task. With pre-commit lint-hook overhead, 10+ findings in a single pass reliably exhausts the 15-min dispatch ceiling. Each batch task has findings listed in the description (no re-scan needed). Tasks are deduped per batch per day.

## When to Load

Load when: the sensor creates a compliance review task (subject: `compliance-review: N finding(s) [batch X/Y]`), or when manually auditing the skill tree after adding/modifying skills. Tasks with source matching `sensor:compliance-review:*` include this skill at P6.

## Compliance Rules Reference

| Rule | Applies To | What It Checks |
|------|-----------|----------------|
| `skill-md-exists` | All skills | SKILL.md exists and is non-empty |
| `frontmatter-valid` | All skills | name, description, tags present in frontmatter |
| `name-matches-dir` | All skills | frontmatter name == directory name |
| `sensor-default-export` | Sensors | Default export is an async function |
| `sensor-claim-gate` | Sensors | Uses `claimSensorRun()` |
| `sensor-interval-const` | Sensors | Defines `INTERVAL_MINUTES` |
| `sensor-no-llm` | Sensors | No LLM/AI API imports or calls |
| `verbose-naming` | All files | No abbreviated names (see list below) |
| `cross-skill-path-valid` | sensor.ts, cli.ts | Hardcoded cross-skill paths (`../skill/file`) resolve to existing files |

### Abbreviated Names (flagged)

`desc`, `ts`, `msg`, `err`, `res`, `req`, `cb`, `fn`, `val`, `idx`, `len`, `cnt`, `tmp`, `buf`, `str`, `num`, `obj`, `arr`, `cfg`, `env`, `cmd`, `args` (when used as variable declarations or column names, not as part of longer words).
