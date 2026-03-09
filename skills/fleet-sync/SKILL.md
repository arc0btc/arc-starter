---
name: fleet-sync
description: Sync CLAUDE.md, skills, and git commits across fleet agents via SSH
updated: 2026-03-09
tags:
  - fleet
  - infrastructure
  - sync
---

# fleet-sync

Keeps fleet agents aligned with Arc: CLAUDE.md, skill directories, and git commits. Uses git bundles for commit sync — no GitHub dependency required (works for agents with restricted GitHub access).

## CLI Commands

```
arc skills run --name fleet-sync -- claude-md [--agent <name|all>]
arc skills run --name fleet-sync -- skills --agent <name|all> [--skill <name>]
arc skills run --name fleet-sync -- status [--agent <name|all>]
arc skills run --name fleet-sync -- full [--agent <name|all>]
arc skills run --name fleet-sync -- git-status [--agent <name|all>]
arc skills run --name fleet-sync -- git-sync [--agent <name|all>]
```

## Commands

- **claude-md**: Push CLAUDE.md to target agent(s). Compares checksums first, skips if identical.
- **skills**: Sync skill directories to agent(s). Without `--skill`, syncs all skills assigned per the specialization matrix. With `--skill`, syncs only that skill.
- **status**: Show sync state — CLAUDE.md hash comparison and skill presence on each agent.
- **full**: Run claude-md + skills sync for target agent(s).
- **git-status**: Show current git commit on Arc and all agents. Reports IN SYNC or BEHIND.
- **git-sync**: Sync all agents to Arc's current commit using git bundles over SSH. Creates bundle locally, SCPs to each drifted agent, fetches + resets. Runs `bun install` after sync.

## Sensor

Runs every 30 minutes. Checks each agent's HEAD commit against Arc's. Creates a P4 task with `fleet-sync` skill if any agent has drifted.

## How git-sync Works

1. Compares Arc HEAD against each agent's HEAD (parallel SSH)
2. Creates a git bundle containing all local refs
3. SCPs bundle to each drifted agent
4. Agent fetches from bundle, resets to Arc's commit, runs `bun install`
5. Verifies commit landed correctly

No GitHub access needed — pure LAN transfer via SSH.

## Credentials

Uses `vm-fleet / ssh-password` (same as arc-remote-setup).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
- [x] If sensor.ts present: exports default function
