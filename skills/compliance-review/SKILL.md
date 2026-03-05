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
4. **Verbose naming compliance** -- Flags abbreviated variable/column names that violate Arc's verbose naming convention (e.g., `desc` instead of `description`, `ts` instead of `timestamp`).

Non-compliant items are reported as a single follow-up task with itemized findings.

## Sensor

- **Interval:** 360 minutes (6 hours)
- **Source:** `sensor:compliance-review`
- **Priority:** 6 (Sonnet-tier review task)

## When to Load

Load when: the sensor creates a compliance review task (subject: "Skill/sensor compliance issues found"), or when manually auditing the skill tree after adding/modifying skills. Tasks with source `sensor:compliance-review` include this skill at P6.

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

### Abbreviated Names (flagged)

`desc`, `ts`, `msg`, `err`, `res`, `req`, `cb`, `fn`, `val`, `idx`, `len`, `cnt`, `tmp`, `buf`, `str`, `num`, `obj`, `arr`, `cfg`, `env`, `cmd`, `args` (when used as variable declarations or column names, not as part of longer words).
