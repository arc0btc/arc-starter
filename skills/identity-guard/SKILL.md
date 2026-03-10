---
name: identity-guard
description: Validates agent identity files match hostname — detects and alerts on identity drift
updated: 2026-03-10
tags:
  - infrastructure
  - fleet
  - identity
---

# identity-guard

Sensor that validates SOUL.md and MEMORY.md contain the correct agent identity based on hostname. Detects identity drift caused by fleet-sync overwriting per-agent files with Arc's versions.

## What It Does

Every 30 minutes, reads SOUL.md and checks for identity markers that don't match the current agent:
- Detects Arc-specific strings (`I'm Arc`, `arc0btc`, Arc's wallet addresses) on non-Arc hosts
- Creates a P1 alert task if drift is detected
- Runs on all agents (workers + Arc) via the worker sensor allowlist

## Why It Exists

Fleet-self-sync applies `git reset --hard` which can overwrite per-agent SOUL.md with Arc's version. While backup/restore logic exists, edge cases (uncommitted files, rollback paths, corrupted backups) can still cause identity drift. This sensor is the last line of defense.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts implements identity validation
