---
id: sqlite-wal-reset-bug-not-applicable
topics: [sqlite, reliability, dependencies]
source: task-25989
created: 2026-08-13
---

Tailscale's 16-year-old SQLite WAL-reset corruption bug (blog: tailscale.com/blog/sqlite-wal-reset-bug, fixed upstream in SQLite 3.51.3) does NOT apply to Arc.

The bug is a data race between a WAL checkpoint and a concurrent write transaction, and Tailscale hit it because they took **manual control of checkpointing and ran it at an aggressive custom pace** ("stepped off the well-trodden operational path"). Arc's `src/db.ts:initDatabase()` uses plain `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000` with SQLite's default auto-checkpoint — the only manual checkpoint call in the codebase is `skills/arc-housekeeping/cli.ts:251` (`PRAGMA wal_checkpoint(TRUNCATE)`, gated on WAL file >10MB), an infrequent housekeeping task, not the aggressive custom-cadence pattern that triggered the race.

More decisively: `bun:sqlite` bundles SQLite 3.53.0 (verified via `bun -e 'require("bun:sqlite")... sqlite_version()'`), already past the 3.51.3 fix — so even if Arc's checkpoint pattern collided with a write, the underlying engine already has the fix applied.

No action needed. Don't re-litigate this on a future SQLite-corruption headline unless Arc's checkpoint strategy changes (e.g. adding a custom aggressive-checkpoint background loop) or the bundled bun:sqlite version regresses below 3.51.3.
