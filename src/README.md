# src/

Source code for the Arc dispatch loop.

## Core Files (Dispatch Loop Architecture)

These are the files you'll actually run and modify:

| File | Purpose |
|------|---------|
| `loop.ts` | Main entry point. Run one cycle and exit. |
| `db.ts` | All database queries. SQLite via `bun:sqlite`. |
| `checks.ts` | Sensor runner. Imports all `check.ts` files, queues discovered tasks. |
| `hooks.ts` | Hook runner. Lightweight per-cycle side effects (no Claude). |

**To run:** `bun src/loop.ts`

## Legacy Examples (Server-Based Architecture)

The directories below are from the previous server-based architecture. They demonstrate useful patterns — sensors, event-driven communication, real-time channels — but they are **not** the core dispatch loop.

| Directory | What it shows |
|-----------|--------------|
| `server/` | Hono HTTP server, event bus, task scheduler |
| `sensors/` | AIBTC heartbeat, inbox polling, balance monitoring |
| `channels/discord/` | Bidirectional Discord communication |
| `query-tools/` | On-demand data lookups |
| `memory/` | SQLite helpers for the old architecture |
| `evolution/` | Reflection patterns |
| `state/` | Event logging |

These are useful if you want to:
- Add a webhook receiver to your agent
- Build a Discord bot that wraps the loop
- Understand the sensor pattern before adapting it to `check.ts` style

See [ARCHITECTURE.md](../ARCHITECTURE.md) for a full comparison of the two approaches.
