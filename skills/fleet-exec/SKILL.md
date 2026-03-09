---
name: fleet-exec
description: Parallel SSH command execution across agent fleet VMs
updated: 2026-03-09
tags:
  - infrastructure
  - fleet
  - operations
---

# fleet-exec

Run commands across the agent fleet in parallel via SSH. Built on `src/ssh.ts` shared utilities. Uses `Promise.allSettled()` — one agent failure never blocks others.

## CLI Commands

```
arc skills run --name fleet-exec -- run --command "CMD" [--agents spark,iris]
arc skills run --name fleet-exec -- pull [--agents spark,iris]
arc skills run --name fleet-exec -- restart [--agents spark,iris]
arc skills run --name fleet-exec -- status [--agents spark,iris]
```

## Subcommands

| Command | What it does |
|---------|-------------|
| `run --command CMD` | Execute arbitrary shell command on each agent VM |
| `pull` | `git pull --ff-only` + `bun install` in arc-starter |
| `restart` | Restart sensor + dispatch systemd timers |
| `status` | Run `arc status` on each agent |

## Options

- `--agents spark,iris` — Comma-separated agent list (default: all)
- `--command "CMD"` — Shell command for `run` subcommand

## Credentials

Uses `vm-fleet/ssh-password` from credential store (same as arc-remote-setup).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
