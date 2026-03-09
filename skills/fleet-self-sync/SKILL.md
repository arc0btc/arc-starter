---
name: fleet-self-sync
description: Worker-local git bundle detection, apply, service restart, and health validation
updated: 2026-03-09
tags:
  - fleet
  - infrastructure
  - sync
---

# fleet-self-sync

Runs on worker agents to self-apply git bundles deposited by Arc's fleet-push/fleet-sync. Detects pending bundles in `/tmp/`, applies them, restarts affected services, and validates health. Workers handle their own sync — no SSH back from Arc needed after bundle delivery.

## How It Works

1. Sensor (5min) checks for `/tmp/arc-fleet-sync*.bundle` files
2. Finds the newest bundle, records pre-sync commit
3. Computes changed files between current HEAD and bundle target
4. Applies bundle via `git fetch` + `git reset --hard`
5. Runs `bun install` if `package.json` or `bun.lockb` changed
6. Maps changed files to affected services (same rules as fleet-push)
7. Restarts affected services, validates each is active
8. On failure: rolls back to pre-sync commit, restarts all services
9. Cleans up processed bundle files

## CLI Commands

```
arc skills run --name fleet-self-sync -- apply [--bundle <path>]
arc skills run --name fleet-self-sync -- status
```

- **apply**: Apply a specific bundle (or auto-detect newest in `/tmp/`). Handles full sync + restart + validation cycle.
- **status**: Show current commit, pending bundles, and service health.

## File → Service Mapping

| Changed path | Service |
|---|---|
| `package.json`, `bun.lockb` | ALL services |
| `src/sensors.ts`, `skills/*/sensor.ts` | `arc-sensors.timer` |
| `src/web.ts` | `arc-web.service` |
| Other `src/*.ts` | `arc-dispatch.timer` |
| `CLAUDE.md`, `SOUL.md`, `memory/**`, `skills/*/SKILL.md` | (none) |

## Checklist

- [x] `skills/fleet-self-sync/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If `cli.ts` present: runs without error
- [x] If `sensor.ts` present: exports async default function returning `Promise<string>`
