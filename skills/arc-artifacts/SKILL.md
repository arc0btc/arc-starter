---
name: arc-artifacts
description: Vacuum + audit CLI for the source-artifact pool (artifacts/distilled/ + distilled_artifacts table). Pure DB+FS maintenance; no LLM.
updated: 2026-06-13
tags:
  - inflows
  - observability
  - maintenance
---

# arc-artifacts

Maintenance + audit surface for the source-artifact inflow pool. Two surfaces:

1. **Sensor** — `arc-artifacts-vacuum` runs every 24h. Calls `vacuumExpired()` to
   soft-delete TTL-expired rows, hard-delete rows past grace, and sweep orphan
   files. Pure DB+FS — no LLM, no task creation.

2. **CLI** — read-only query + pretty-print over the pool. Used during smoke
   verification, soak monitoring, and by `arc-reporting`'s watch task (which
   embeds the `## Inflow pool` summary in the report).

## CLI commands

```
arc skills run --name arc-artifacts -- audit [--since 24]
arc skills run --name arc-artifacts -- list <type> [--limit 10]
arc skills run --name arc-artifacts -- vacuum
arc skills run --name arc-artifacts -- stuck-check
```

- `audit` — produced count per type, consumed count per channel, soft-deleted count.
- `list` — recent artifacts of a given type with topic + citation + suggested channels.
- `vacuum` — runs `vacuumExpired()` once, prints `{soft, hard, orphanFiles}`.
- `stuck-check` — warns about any artifact type with no fresh row in 36h. Exit
  code stays 0 — read the output for warnings.

## Retention policy

TTLs come from `TTL_DAYS_BY_TYPE` in `src/artifacts.ts`:

- `arxiv` → 14 days
- `council` → 90 days
- `watch-interior` → 7 days

After TTL: row gets `deleted_at` set (soft-delete grace = 14 days). Files stay on
disk during grace. After grace, row + file both go.

Orphan files (on disk, no row) older than 24h get swept by the same vacuum pass —
covers a crash between `writeFileSync(.tmp) → rename → INSERT`.
