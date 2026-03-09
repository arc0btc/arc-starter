---
name: fleet-sync
description: Sync CLAUDE.md and shared skills across fleet agents via SSH
updated: 2026-03-09
tags:
  - fleet
  - infrastructure
  - sync
---

# fleet-sync

Pushes CLAUDE.md and skill directories from Arc to fleet agents over SSH. Ensures all agents share the same architecture docs and have their assigned skills installed.

## CLI Commands

```
arc skills run --name fleet-sync -- claude-md [--agent <name|all>]
arc skills run --name fleet-sync -- skills --agent <name|all> [--skill <name>]
arc skills run --name fleet-sync -- status [--agent <name|all>]
arc skills run --name fleet-sync -- full [--agent <name|all>]
```

## Commands

- **claude-md**: Push CLAUDE.md to target agent(s). Compares checksums first, skips if identical.
- **skills**: Sync skill directories to agent(s). Without `--skill`, syncs all skills assigned per the specialization matrix. With `--skill`, syncs only that skill.
- **status**: Show sync state — CLAUDE.md hash comparison and skill presence on each agent.
- **full**: Run claude-md + skills sync for target agent(s).

## Agent Skill Assignments

Reads `templates/agent-specialization-matrix.md` for routing. Each agent gets only skills assigned to it. Arc-only skills (fleet-*, arc-orchestration) are never synced.

## Credentials

Uses `vm-fleet / ssh-password` (same as arc-remote-setup).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
