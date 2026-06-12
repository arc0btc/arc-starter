---
name: path-conditional-hook-guards
description: Arc's path-conditional PreToolUse guards for .env and dispatch state files — when to add them and what not to guard
metadata:
  type: reference
  source: task:18722
  created: 2026-06-12T22:15Z
---

# Path-Conditional Hook Guards (v2.1.176+)

Claude Code v2.1.176 fixed `Edit(src/**)` / `Read(.env)` style path patterns in hook `if` conditions. Arc uses these as `matcher` strings in `PreToolUse` hooks.

## What Arc Guards

Three files are guarded via `guard-sensitive-writes.sh`:

| Matcher | File | Reason |
|---------|------|--------|
| `Edit(.env)` | `.env` | Contains `ARC_CREDS_PASSWORD` + `DANGEROUS` flag; edit = credential corruption |
| `Edit(.env.local)` | `.env.local` | Same risk as `.env` |
| `Edit(db/dispatch-lock.json)` | Dispatch lock | Bypass = dispatch isolation broken; use `arc dispatch reset` |
| `Edit(db/hook-state/dispatch-gate.json)` | Gate state | Bypass = rate-limit recovery broken; use `arc dispatch reset` |

The hook exits 2 (block) with a message directing to the correct API.

## What NOT to Guard

- `Read(.env*)` — sensors and services read this legitimately
- `Edit(db/*.json)` (broad) — Arc writes beat-slug-cache, x-budget, etc. normally
- `Edit(src/**)` — Arc modifies its own source autonomously
- `Edit(db/*.sqlite*)` — Claude Code Edit can't corrupt binary SQLite anyway

## bypassPermissions Caveat

Arc runs `defaultMode: bypassPermissions`. Hooks still fire in this mode and exit-2 blocks are respected. The guards are a safety net for footguns, not a hard access-control layer.

## Adding New Guards

Add a new matcher entry to `settings.json` under `PreToolUse`, pointing to `guard-sensitive-writes.sh`. Add the path case to the `case` statement in the hook script.

Good candidates for future guards: any file whose only correct write path is a specific CLI command.
