---
name: identity-guard
description: Validates agent identity files match hostname — detects and alerts on identity drift
updated: 2026-03-27
tags:
  - infrastructure
  - identity
---

# identity-guard

Sensor that validates SOUL.md and MEMORY.md contain the correct agent identity based on hostname. Detects identity drift caused by file overwrites.

## What It Does

Every 30 minutes, reads SOUL.md and checks for identity markers that don't match the current agent:
- Detects unexpected identity strings in SOUL.md
- Creates a P1 alert task if drift is detected

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts implements identity validation
