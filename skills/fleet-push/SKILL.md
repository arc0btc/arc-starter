---
name: fleet-push
description: Change-aware code deployment — sync commits to fleet and restart only affected services
updated: 2026-03-09
tags:
  - fleet
  - infrastructure
  - deployment
---

# fleet-push

Orchestrates fleet-wide code deployments with targeted service restarts. Detects which files changed between two commits, maps them to affected systemd units, syncs code via git bundles, restarts only what's needed, and rolls back on failure.

Complements `fleet-sync` (code delivery) and `fleet-exec` (blanket restart). Use `fleet-push` when you need change-aware, rollback-safe deployments.

## CLI Commands

```
arc skills run --name fleet-push -- push [--agents all] [--from <sha>] [--dry-run]
arc skills run --name fleet-push -- diff [--from <sha>]
arc skills run --name fleet-push -- rollback --to <sha> [--agents all]
```

## Subcommands

| Command | What it does |
|---------|-------------|
| `push` | Sync HEAD to agents, restart affected services, rollback on failure |
| `diff` | Show what would change without deploying (dry-run analysis) |
| `rollback --to <sha>` | Force-reset agents to a specific commit and restart all services |

## Options

- `--agents spark,iris` — Comma-separated agent list (default: all)
- `--from <sha>` — Compute changeset from this SHA (default: last pushed SHA from `db/hook-state/fleet-push.json`)
- `--dry-run` — Print deployment plan without executing

## File → Service Mapping

| Changed path pattern | Action |
|----------------------|--------|
| `src/sensors.ts`, `skills/*/sensor.ts` | Restart `arc-sensors.timer` |
| `src/dispatch.ts`, `src/db.ts`, `src/cli.ts`, `src/utils.ts`, `src/credentials.ts`, `src/ssh.ts` | Restart `arc-dispatch.timer` |
| `src/web.ts` | Restart `arc-web.service` |
| `package.json`, `bun.lockb` | `bun install` + restart all services |
| `CLAUDE.md`, `SOUL.md`, `memory/**`, `templates/**` | No restart (loaded per-dispatch) |
| `skills/*/SKILL.md`, `skills/*/AGENT.md`, `skills/*/cli.ts` | No restart (loaded on demand) |

## Deployment Flow

1. **Changeset** — `git diff <from>..<to> --name-only` to determine affected services
2. **Sync** — Create git bundle, SCP to each agent, fetch + reset (same as `fleet-sync git-sync`)
3. **Install** — Run `bun install` if `package.json` or `bun.lockb` changed
4. **Restart** — Restart only affected services (parallel via `Promise.allSettled()`)
5. **Verify** — Check services are `active` after restart
6. **Rollback** — If any agent fails verify, reset that agent to `<from>` SHA and restart all services
7. **Record** — Save pushed SHA to `db/hook-state/fleet-push.json`

## Rollback Strategy

Rollback is per-agent, not fleet-wide. If forge fails verify but spark succeeds, only forge is rolled back. This keeps healthy agents on the new code while recovering the failed one.

Rollback creates a P2 task on Arc describing which agent failed and why.

## State File

`db/hook-state/fleet-push.json`:
```json
{
  "last_pushed_sha": "<sha>",
  "pushed_at": "<iso8601>",
  "agents": {
    "spark": { "sha": "<sha>", "services": ["arc-sensors.timer"], "ok": true },
    "forge": { "sha": "<sha>", "services": ["arc-sensors.timer"], "ok": false }
  }
}
```

## Credentials

Uses `vm-fleet/ssh-password` (same as arc-remote-setup, fleet-exec, fleet-sync).

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] cli.ts implements push, diff, rollback commands
